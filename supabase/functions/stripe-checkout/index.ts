// Edge Function: crea una sesión de Stripe Checkout para COBRAR un pedido.
// SEAM: si no está configurada STRIPE_SECRET_KEY devuelve 501 (y el cliente cae al
// flujo mock actual). Cuando pegues la llave, cobra de verdad — sin cambiar la app.
// Flujo: cliente llama con {order_id, success_url, cancel_url} → devuelve {url};
// el cliente redirige a esa URL (página de pago de Stripe). La confirmación del
// pago la hace `stripe-webhook` (marca el pedido pagado).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return json(501, { error: 'not_configured', message: 'Stripe no está habilitado. Agrega STRIPE_SECRET_KEY.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // Identifica al usuario; la RLS de orders limita a su propio pedido / staff.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })

  let payload: { order_id?: string; success_url?: string; cancel_url?: string }
  try { payload = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (!payload.order_id) return json(400, { error: 'Falta order_id.' })

  const { data: order, error } = await caller.from('orders')
    .select('id, external_ref, total, currency, payment_status')
    .eq('id', payload.order_id).single()
  if (error || !order) return json(404, { error: 'Pedido no encontrado o sin acceso.' })
  if (order.payment_status === 'paid') return json(400, { error: 'El pedido ya está pagado.' })
  if (!order.total || order.total <= 0) return json(400, { error: 'El pedido no tiene monto a cobrar.' })

  const stripe = new Stripe(stripeKey)
  const origin = req.headers.get('origin') ?? ''
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: (order.currency ?? 'mxn').toLowerCase(),
        product_data: { name: `Pedido ${order.external_ref ?? order.id}` },
        unit_amount: Math.round(Number(order.total) * 100),
      },
      quantity: 1,
    }],
    metadata: { order_id: order.id },
    success_url: payload.success_url ?? `${origin}/?pago=ok`,
    cancel_url: payload.cancel_url ?? `${origin}/?pago=cancelado`,
  })

  return json(200, { url: session.url, id: session.id })
})
