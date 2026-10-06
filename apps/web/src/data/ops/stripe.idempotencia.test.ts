// PREFLIGHT CC · Idempotencia de stripe-checkout SIN Stripe real: la clave se deriva de pedido +
// huella SHA-256 de los parámetros (misma orden + mismos parámetros → misma clave; parámetros
// distintos → otra clave); la Edge no escribe pagos ni marca paid (eso sigue en el webhook W2).
import { describe, it, expect } from 'vitest'
import src from '../../../../../supabase/functions/stripe-checkout/index.ts?raw'
// Misma derivación que la Edge (WebCrypto, 12 bytes → 24 hex), sin dependencias de Node.
const huella = async (texto: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
const clave = async (orderId: string, params: Record<string, unknown>) => `checkout:${orderId}:${await huella(JSON.stringify(params))}`
const params = (over: Record<string, unknown> = {}) => ({ mode: 'payment', line_items: [{ price_data: { currency: 'mxn', product_data: { name: 'Pedido S100001' }, unit_amount: 250000 }, quantity: 1 }], metadata: { order_id: 'o1' }, success_url: 'https://sistema.renovacell.mx/sistema?pago=ok', cancel_url: 'https://sistema.renovacell.mx/sistema/pedidos', ...over })

describe('stripe-checkout · idempotencia', () => {
  it('la Edge pasa idempotencyKey = checkout:<order>:<huella(params)> a sessions.create y no toca la verdad de pago', () => {
    const codigo = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    expect(codigo).toMatch(/const idempotencyKey = `checkout:\$\{order\.id\}:\$\{await huella\(JSON\.stringify\(params\)\)\}`/)
    expect(codigo).toMatch(/stripe\.checkout\.sessions\.create\(params, \{ idempotencyKey \}\)/)
    expect(codigo).toMatch(/slice\(0, 12\)\.map\(\(b\) => b\.toString\(16\)\.padStart\(2, '0'\)\)/)   // 12 bytes = 24 hex
    expect(codigo).not.toMatch(/payment_entries|registrar_cobro|payment_status: 'paid'|\.update\(\{ payment_status/)
    expect(codigo).toMatch(/if \(order\.payment_status === 'paid'\) return json\(400/)
  })
  it('mismo pedido + mismos parámetros + reintento → misma clave; monto o URL distintos → otra clave; otro pedido → otra clave', async () => {
    const k1 = await clave('o1', params()); const k2 = await clave('o1', params()); const k3 = await clave('o1', params({ cancel_url: 'https://sistema.renovacell.mx/otra' }))
    const k4 = await clave('o1', { ...params(), line_items: [{ ...params().line_items[0], price_data: { ...params().line_items[0].price_data, unit_amount: 260000 } }] }); const k5 = await clave('o2', params())
    expect(k1).toBe(k2); expect(k1).toMatch(/^checkout:o1:[0-9a-f]{24}$/)
    expect(new Set([k1, k3, k4, k5]).size).toBe(4)
  })
})
