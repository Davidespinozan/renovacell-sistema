// Edge Function: ENVÍO de salida por Meta (respuesta del vendedor en la bandeja
// multicanal). Entrega el mensaje por el canal del prospecto vía Graph API —directo
// a Meta, sin Leadsales— y, al confirmar, quita la marca "por enviar" (pending) del
// hilo. Es la contraparte de `meta-webhook` (entrada).
//
// SEAM (listo-para-credencial): sin WHATSAPP_TOKEN/WHATSAPP_PHONE_ID responde 501; la
// respuesta ya quedó guardada en el hilo marcada "por enviar". Al pegar los secrets se
// entrega de verdad, sin tocar código. Messenger/Instagram usan META_PAGE_TOKEN.
//
// REGLA DE META: fuera de la ventana de 24 h del último mensaje del cliente, WhatsApp
// exige plantillas pre-aprobadas — este envío de texto libre aplica dentro de la ventana.
//
// Requiere JWT (se despliega SIN --no-verify-jwt): solo staff autenticado responde.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const GRAPH = 'https://graph.facebook.com/v21.0'

interface Msg { dir: 'in' | 'out'; text: string; at: string; channel?: string; pending?: boolean }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const waToken = Deno.env.get('WHATSAPP_TOKEN')
  const waPhoneId = Deno.env.get('WHATSAPP_PHONE_ID')
  const pageToken = Deno.env.get('META_PAGE_TOKEN') // Messenger / Instagram
  // Seam: sin salida de WhatsApp configurada, dormido (la respuesta queda "por enviar").
  if (!waToken || !waPhoneId) return json(501, { error: 'Envío por Meta no configurado' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // El llamador debe ser staff autenticado (no un doctor).
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: prof } = await admin.from('profiles').select('role_id').eq('id', who.user.id).single()
  if (!prof || prof.role_id === 'doctor') return json(403, { error: 'Solo el equipo puede responder.' })

  let body: { prospectId?: string; at?: string; text?: string }
  try { body = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const prospectId = body.prospectId
  if (!prospectId) return json(400, { error: 'Falta prospectId.' })

  const { data: p } = await admin.from('prospects').select('id, phone, source, meta').eq('id', prospectId).single()
  if (!p) return json(404, { error: 'Prospecto no encontrado.' })
  const meta = (p.meta ?? {}) as Record<string, unknown>
  const messages: Msg[] = Array.isArray(meta.messages) ? (meta.messages as Msg[]) : []

  // El mensaje a enviar: el señalado por `at`, o el último saliente pendiente.
  const target = body.at
    ? messages.find((m) => m.at === body.at)
    : [...messages].reverse().find((m) => m.dir === 'out' && m.pending)
  const text = (body.text ?? target?.text ?? '').trim()
  if (!text) return json(400, { error: 'Nada que enviar.' })

  const channel = p.source as string | null
  let ok = false
  let errMsg = ''
  try {
    if (channel === 'WhatsApp') {
      const to = (p.phone ?? '').replace(/\D/g, '')
      if (!to) return json(400, { error: 'El prospecto no tiene teléfono.' })
      const r = await fetch(`${GRAPH}/${waPhoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      })
      ok = r.ok
      if (!ok) errMsg = await r.text()
    } else if (channel === 'Facebook' || channel === 'Instagram') {
      if (!pageToken) return json(501, { error: `Falta META_PAGE_TOKEN para enviar por ${channel}.` })
      const psid = meta.psid as string | undefined
      if (!psid) return json(400, { error: 'Sin identificador del contacto (PSID).' })
      const r = await fetch(`${GRAPH}/me/messages?access_token=${pageToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
      })
      ok = r.ok
      if (!ok) errMsg = await r.text()
    } else {
      return json(400, { error: `Canal no enviable: ${channel ?? '—'}.` })
    }
  } catch (e) {
    errMsg = (e as Error).message
  }

  if (!ok) return json(502, { error: 'Meta rechazó el envío.', detail: errMsg.slice(0, 400) })

  // Entregado: quita "por enviar" del mensaje en el hilo.
  if (target) {
    const updated = messages.map((m) => (m.at === target.at ? { ...m, pending: false } : m))
    await admin.from('prospects').update({ meta: { ...meta, messages: updated } }).eq('id', prospectId)
  }
  return json(200, { delivered: true })
})