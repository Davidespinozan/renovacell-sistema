// Edge Function: el doctor REPORTA que ya hizo la transferencia de un pedido.
// Corrige el hueco: antes el PaymentModal solo llamaba notify() en el cliente, pero el
// RLS bloquea que un doctor inserte notificaciones → Dirección NUNCA se enteraba, y el
// pedido no guardaba señal alguna. Aquí, con service role:
//   1) valida que el pedido es del doctor que llama y está por cobrar,
//   2) sube el COMPROBANTE (captura) al bucket privado `proofs` (opcional),
//   3) MARCA el pedido: shipping_meta.transfer = { reported, at, reference, proof_path },
//   4) AVISA a Dirección (insert directo, sin el bloqueo del doctor) → aparece en la
//      cola "Transferencias por confirmar".
// Requiere JWT (el doctor autenticado). Desplegar SIN --no-verify-jwt.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Decodifica un data-URI de imagen a bytes (para subir el comprobante).
function decodeDataUrl(dataUrl?: string): { bytes: Uint8Array; contentType: string } | null {
  if (!dataUrl) return null
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, contentType: m[1] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })

  let body: { orderId?: string; reference?: string; proof?: string }
  try { body = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!body.orderId) return json(400, { error: 'Falta el pedido.' })

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: order } = await admin.from('orders').select('id, external_ref, doctor_id, payment_status, shipping_meta').eq('id', body.orderId).single()
  if (!order) return json(404, { error: 'Pedido no encontrado.' })
  if (order.doctor_id !== who.user.id) return json(403, { error: 'Ese pedido no es tuyo.' })
  if (order.payment_status === 'paid') return json(400, { error: 'Ese pedido ya está pagado.' })

  const now = new Date().toISOString()

  // Comprobante (opcional) → bucket privado.
  let proofPath: string | null = null
  const dec = decodeDataUrl(body.proof)
  if (dec) {
    const path = `transfers/${order.id}/${Date.now()}.jpg`
    const up = await admin.storage.from('proofs').upload(path, dec.bytes, { contentType: dec.contentType, upsert: true })
    if (!up.error) proofPath = path
  }

  // Marca el pedido (conserva la dirección de entrega que ya trae shipping_meta).
  const meta = { ...((order.shipping_meta ?? {}) as Record<string, unknown>) }
  meta.transfer = { reported: true, at: now, reference: (body.reference ?? '').slice(0, 80), proof_path: proofPath }
  await admin.from('orders').update({ shipping_meta: meta, payment_method: 'transferencia' }).eq('id', order.id)

  // Avisa a Dirección (service role: sin el bloqueo del doctor).
  await admin.from('notifications').insert({
    body: `Transferencia informada · pedido ${order.external_ref ?? order.id} · confírmala al recibirla`,
    roles: ['admin'], screen: 'av_fin',
  }).then(() => {}, () => {})

  return json(200, { ok: true })
})