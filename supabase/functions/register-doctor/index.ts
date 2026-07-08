// Edge Function PÚBLICA: AUTO-REGISTRO del doctor con verificación SEP instantánea.
// El doctor se registra desde el sistema (o la landing): entra nombre + correo + cédula
// + contraseña. Aquí, del lado servidor:
//   1) anti-spam (honeypot) + validación,
//   2) verifica la cédula contra el registro (SEP/RENAPO) — mismo criterio que verify-cedula,
//   3) si el dictamen es `auto` → CREA la cuenta ya VERIFICADA con esa contraseña
//      (el doctor entra al instante); si es `review`/`reject` → deja un prospecto para
//      Dirección (sin cuenta) y devuelve el motivo.
// La consulta al registro es el mismo SEAM (CEDULA_API_* o simulador). service_role
// interno para crear el usuario (nunca en el cliente).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// ---- Verificación (misma lógica que verify-cedula) ----
interface SepRecord { found: boolean; name?: string; profession?: string }
const norm = (s?: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (s?: string) => norm(s).split(' ').filter((t) => t.length > 1 && !['dr', 'dra', 'de', 'del', 'la', 'los'].includes(t))
function nameSim(a?: string, b?: string): number { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let i = 0; A.forEach((t) => { if (B.has(t)) i++ }); return i / Math.max(A.size, B.size) }
const MED = ['medic', 'cirug', 'cirujan', 'dermatolog', 'ginecolog', 'pediatr', 'cardiolog', 'anestesiolog', 'oftalmolog', 'odontolog', 'estomatolog', 'salud', 'enferm']
const isMed = (p?: string) => { const n = norm(p); return n !== '' && MED.some((k) => n.includes(k)) }
function decide(name: string, sep: SepRecord) {
  if (!sep.found) return { decision: 'reject', score: 0, reasons: ['La cédula no aparece en el registro oficial (SEP/RENAPO).'] }
  const nm = nameSim(name, sep.name), med = isMed(sep.profession)
  const reasons: string[] = []
  let decision: string
  if (med && nm >= 0.85) { decision = 'auto'; reasons.push('Cédula válida, profesión médica y nombre coincide.') }
  else { if (!med) reasons.push(`La profesión registrada ("${sep.profession ?? '—'}") no es del área médica.`); if (nm < 0.85) reasons.push(`El nombre coincide al ${Math.round(nm * 100)}% con el del registro.`); decision = nm >= 0.5 ? 'review' : 'reject'; reasons.push(decision === 'review' ? 'Requiere revisión de Dirección.' : 'El nombre no coincide con el titular de la cédula.') }
  return { decision, score: Math.round((nm * 0.6 + (med ? 1 : 0) * 0.4) * 100), reasons }
}
async function lookupSep(cedula: string, enteredName: string): Promise<SepRecord> {
  const apiUrl = Deno.env.get('CEDULA_API_URL')
  if (apiUrl) {
    try {
      const key = Deno.env.get('CEDULA_API_KEY') ?? ''
      const header = Deno.env.get('CEDULA_API_KEY_HEADER') ?? 'Authorization'
      const scheme = Deno.env.get('CEDULA_API_AUTH_SCHEME') ?? 'Bearer'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      headers[header] = header.toLowerCase() === 'authorization' && scheme ? `${scheme} ${key}` : key
      const r = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ cedula, nombre: enteredName }) })
      if (!r.ok) return { found: false }
      // deno-lint-ignore no-explicit-any
      const d: any = await r.json().catch(() => ({}))
      const o = d?.data ?? d?.result ?? d?.persona ?? d
      const name = o?.nombre ?? o?.nombreCompleto ?? o?.name
      const profession = o?.profesion ?? o?.profession ?? o?.carrera
      return { found: !!name, name, profession }
    } catch { return { found: false } }
  }
  // SIMULADOR (sin proveedor): último dígito 0→no existe, 9→no médico, 8→otro nombre, resto→médico.
  const digits = (cedula ?? '').replace(/\D/g, '')
  if (digits.length < 5) return { found: false }
  const last = digits[digits.length - 1]
  if (last === '0') return { found: false }
  if (last === '9') return { found: true, name: enteredName, profession: 'Licenciatura en Administración' }
  if (last === '8') return { found: true, name: 'Juan Pérez García', profession: 'Médico Cirujano' }
  return { found: true, name: enteredName, profession: 'Médico Cirujano' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  let p: { name?: string; email?: string; cedula?: string; password?: string; organization?: string; phone?: string; website?: string }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if ((p.website ?? '').trim() !== '') return json(200, { decision: 'review' }) // honeypot

  const name = (p.name ?? '').trim().slice(0, 120)
  const email = (p.email ?? '').trim().toLowerCase().slice(0, 160)
  const cedula = (p.cedula ?? '').trim().slice(0, 40)
  const password = p.password ?? ''
  if (name.length < 3) return json(400, { error: 'Escribe tu nombre completo.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Correo inválido.' })
  if (cedula.replace(/\D/g, '').length < 5) return json(400, { error: 'Escribe tu número de cédula.' })
  if (password.length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres.' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const sep = await lookupSep(cedula, name)
  const result = decide(name, sep)

  if (result.decision === 'auto') {
    // Ya verificado → crea la cuenta con su contraseña y le da acceso al instante.
    const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
    if (cErr || !created?.user) {
      // correo ya registrado u otro → no duplicar; que inicie sesión.
      if ((cErr?.message ?? '').toLowerCase().includes('already')) return json(200, { decision: 'exists', message: 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.' })
      return json(500, { error: cErr?.message ?? 'No se pudo crear la cuenta.' })
    }
    await admin.from('profiles').upsert({
      id: created.user.id, email, full_name: name, role_id: 'doctor', verified: true,
      organization: p.organization ?? null, meta: { cedula, verifyResult: result, capturedVia: 'auto-registro' },
    })
    await admin.from('notifications').insert({ body: `Doctor auto-verificado (registro): ${name}`, roles: ['admin'], screen: 'av_doc' }).then(() => {}, () => {})
    return json(200, { decision: 'auto' })
  }

  // review / reject → prospecto para Dirección (sin cuenta).
  await admin.from('prospects').insert({
    name, email, phone: p.phone ?? null, cedula, source: 'Landing', status: 'nuevo',
    meta: { organization: p.organization ?? null, interest: [], notes: [], verifyResult: result, capturedVia: 'auto-registro' },
  }).then(() => {}, () => {})
  return json(200, { decision: result.decision, reasons: result.reasons })
})
