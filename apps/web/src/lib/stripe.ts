// Seam de cobro con Stripe. Intenta iniciar el Checkout real (Edge Function
// stripe-checkout). Si Stripe NO está habilitado (sin STRIPE_SECRET_KEY → 501) o
// falla, devuelve redirected=false y el flujo cae al pago mock actual. Así, en
// cuanto pegues la llave de Stripe, los pagos con tarjeta cobran de verdad SIN
// tocar la app.
import { supabase, hasSupabase } from './supabase'

export async function startStripeCheckout(orderId: string): Promise<{ redirected: boolean }> {
  if (!hasSupabase) return { redirected: false }
  try {
    const { data, error } = await supabase.functions.invoke('stripe-checkout', {
      body: { order_id: orderId, success_url: `${location.origin}/?pago=ok`, cancel_url: location.href },
    })
    if (error) return { redirected: false } // 501 no_configurado u otro → usa el flujo actual
    const url = (data as { url?: string } | null)?.url
    if (url) { window.location.href = url; return { redirected: true } }
    return { redirected: false }
  } catch {
    return { redirected: false }
  }
}
