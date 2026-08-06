// Edge Function PÚBLICA: WEBHOOK de Meta (WhatsApp Cloud API + Messenger + Instagram).
// Es el reemplazo DIRECTO de Leadsales: los mensajes de los canales del cliente llegan
// aquí de la mano de Meta —sin intermediario que cobre suscripción— y entran al MISMO
// motor de captación que la landing (dedup + auto-asignación + hilo de conversación).
//
// FLUJO
//   GET  → verificación de suscripción de Meta (hub.challenge). Se hace una vez al
//          conectar el webhook en el panel de Meta.
//   POST → un mensaje entrante. Verificamos la firma (X-Hub-Signature-256), extraemos
//          remitente + texto por canal, deduplicamos contra `prospects`, asignamos al
//          vendedor con menos carga y agregamos el mensaje al hilo (`meta.messages`).
//
// SEAM (listo-para-credencial, como el resto de integraciones): sin META_VERIFY_TOKEN
// y META_APP_SECRET la función responde 501. Al pegar los secrets del app de Meta del
// cliente, se enciende — sin tocar código. Nada de esto usa Leadsales.
//
// IMPORTANTE al desplegar: --no-verify-jwt (Meta no manda JWT de Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const OPEN_EXCLUDED = ['convertido', 'descartado']
const digits = (s: string): string => (s ?? '').replace(/\D/g, '')

