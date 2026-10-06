// Edge Function: crea una sesión de Stripe Checkout para COBRAR un pedido.
// SEAM: si no está configurada STRIPE_SECRET_KEY devuelve 501 (y el cliente cae al
// flujo mock actual). Cuando pegues la llave, cobra de verdad — sin cambiar la app.
// Flujo: cliente llama con {order_id, success_url, cancel_url} → devuelve {url};
// el cliente redirige a esa URL (página de pago de Stripe). La confirmación del
// pago la hace `stripe-webhook` (marca el pedido pagado).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien } from '../_shared/quien.ts'
import Stripe from 'npm:stripe@17'
import { conCors } from '../_shared/cors.ts'   // CC-0B.2 · lista blanca de orígenes (antes '*')

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return json(501, { error: 'not_configured', message: 'Stripe no está habilitado. Agrega STRIPE_SECRET_KEY.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''

  // Identifica al usuario; la RLS de orders limita a su propio pedido / staff.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const q = await resolverQuien(caller, createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }))
  if (!q.ok) return json(q.status, q.body)
  // CC-0A · UNVERIFIED CANNOT CHECKOUT: invariante explícita (antes solo la cubría la RLS de
  // orders de forma indirecta). La verdad es `is_verified()` del servidor; falla cerrado.
  if (q.quien.role === 'doctor') {
    const { data: verificado, error: vErr } = await caller.rpc('is_verified')
    if (vErr || verificado !== true) return json(403, { error: 'NO_VERIFICADO', message: 'Tu cuenta aún no está verificada por Renovacell.' })
  }
  const who = { user: { id: q.quien.uid, email: q.quien.email ?? undefined } }

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
  const params = {
    mode: 'payment' as const,
    line_items: [{
      price_data: {
        currency: (order.currency ?? 'mxn').toLowerCase(),
        product_data: { name: `Pedido ${order.external_ref ?? order.id}` },
        unit_amount: Math.round(Number(order.total) * 100),
      },
      quantity: 1,
    }],
    metadata: { order_id: order.id },
    success_url: payload.success_url ?? `${origin}/sistema?pago=ok`,
    cancel_url: payload.cancel_url ?? `${origin}/sistema?pago=cancelado`,
  }
  // IDEMPOTENCIA (preflight CC): un doble clic, recarga o reintento con los MISMOS parámetros devuelve
  // la MISMA sesión de Stripe (clave = pedido + huella de monto/urls) en vez de proliferar sesiones.
  // Parámetros distintos (otro monto/url) = otra clave = otra sesión, que es lo correcto. No marca paid:
  // la verdad de pago sigue siendo el webhook (registrar_cobro, dedupe por evento/sesión).
  const idempotencyKey = `checkout:${order.id}:${await huella(JSON.stringify(params))}`
  const session = await stripe.checkout.sessions.create(params, { idempotencyKey })

  return json(200, { url: session.url, id: session.id })
}))

async function huella(texto: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(d)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}
