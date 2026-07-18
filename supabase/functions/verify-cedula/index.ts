// Edge Function: VERIFICACIÓN AUTOMÁTICA de cédula (IA + SEP), lado servidor.
// Recibe { cedula, name } y devuelve el dictamen (auto | review | reject) con score.
//
// SEAM del proveedor: `lookupSep()` es hoy un SIMULADOR determinista. En producción se
// reemplaza por la consulta real al Registro Nacional de Profesionistas (SEP/RENAPO) a
// través de un proveedor de validación/KYC mexicano, y (opcional) OCR de la cédula/INE.
// La LÓGICA DE DECISIÓN vive aquí (misma que el cliente en data/verification/decide.ts)
// para que la fuente de verdad y el criterio no dependan del navegador.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// `unavailable` distingue "no pude consultar el registro" (caída, timeout, sin
// proveedor) de "consulté y la cédula NO existe". Confundirlos hacía que una caída
// rechazara a un médico real diciéndole en falso que su cédula no está registrada.
// Los campos de EVIDENCIA (provider/checkedAt/folio) se guardan con el doctor para
// poder comprobar después que la verificación ocurrió y contra qué fuente.
interface SepRecord {
  found: boolean
  unavailable?: boolean
  name?: string; profession?: string; year?: string; institution?: string
  provider?: string; checkedAt?: string; folio?: string
}

const norm = (s?: string): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (s?: string): string[] =>
  norm(s).split(' ').filter((t) => t.length > 1 && !['dr', 'dra', 'de', 'del', 'la', 'los'].includes(t))
function nameSimilarity(a?: string, b?: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0; A.forEach((t) => { if (B.has(t)) inter += 1 })
  return inter / Math.max(A.size, B.size)
}
const MEDICAL = ['medic', 'cirug', 'cirujan', 'dermatolog', 'ginecolog', 'pediatr', 'cardiolog', 'anestesiolog', 'oftalmolog', 'odontolog', 'estomatolog', 'salud', 'enferm']
const isMedical = (p?: string): boolean => { const n = norm(p); return n !== '' && MEDICAL.some((k) => n.includes(k)) }

function decide(enteredName: string, sep: SepRecord) {
  // NUNCA rechazar por una falla nuestra: si no se pudo consultar el registro, va a
  // revisión manual de Dirección. Rechazar aquí acusaría en falso a un médico real.
  if (sep.unavailable) {
    return {
      score: 0, nameMatch: 0, isMedical: false, decision: 'review',
      reasons: ['No fue posible consultar el registro oficial en este momento. Dirección verificará la cédula manualmente.'],
      sep,
    }
  }
  if (!sep.found) return { score: 0, nameMatch: 0, isMedical: false, decision: 'reject', reasons: ['La cédula no aparece en el registro oficial (SEP/RENAPO).'], sep }
  const nm = nameSimilarity(enteredName, sep.name)
  const medical = isMedical(sep.profession)
  const nameMatch = Math.round(nm * 100)
  const score = Math.round((nm * 0.6 + (medical ? 1 : 0) * 0.4) * 100)
  const reasons: string[] = []
  let decision: string
  if (medical && nm >= 0.85) { decision = 'auto'; reasons.push('Cédula válida en el registro, profesión del área médica y nombre coincide.') }
  else {
    if (!medical) reasons.push(`La profesión registrada ("${sep.profession ?? '—'}") no es del área médica.`)
    if (nm < 0.85) reasons.push(`El nombre coincide al ${nameMatch}% con el del registro.`)
    decision = nm >= 0.5 ? 'review' : 'reject'
    reasons.push(decision === 'review' ? 'Requiere revisión manual de Dirección.' : 'El nombre no coincide con el titular de la cédula.')
  }
  return { score, nameMatch, isMedical: medical, decision, reasons, sep }
}

// ── Consulta al registro (SEP/RENAPO) ───────────────────────────────────────────
// Adaptador PROVEEDOR-AGNÓSTICO. Se activa SOLO si hay `CEDULA_API_URL` configurada
// (secreto de Supabase); si no, cae al SIMULADOR. Así "enchufar el proveedor" es meter
// credenciales, sin tocar código. Proveedores MX: APIMarket, Kiban, Nubarium, Verifica
// ID, KYC Systems (todos envuelven el Registro Nacional de Profesionistas).
//
// Env (secrets):
//   CEDULA_API_URL          endpoint del proveedor (POST JSON)
//   CEDULA_API_KEY          la clave/token
//   CEDULA_API_KEY_HEADER   header de auth (default 'Authorization')
//   CEDULA_API_AUTH_SCHEME  esquema (default 'Bearer'; usa '' si el header lleva la clave pelona)
const norm2 = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
// deno-lint-ignore no-explicit-any
function pick(obj: any, candidates: string[]): string | undefined {
  // deno-lint-ignore no-explicit-any
  const scan = (o: any): string | undefined => {
    if (!o || typeof o !== 'object') return undefined
    for (const k of Object.keys(o)) {
      const nk = norm2(k)
      if (candidates.some((c) => nk.includes(norm2(c))) && (typeof o[k] === 'string' || typeof o[k] === 'number')) return String(o[k])
    }
    return undefined
  }
  return scan(obj) ?? scan(obj?.data) ?? scan(obj?.result) ?? scan(obj?.persona) ?? scan(obj?.cedula) ?? scan(obj?.registro)
}
// deno-lint-ignore no-explicit-any
function mapSepResponse(body: any): SepRecord {
  const name = pick(body, ['nombrecompleto', 'nombre', 'name', 'fullname'])
  const profession = pick(body, ['profesion', 'profession', 'carrera'])
  const year = pick(body, ['anodeexpedicion', 'anio', 'ano', 'year'])
  const institution = pick(body, ['institucion', 'institution', 'universidad', 'escuela'])
  const blob = JSON.stringify(body ?? {}).toLowerCase()
  const notFound = /no (fueron )?encontrad|not found|sin resultado|no existe|invalid/.test(blob)
  return { found: !!name && !notFound, name, profession, year, institution }
}

