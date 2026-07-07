// Edge Function: WEBHOOK de Stripe. Stripe la llama cuando un pago se completa;
// aquí verificamos la firma y marcamos el pedido como PAGADO (service role, directo
// a orders — no pasa por el RPC porque no hay usuario en sesión). SEAM: sin
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET responde 501 (inofensivo).
// IMPORTANTE: al desplegar, usar --no-verify-jwt (Stripe no manda JWT de Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'

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

  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object as { metadata?: Record<string, string>; id?: string; payment_intent?: string }
    const orderId = obj.metadata?.order_id
    if (orderId) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      // service role: actualiza directo (marca pagado + libera a Almacén).
      await admin.from('orders').update({
        payment_status: 'paid', payment_method: 'stripe',
        payment_ref: (obj.payment_intent as string) ?? obj.id ?? null,
        stripe_payment_id: obj.id ?? null,
      }).eq('id', orderId).eq('payment_status', 'pending')
      // Nota: el status 'pending_payment' → 'paid' lo puedes reflejar con un trigger
      // o ampliando este update; se deja mínimo para no pisar estados avanzados.
      await admin.from('orders').update({ status: 'paid' }).eq('id', orderId).eq('status', 'pending_payment')
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
