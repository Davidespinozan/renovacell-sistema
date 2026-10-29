// POST /stryv-care — suscripción mensual "STRYV Care" (mantenimiento y soporte del sistema; la infraestructura externa
// la paga Renovacell directamente), cobrada por STRYV
// en SU cuenta de Stripe, no en la de Renovacell. Mismo diseño que en Fukuroll (fukuroll/supabase/functions/stryv-care).
//   { action: 'status' }   → estado de la suscripción, próximo cobro, tarjeta y últimos recibos
//   { action: 'checkout' } → página segura de Stripe para poner la tarjeta y suscribirse → { url }
//   { action: 'portal' }   → portal de Stripe para cambiar tarjeta o descargar recibos → { url }
// Solo Dirección (rol admin, cuenta activa). El producto, el precio y la configuración del portal se crean solos la
// primera vez (lookup_key / metadata estables), sin pasos manuales en el panel de Stripe.
//
// Llave PROPIA: STRYV_CARE_STRIPE_SECRET_KEY (la cuenta de STRYV). A propósito NO es STRIPE_SECRET_KEY, que en este
// proyecto pertenece al cobro a doctores (stripe-checkout) y sigue apagado: activar STRYV Care nunca debe encender eso.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import Stripe from 'npm:stripe@17'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const PRECIO_CENTAVOS = Number(Deno.env.get('STRYV_CARE_CENTAVOS') ?? '250000')   // $2,500 MXN al mes
const LOOKUP = `stryv_care_mxn_mensual_${PRECIO_CENTAVOS}`
const TENANT = 'renovacell'   // cliente de STRYV; la misma cuenta de Stripe atiende a varios sistemas
const ADMIN_URL = Deno.env.get('STRYV_CARE_RETURN_URL') || 'https://sistema-renovacell.netlify.app'
const ORIGENES = new Set([ADMIN_URL, 'https://sistema-renovacell.netlify.app', 'https://sistema.renovacell.mx', 'http://localhost:5173', 'http://localhost:4190'])
const ACTIVAS = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])

function getStripe(): Stripe | null {
  const key = Deno.env.get('STRYV_CARE_STRIPE_SECRET_KEY')
  return key ? new Stripe(key) : null
}

async function precio(stripe: Stripe): Promise<string> {
  const ya = await stripe.prices.list({ lookup_keys: [LOOKUP], active: true, limit: 1 })
  if (ya.data[0]) return ya.data[0].id
  const p = await stripe.prices.create({
    currency: 'mxn', unit_amount: PRECIO_CENTAVOS, recurring: { interval: 'month' }, lookup_key: LOOKUP,
    product_data: { name: 'STRYV Care', metadata: { app: 'stryv-care' } },
    metadata: { app: 'stryv-care' },
  }, { idempotencyKey: `stryv-care-price-${LOOKUP}` })
  return p.id
}

// Configuración propia del portal (no la predeterminada de la cuenta, que usan otras apps de STRYV): solo cambiar
// tarjeta y ver/descargar recibos. Se crea una vez y se reutiliza (se identifica por metadata).
async function portalConfig(stripe: Stripe): Promise<string> {
  const l = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  const ya = l.data.find((c) => c.metadata?.app === 'stryv-care')
  if (ya) return ya.id
  const c = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'STRYV Care · mantenimiento y soporte' },
    features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true } },
    metadata: { app: 'stryv-care' },
  })
  return c.id
}

async function cliente(stripe: Stripe, crear: boolean, email: string | null): Promise<Stripe.Customer | null> {
  const r = await stripe.customers.search({ query: `metadata['stryv_care_tenant']:'${TENANT}'`, limit: 1 })
  if (r.data[0]) return r.data[0]
  if (!crear) return null
  return await stripe.customers.create({ name: 'Renovacell', email: email ?? undefined, metadata: { app: 'stryv-care', stryv_care_tenant: TENANT, tenant: TENANT } },
    { idempotencyKey: `stryv-care-customer-${TENANT}` })
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    if (!tieneRol(q.quien, ['admin'])) return json(403, { error: 'Solo Dirección puede ver STRYV Care.' })

    const { action } = await req.json().catch(() => ({ action: 'status' }))
    const stripe = getStripe()
    if (!stripe) return json(200, { estado: 'no_disponible' })
    const origin = req.headers.get('origin') || ''
    const base = ORIGENES.has(origin) ? origin : ADMIN_URL

    if (action === 'checkout' || action === 'portal') {
      const c = await cliente(stripe, true, q.quien.email)
      if (action === 'portal') {
        const s = await stripe.billingPortal.sessions.create({ customer: c!.id, configuration: await portalConfig(stripe), return_url: `${base}/?care=volver` })
        return json(200, { url: s.url })
      }
      const subs = await stripe.subscriptions.list({ customer: c!.id, status: 'all', limit: 10 })
      if (subs.data.some((x) => ACTIVAS.has(x.status) && x.status !== 'incomplete')) return json(409, { error: 'STRYV Care ya está activo.' })
      const s = await stripe.checkout.sessions.create({
        mode: 'subscription', customer: c!.id,
        line_items: [{ price: await precio(stripe), quantity: 1 }],
        subscription_data: { metadata: { app: 'stryv-care', stryv_care_tenant: TENANT } },
        metadata: { app: 'stryv-care', stryv_care_tenant: TENANT },
        locale: 'es',
        success_url: `${base}/?care=ok`, cancel_url: `${base}/?care=cancel`,
      })
      return json(200, { url: s.url })
    }

    // status
    const c = await cliente(stripe, false, null)
    const base0 = { estado: 'inactivo', monto_centavos: PRECIO_CENTAVOS, puede_activar: true }
    if (!c) return json(200, base0)
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 10, expand: ['data.default_payment_method'] })
    const sub = subs.data.find((x) => ACTIVAS.has(x.status) && x.status !== 'incomplete') ?? null
    const pm = (sub?.default_payment_method ?? null) as Stripe.PaymentMethod | null
    let recibos: { fecha: number; monto_centavos: number; estado: string | null; url: string | null }[] = []
    try {
      const inv = await stripe.invoices.list({ customer: c.id, limit: 6 })
      recibos = inv.data.map((i) => ({ fecha: i.created, monto_centavos: i.amount_paid || i.amount_due, estado: i.status, url: i.hosted_invoice_url ?? null }))
    } catch (e) { console.error('[stryv-care] invoices', e instanceof Error ? e.message : e) }
    // Stripe ≥ 2025 movió el fin de periodo al renglón de la suscripción; se lee de ahí con respaldo al campo viejo.
    const finPeriodo = (sub?.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end
      ?? (sub as unknown as { current_period_end?: number } | null)?.current_period_end ?? null
    return json(200, {
      ...base0,
      estado: sub ? sub.status : 'inactivo',
      proximo_cobro: sub && !sub.cancel_at_period_end ? finPeriodo : null,
      termina: sub?.cancel_at_period_end ? finPeriodo : null,
      tarjeta: pm?.card ? { marca: pm.card.brand, last4: pm.card.last4 } : null,
      recibos,
    })
  } catch (e) {
    console.error('[stryv-care]', e instanceof Error ? e.message : e)
    return json(500, { error: 'No pudimos consultar STRYV Care. Intenta de nuevo.' })
  }
}))
