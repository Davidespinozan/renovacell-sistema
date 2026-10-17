// ENT-2 · createOrder con entrega = UNA llamada a crear_pedido_con_entrega (pedido + receptor + entrega en una transacción).
// Viaja el id de la opción (y el flete con motivo solo si el vendedor lo cambió); el total que se asienta es el del servidor.
import { describe, it, expect, beforeEach, vi } from 'vitest'
const h = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'order', 'in', 'limit']) chain[k] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null }); chain.then = (r: (v: unknown) => void) => r({ data: [], error: null })
  return { rpc: vi.fn(), from: vi.fn(() => chain) }
})
vi.mock('../../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'U-1', supabase: { rpc: h.rpc, from: h.from, auth: { onAuthStateChange: vi.fn() } } }))
vi.mock('./notificationsStore', () => ({ notify: vi.fn() }))
vi.mock('./auditStore', () => ({ logAudit: vi.fn() }))
vi.mock('./lotsStore', () => ({ restockByReference: vi.fn() }))
import { createOrder } from './ordersStore'

const CUENTA = '11111111-1111-4111-8111-111111111111'; const PROD = '22222222-2222-4222-8222-222222222222'
const OP = { id: '33333333-3333-4333-8333-333333333333', folio: 'S000001' }
beforeEach(() => { h.rpc.mockReset() })

describe('ENT-2 · createOrder con entrega', () => {
  it('sin factura: crear_pedido_con_entrega con 9 argumentos, receptor nulo y la entrega tal cual', async () => {
    h.rpc.mockResolvedValueOnce({ data: { order_id: OP.id, folio: 'S100005', total: 2600, subtotal: 2000, envio: 600, entrega: { opcion: 'foraneo_dhl' } }, error: null })
    const r = await createOrder({ lines: [{ product_id: PROD, qty: 2, unit_price: 1000 }], total: 2000, invoice_requested: false, customer_id: CUENTA, shipping: { line1: 'Calle 1', cp: '82000', city: 'Mazatlán', phone: '6690000000' }, operacion: OP, entrega: { opcion: 'foraneo_dhl' } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(['crear_pedido_con_entrega'])
    const args = h.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual(['p_customer_id', 'p_doctor_id', 'p_entrega', 'p_folio', 'p_invoice_requested', 'p_lines', 'p_order_id', 'p_receiver', 'p_shipping_meta'])
    expect(args.p_entrega).toEqual({ opcion: 'foraneo_dhl' }); expect(args.p_receiver).toBeNull(); expect(args.p_invoice_requested).toBe(false)
    expect(args.p_lines).toEqual([{ product_id: PROD, qty: 2 }])
    expect(r.order.total).toBe(2600); expect(r.order.external_ref).toBe('S100005')   // total del servidor (con flete) y su folio
  })
  it('con factura y flete ajustado: receptor normalizado + {opcion, flete, motivo}; el rechazo ENTREGA_* se explica', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'ENTREGA_AJUSTE_SIN_MOTIVO: para cambiar el flete escribe el motivo', code: 'P0001' } })
    const r = await createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1000 }], total: 1000, invoice_requested: true, customer_id: CUENTA, operacion: OP,
      receiver: { rfc: 'XAXX010101000', razon_social: 'Público', regimen: '616', cp: '80000', uso_cfdi: 'S01', email_facturacion: 'a@b.mx' }, entrega: { opcion: 'foraneo_dhl', flete: 0, motivo: '' } })
    expect(r.ok).toBe(false); if (r.ok) return
    expect(r.motivo).toBe('rechazo'); expect(r.incierto).toBeFalsy(); expect(r.error).toMatch(/motivo/)
    const args = h.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args.p_invoice_requested).toBe(true); expect((args.p_receiver as { rfc: string }).rfc).toBe('XAXX010101000'); expect(args.p_entrega).toEqual({ opcion: 'foraneo_dhl', flete: 0, motivo: '' })
  })
  it('sin entrega: el contrato anterior no cambia (crear_pedido)', async () => {
    h.rpc.mockResolvedValueOnce({ data: { order_id: OP.id, folio: OP.folio, total: 1000 }, error: null })
    await createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1000 }], total: 1000, invoice_requested: false, customer_id: CUENTA, operacion: OP })
    expect(h.rpc.mock.calls.map((c) => c[0])).toEqual(['crear_pedido'])
  })
})
