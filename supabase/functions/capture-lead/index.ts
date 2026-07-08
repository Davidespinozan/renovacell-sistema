// Edge Function PÚBLICA: captación de leads desde la landing (o cualquier canal web).
// Es el extremo servidor del "motor de captación multicanal": la landing es anónima,
// así que NO puede insertar en `prospects` directamente (RLS es staff-only). Esta
// función corre con service_role y hace lo mismo que el motor del cliente:
//   1) anti-spam (honeypot + validación de forma),
//   2) DEDUP por teléfono/correo (si ya existe, agrega una nota; no duplica),
//   3) AUTO-ASIGNACIÓN balanceada al vendedor (role_id='pos') con menos carga abierta,
//   4) avisa a Dirección (notificación).
// Nunca revela si el lead ya existía (evita enumeración). El envío/branding de correo
// de confirmación queda para la fase SMTP.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const digits = (s: string): string => s.replace(/\D/g, '')
const OPEN_EXCLUDED = ['convertido', 'descartado']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  let payload: {
    name?: string; email?: string; phone?: string; cedula?: string
    organization?: string; interest?: string; channel?: string; website?: string // website = honeypot
  }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }

  // 1) Anti-spam: honeypot. Un humano no ve ni llena `website`; un bot sí. Si viene
  //    lleno, respondemos OK pero NO guardamos (que el bot crea que funcionó).
  if ((payload.website ?? '').trim() !== '') return json(200, { ok: true })

  // Validación de forma (nombre + al menos un contacto; longitudes acotadas).
  const name = (payload.name ?? '').trim().slice(0, 120)
  const email = (payload.email ?? '').trim().toLowerCase().slice(0, 160)
  const phone = (payload.phone ?? '').trim().slice(0, 40)
  const cedula = (payload.cedula ?? '').trim().slice(0, 40) || null
  const channel = (payload.channel ?? 'Landing').trim().slice(0, 40) || 'Landing'
  const organization = (payload.organization ?? '').trim().slice(0, 160) || null
  const interest = (payload.interest ?? '').trim().slice(0, 120)
  if (name.length < 2) return json(400, { error: 'Falta el nombre.' })
  if (!email && !phone) return json(400, { error: 'Deja un correo o teléfono.' })
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Correo inválido.' })

  const admin = createClient(url, service, { auth: { persistSession: false } })

  // 2) Dedup por teléfono (≥7 dígitos) o correo.
  const ph = digits(phone)
  const { data: existing } = await admin.from('prospects').select('id, name, email, phone, meta')
  const dup = (existing ?? []).find((p) =>
    (ph.length >= 7 && digits(p.phone ?? '') === ph) || (email !== '' && (p.email ?? '').toLowerCase() === email))
  if (dup) {
    const meta = (dup.meta ?? {}) as Record<string, unknown>
    const notes = Array.isArray(meta.notes) ? meta.notes : []
    notes.push({ text: `Nuevo contacto por ${channel} desde el sitio.`, at: new Date().toISOString() })
    await admin.from('prospects').update({ meta: { ...meta, notes } }).eq('id', dup.id)
    return json(200, { ok: true }) // no revela que ya existía
  }

  // 3) Auto-asignación balanceada: vendedor (role_id='pos') con menos prospectos abiertos.
  const [{ data: sellers }, { data: openRows }] = await Promise.all([
    admin.from('profiles').select('id').eq('role_id', 'pos'),
    admin.from('prospects').select('assigned_to').not('status', 'in', `(${OPEN_EXCLUDED.join(',')})`),
  ])
  let assigned: string | null = null
  if (sellers && sellers.length > 0) {
    const load: Record<string, number> = {}
    ;(openRows ?? []).forEach((r) => { const a = r.assigned_to as string | null; if (a) load[a] = (load[a] ?? 0) + 1 })
    assigned = sellers.map((s) => s.id as string).sort((a, b) => (load[a] ?? 0) - (load[b] ?? 0))[0]
  }

  const meta = { organization, interest: interest ? [interest] : [], notes: [] as unknown[], capturedVia: 'landing' }
  const { error: insErr } = await admin.from('prospects').insert({
    name, email: email || null, phone: phone || null, cedula, source: channel,
    status: 'nuevo', assigned_to: assigned, meta,
  })
  if (insErr) return json(500, { error: 'No se pudo registrar. Intenta de nuevo.' })

  // 4) Aviso a Dirección (best-effort; no bloquea la respuesta al lead).
  await admin.from('notifications').insert({
    body: `Lead nuevo desde el sitio: ${name}`, roles: ['admin'], screen: 'av_prosp',
  }).then(() => {}, () => {})

  return json(200, { ok: true })
})
