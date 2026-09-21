// Edge Function: WEBHOOK de Stripe. Stripe la llama cuando un pago se completa;
// aquí verificamos la firma y marcamos el pedido como PAGADO (service role, directo
// a orders — no pasa por el RPC porque no hay usuario en sesión). SEAM: sin
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET responde 501 (inofensivo).
// IMPORTANTE: al desplegar, usar --no-verify-jwt (Stripe no manda JWT de Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'
import { evaluarPago } from './rules.ts'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const whSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!stripeKey || !whSecret) return new Response('Stripe no configurado', { status: 501 })

  const stripe = new Stripe(stripeKey)
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? '', whSecret)
  } catch (e) {
    return new Response(`Firma inválida: ${(e as Error).message}`, { status: 400 })
  }

  // Solo eventos de Checkout Session (llevan metadata.order_id, payment_status y amount_total).
  // Cubre tarjeta (completed) y métodos diferidos OXXO/SPEI (async_payment_succeeded), que
  // llegan con payment_status='paid' cuando el dinero realmente entró. `payment_intent.succeeded`
  // se ignora: no trae los metadatos de la sesión ni el estado de pago del checkout.
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session
    const orderId = session.metadata?.order_id
    if (!orderId) return ok({ received: true, ignored: 'no_order_id' })

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: order, error: readErr } = await admin.from('orders').select('total, payment_status').eq('id', orderId).maybeSingle()
    if (readErr) return new Response('db_read_error', { status: 500 }) // 500 → Stripe reintenta

    // Valida estado e IMPORTE contra el pedido antes de marcar pagado.
    const decision = evaluarPago(
      { payment_status: session.payment_status, amount_total: session.amount_total, metadata: session.metadata ?? undefined },
      order ? { total: order.total, payment_status: order.payment_status } : null,
    )
    if (!decision.marcar) {
      console.warn('[stripe-webhook] no se marca pagado:', decision.reason, { orderId })
      return ok({ received: true, ignored: decision.reason }) // evento procesado; no reintentar
    }

    // service role: marca pagado (idempotente vía .eq('payment_status','pending')) y libera a Almacén.
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null
    const { error: upErr } = await admin.from('orders').update({
      payment_status: 'paid', payment_method: 'stripe',
      payment_ref: pi ?? session.id ?? null, stripe_payment_id: session.id ?? null,
    }).eq('id', orderId).eq('payment_status', 'pending')
    if (upErr) return new Response('db_update_error', { status: 500 }) // 500 → Stripe reintenta

    const { error: stErr } = await admin.from('orders').update({ status: 'paid' }).eq('id', orderId).eq('status', 'pending_payment')
    if (stErr) return new Response('db_update_error', { status: 500 })
  }

  return ok({ received: true })
})
