// ============================================================================
// Proveedor de COBROS — frontera intercambiable (UI-first, mock).
//
// HOY: un mock que responde con la forma de un cargo de Stripe (PaymentIntent).
// La función es async (devuelve Promesa) como la API real e incluye latencia.
//
// MAÑANA (fase Supabase + Stripe): se reemplaza el CUERPO de processPayment por
// la confirmación de un PaymentIntent. El dato de la tarjeta lo tokeniza
// Stripe.js en el navegador y NUNCA toca nuestro servidor; el cobro se confirma
// en una Edge Function con la llave SECRETA protegida, y el webhook de Stripe
// marca el pedido como pagado. La firma no cambia → la UI queda igual.
// ============================================================================

export type PayMethod = 'tarjeta' | 'transferencia'

export interface PayRequest {
  orderRef: string
  amount: number
  currency: string            // 'MXN'
  method: PayMethod
  card?: { number: string; name: string } // mock; en prod lo maneja Stripe.js
}

export interface PayResult {
  ok: boolean
  id: string                  // id del cargo (mock) ~ Stripe pi_...
  method: PayMethod
  brand?: string              // 'Visa' | 'Mastercard'
  last4?: string
  paidAt: string              // ISO
  error?: string
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Hash determinista para ids estables del mock (sin Math.random).
function seedFrom(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// PROCESAR PAGO: confirma el cobro y devuelve la referencia (mock realista).
export async function processPayment(req: PayRequest): Promise<PayResult> {
  await wait(1100) // simula la confirmación del cargo
  const seed = seedFrom(`${req.orderRef}-${req.amount}-${req.method}`)
  const id = `pi_${(seed >>> 0).toString(16).padStart(8, '0')}${((seed * 7) >>> 0).toString(16).padStart(6, '0')}`
  const paidAt = new Date().toISOString()

  if (req.method === 'tarjeta') {
    const digits = (req.card?.number ?? '').replace(/\D/g, '')
    const last4 = digits.slice(-4) || '4242'
    const brand = digits.startsWith('5') ? 'Mastercard' : 'Visa'
    return { ok: true, id, method: 'tarjeta', brand, last4, paidAt }
  }
  return { ok: true, id, method: 'transferencia', paidAt }
}