async function lookupSepHttp(cedula: string, enteredName: string): Promise<SepRecord> {
  const url = Deno.env.get('CEDULA_API_URL')!
  const key = Deno.env.get('CEDULA_API_KEY') ?? ''
  const header = Deno.env.get('CEDULA_API_KEY_HEADER') ?? 'Authorization'
  const scheme = Deno.env.get('CEDULA_API_AUTH_SCHEME') ?? 'Bearer'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  headers[header] = header.toLowerCase() === 'authorization' && scheme ? `${scheme} ${key}` : key
  const checkedAt = new Date().toISOString()
  try {
    // Timeout explícito: sin esto, un proveedor lento cuelga la verificación.
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ cedula, nombre: enteredName }), signal: ctrl.signal })
    clearTimeout(t)
    // Un error del proveedor NO es "cédula inexistente": es indisponibilidad.
    if (!r.ok) return { found: false, unavailable: true, provider: url, checkedAt }
    const raw = await r.json().catch(() => ({}))
    const mapped = mapSepResponse(raw)
    return { ...mapped, provider: url, checkedAt, folio: pick(raw, ['folio', 'idconsulta', 'transaction', 'referencia']) }
  } catch {
    return { found: false, unavailable: true, provider: url, checkedAt }
  }
}

// SIMULADOR — SOLO para demos. Determinista por el último dígito de la cédula.
// Ya NO es el respaldo por defecto: aprobar solo porque no hay proveedor sería
// dar acceso a alguien sin comprobar que es médico.
function simulateSep(cedula: string, enteredName: string): SepRecord {
  const checkedAt = new Date().toISOString()
  const digits = (cedula ?? '').replace(/\D/g, '')
  if (digits.length < 5) return { found: false, provider: 'simulador', checkedAt }
  const last = digits[digits.length - 1]
  if (last === '0') return { found: false, provider: 'simulador', checkedAt }
  if (last === '9') return { found: true, name: enteredName, profession: 'Licenciatura en Administración', year: '2015', institution: 'UNAM', provider: 'simulador', checkedAt }
  if (last === '8') return { found: true, name: 'Juan Pérez García', profession: 'Médico Cirujano', year: '2013', institution: 'IPN', provider: 'simulador', checkedAt }
  return { found: true, name: enteredName, profession: 'Médico Cirujano', year: '2014', institution: 'UNAM', provider: 'simulador', checkedAt }
}

// Orden: proveedor real → simulador (solo si se pide explícito) → revisión manual.
// SIN proveedor configurado, el sistema NO inventa un veredicto: manda a revisión
// manual. Es el comportamiento honesto y el que corresponde a la ruta manual.
async function lookupSep(cedula: string, enteredName: string): Promise<SepRecord> {
  if (Deno.env.get('CEDULA_API_URL')) return lookupSepHttp(cedula, enteredName)
  if (Deno.env.get('CEDULA_SIMULATE') === 'true') return simulateSep(cedula, enteredName)
  return { found: false, unavailable: true, provider: 'sin-proveedor', checkedAt: new Date().toISOString() }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('role_id, full_name, meta').eq('id', who.user.id).single()
  const callerRole = prof?.role_id ?? ''
  const isStaff = ['admin', 'billing', 'comm'].includes(callerRole)
  const isDoctor = callerRole === 'doctor'
  if (!isStaff && !isDoctor) return json(403, { error: 'No autorizado.' })

  let payload: { cedula?: string; name?: string }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const cedula = (payload.cedula ?? '').trim()
  // El doctor verifica SU cédula (nombre desde su perfil); el staff pasa el nombre del doctor.
  const name = (payload.name ?? (isDoctor ? (prof?.full_name ?? '') : '')).trim()
  if (!cedula) return json(400, { error: 'Falta la cédula.' })

  const sep = await lookupSep(cedula, name)
  const result = decide(name, sep)

  // Auto-servicio del doctor: guarda su cédula y, si el dictamen es `auto`, se le da
  // acceso. El flip de `verified` va con service_role porque la RLS impide que el
  // propio doctor lo cambie. En `review`/`reject` queda el dictamen para Dirección.
  if (isDoctor) {
    const meta = { ...((prof?.meta ?? {}) as Record<string, unknown>), cedula, verifyResult: result }
    const patch: Record<string, unknown> = { meta }
    if (result.decision === 'auto') patch.verified = true
    await admin.from('profiles').update(patch).eq('id', who.user.id)
  }
  // Para staff, el cliente aplica la decisión bajo su RLS de admin.
  return json(200, result)
})
