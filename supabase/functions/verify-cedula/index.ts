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

interface SepRecord { found: boolean; name?: string; profession?: string; year?: string; institution?: string }

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

// SEAM: consulta al registro. Simulación por último dígito (0→no existe, 9→no médico, resto→médico).
async function lookupSep(cedula: string, enteredName: string): Promise<SepRecord> {
  const digits = (cedula ?? '').replace(/\D/g, '')
  if (digits.length < 5) return { found: false }
  const last = digits[digits.length - 1]
  if (last === '0') return { found: false }
  if (last === '9') return { found: true, name: enteredName, profession: 'Licenciatura en Administración', year: '2015', institution: 'UNAM' }
  if (last === '8') return { found: true, name: 'Juan Pérez García', profession: 'Médico Cirujano', year: '2013', institution: 'IPN' }
  return { found: true, name: enteredName, profession: 'Médico Cirujano', year: '2014', institution: 'UNAM' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Solo staff autenticado (admin) dispara verificaciones.
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!['admin', 'billing', 'comm'].includes(prof?.role_id ?? '')) return json(403, { error: 'Solo Dirección puede verificar.' })

  let payload: { cedula?: string; name?: string }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const cedula = (payload.cedula ?? '').trim()
  const name = (payload.name ?? '').trim()
  if (!cedula) return json(400, { error: 'Falta la cédula.' })

  const sep = await lookupSep(cedula, name)
  return json(200, decide(name, sep))
})
