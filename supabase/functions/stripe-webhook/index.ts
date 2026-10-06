// Edge Function: WEBHOOK de Stripe. Stripe la llama cuando un pago se completa.
//
// W2 · el dinero se registra en el LIBRO, no editando el pedido: tras verificar la firma
// se llama a `registrar_cobro` con service role — la notificación FIRMADA de Stripe es la
// evidencia del cobro. El comando crea el asiento y recalcula `payment_status`; esta
// función no vuelve a escribir campos de dinero (una sola fuente de verdad).
//
// IDEMPOTENCIA en dos capas: el op_id se DERIVA del id de la sesión de Stripe (mismo
// evento ⇒ mismo op_id ⇒ `already_applied`), y `external_ref` = id de sesión tiene índice
// único en el libro. Stripe reintenta sin miedo: no se duplica el dinero.
//
// SEAM: sin STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET responde 501 (inofensivo).
// IMPORTANTE: al desplegar, usar --no-verify-jwt (Stripe no manda JWT de Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'
import { evaluarPago } from './rules.ts'
import { observador } from '../_shared/observa.ts'

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('stripe-webhook')

// op_id ESTABLE a partir del id de la sesión: un reintento de Stripe reusa el mismo y el
// registro de operaciones de dinero devuelve `already_applied` en lugar de cobrar dos veces.
async function opIdDeSesion(sessionId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stripe:${sessionId}`))
  const b = new Uint8Array(buf)
  b[6] = (b[6] & 0x0f) | 0x50 // versión 5 (derivado de un nombre)
  b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
  const h = [...b.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

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
    if (readErr) { obs('checkout', 'internal_error', { code: 'db_read_error', error: readErr }); return new Response('db_read_error', { status: 500 }) } // 500 → Stripe reintenta

    // Valida estado e IMPORTE contra el pedido antes de marcar pagado.
    const decision = evaluarPago(
      { payment_status: session.payment_status, amount_total: session.amount_total, metadata: session.metadata ?? undefined },
      order ? { total: order.total, payment_status: order.payment_status } : null,
    )
    if (!decision.marcar) {
      console.warn('[stripe-webhook] no se marca pagado:', decision.reason, { orderId })
      return ok({ received: true, ignored: decision.reason }) // evento procesado; no reintentar
    }

    // COMANDO: el cobro entra al libro. `payment_status` lo recalcula el servidor desde
    // los asientos; esta función NO lo escribe.
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : null
    const opId = await opIdDeSesion(session.id ?? pi ?? orderId)
    const monto = session.amount_total != null ? session.amount_total / 100 : Number(order?.total ?? 0)
    const { data: res, error: cobroErr } = await admin.rpc('registrar_cobro', {
      p_op_id: opId,
      p_order: orderId,
      p_method: 'stripe',
      p_amount: monto,
      p_reference: session.id ?? pi ?? undefined,
      p_evidence: pi ?? undefined,
    })
    if (cobroErr) {
      // OP_ID_REUTILIZADO / asiento duplicado = ya estaba registrado: evento procesado.
      if (/OP_ID_REUTILIZADO|uq_entry_external_ref|duplicate key/i.test(cobroErr.message)) {
        return ok({ received: true, ignored: 'already_recorded' })
      }
      console.error('[stripe-webhook] registrar_cobro', cobroErr.message, { orderId })
      obs('checkout', 'internal_error', { code: 'rpc_error', error: cobroErr })
      return new Response('rpc_error', { status: 500 }) // 500 → Stripe reintenta
    }

    // Avanza el pedido a 'paid' solo si el libro dice que quedó pagado (un cobro insuficiente
    // deja el pedido en 'parcial' y no libera nada). `status` es flujo, no dinero.
    if ((res as { payment_status?: string } | null)?.payment_status === 'paid') {
      const { error: stErr } = await admin.from('orders').update({ status: 'paid' }).eq('id', orderId).eq('status', 'pending_payment')
      if (stErr) { obs('checkout', 'internal_error', { code: 'db_update_error', error: stErr }); return new Response('db_update_error', { status: 500 }) }
    }
  }

  return ok({ received: true })
})