// Firma HMAC-SHA256 del cuerpo con el App Secret. Meta la manda en 'sha256=<hex>'.
// Comparación en tiempo (casi) constante para no filtrar por temporización.
async function validSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const expected = `sha256=${hex}`
  if (header.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

interface Incoming { channel: string; from: string; name: string; text: string; psid?: string }

// Extrae los mensajes ENTRANTES de un payload de Meta, sin importar el canal:
//   · WhatsApp Cloud API → entry[].changes[].value.messages[]  (from = teléfono)
//   · Messenger / Instagram → entry[].messaging[]               (sender.id = PSID)
// Los no-texto (imagen/audio) se registran como marcador para no perder el contacto.
function extractMessages(payload: Record<string, unknown>): Incoming[] {
  const out: Incoming[] = []
  const objType = payload?.object as string | undefined
  const entries = Array.isArray(payload?.entry) ? (payload.entry as Record<string, unknown>[]) : []
  for (const entry of entries) {
    // WhatsApp
    for (const change of ((entry.changes as Record<string, unknown>[]) ?? [])) {
      const value = (change.value ?? {}) as Record<string, unknown>
      const contacts = (value.contacts as Record<string, unknown>[]) ?? []
      const nameByWa: Record<string, string> = {}
      for (const c of contacts) {
        const wa = c?.wa_id as string | undefined
        if (wa) nameByWa[wa] = ((c?.profile as Record<string, unknown>)?.name as string) ?? ''
      }
      for (const m of ((value.messages as Record<string, unknown>[]) ?? [])) {
        const from = m.from as string
        if (!from) continue
        const type = (m.type as string) ?? 'text'
        const text = type === 'text' ? (((m.text as Record<string, unknown>)?.body as string) ?? '') : `[${type}]`
        out.push({ channel: 'WhatsApp', from, name: nameByWa[from] ?? '', text })
      }
    }
    // Messenger / Instagram
    for (const msg of ((entry.messaging as Record<string, unknown>[]) ?? [])) {
      const psid = (msg.sender as Record<string, unknown>)?.id as string | undefined
      const text = ((msg.message as Record<string, unknown>)?.text as string) ?? ''
      if (!psid || !text) continue
      out.push({ channel: objType === 'instagram' ? 'Instagram' : 'Facebook', from: psid, name: '', text, psid })
    }
  }
  return out
}

Deno.serve(async (req) => {
  const verifyToken = Deno.env.get('META_VERIFY_TOKEN')
  const appSecret = Deno.env.get('META_APP_SECRET')
  // Seam: sin credenciales del app de Meta, dormida (inofensiva).
  if (!verifyToken || !appSecret) return new Response('Meta no configurado', { status: 501 })

  // ── Verificación de suscripción (Meta la llama al conectar el webhook) ──
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const mode = u.searchParams.get('hub.mode')
    const token = u.searchParams.get('hub.verify_token')
    const challenge = u.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === verifyToken) return new Response(challenge ?? '', { status: 200 })
    return new Response('Verificación fallida', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('método no permitido', { status: 405 })

  // ── Mensaje entrante: firma + parseo ──
  const body = await req.text()
  if (!(await validSignature(body, req.headers.get('x-hub-signature-256'), appSecret))) {
    return new Response('Firma inválida', { status: 401 })
  }
  let payload: Record<string, unknown>
  try { payload = JSON.parse(body) } catch { return new Response('JSON inválido', { status: 400 }) }

  const incomings = extractMessages(payload)
  // Meta EXIGE 200 aunque no haya nada que procesar (si no, reintenta y duplica).
  if (incomings.length === 0) return new Response(JSON.stringify({ received: true }), { status: 200 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // Cargamos prospectos y vendedores UNA vez; el batch puede traer varios mensajes.
  const [{ data: existing }, { data: sellers }] = await Promise.all([
    admin.from('prospects').select('id, name, phone, source, assigned_to, meta'),
    admin.from('profiles').select('id').eq('role_id', 'pos'),
  ])
  const rows = (existing ?? []) as { id: string; name: string | null; phone: string | null; source: string | null; assigned_to: string | null; meta: Record<string, unknown> | null }[]
  const load: Record<string, number> = {}
  rows.forEach((r) => { if (r.assigned_to && !OPEN_EXCLUDED.includes(String(r.meta?.status ?? ''))) load[r.assigned_to] = (load[r.assigned_to] ?? 0) + 1 })
  const pickSeller = (): string | null => {
    if (!sellers || sellers.length === 0) return null
    return sellers.map((s) => s.id as string).sort((a, b) => (load[a] ?? 0) - (load[b] ?? 0))[0]
  }

  for (const inc of incomings) {
    const now = new Date().toISOString()
    const message = { dir: 'in', text: inc.text, at: now, channel: inc.channel }
    const ph = inc.psid ? '' : digits(inc.from)

    // Dedup: WhatsApp por teléfono; Messenger/IG por PSID guardado en meta.
    const dup = rows.find((p) =>
      inc.psid ? (p.meta?.psid === inc.psid) : (ph.length >= 7 && digits(p.phone ?? '') === ph))

    if (dup) {
      const meta = { ...(dup.meta ?? {}) }
      meta.messages = [...(Array.isArray(meta.messages) ? meta.messages : []), message]
      await admin.from('prospects').update({ meta }).eq('id', dup.id)
      if (dup.assigned_to) {
        await admin.from('notifications').insert({ body: `Nuevo mensaje de ${dup.name ?? inc.channel} por ${inc.channel}`, user_ids: [dup.assigned_to], screen: 'av_prosp' }).then(() => {}, () => {})
      }
      continue
    }

    // Nuevo prospecto: asignación balanceada + hilo abierto con este mensaje.
    const assigned = pickSeller()
    if (assigned) load[assigned] = (load[assigned] ?? 0) + 1
    const meta: Record<string, unknown> = { organization: null, interest: [], notes: [], messages: [message] }
    if (inc.psid) meta.psid = inc.psid
    const name = inc.name?.trim() || `Contacto ${inc.channel}`
    const { data: created } = await admin.from('prospects').insert({
      name, email: null, phone: inc.psid ? null : inc.from, cedula: null,
      source: inc.channel, status: 'nuevo', assigned_to: assigned, meta,
    }).select('id, name, phone, source, assigned_to, meta').single()
    if (created) rows.push(created as typeof rows[number]) // que el resto del batch lo dedupe

    await admin.from('notifications').insert({ body: `Lead nuevo por ${inc.channel}: ${name}`, roles: ['admin'], screen: 'av_prosp' }).then(() => {}, () => {})
    if (assigned) {
      await admin.from('notifications').insert({ body: `Lead nuevo para ti (${inc.channel}): ${name}`, user_ids: [assigned], screen: 'av_prosp' }).then(() => {}, () => {})
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})