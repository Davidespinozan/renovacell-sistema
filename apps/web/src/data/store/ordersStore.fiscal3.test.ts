// SEC-C4-FISCAL-3-FE · createOrder con factura = UNA llamada (crear_pedido_con_receptor), UNA transacción.
// Sin factura = contrato histórico (crear_pedido) sin receptor. Nunca set_order_fiscal_snapshot después.
// Reintentos: mismo id y folio si quien llama pasa la misma operación; incierto ⇒ sin lecturas ni adivinanzas.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'range', 'limit', 'maybeSingle', 'single']) chain[m] = vi.fn(() => chain)
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res)
  const rpc = vi.fn()
  const from = vi.fn(() => chain)
  return { chain, rpc, from }
})
vi.mock('../../lib/supabase', () => ({
  hasSupabase: true,
  currentUserId: () => 'd0000000-0000-4000-8000-000000000001',
  supabase: { rpc: h.rpc, from: h.from, auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./notificationsStore', () => ({ notify: vi.fn() }))
vi.mock('./auditStore', () => ({ logAudit: vi.fn() }))
vi.mock('./lotsStore', () => ({ restockByReference: vi.fn() }))

import { createOrder, getSnapshotAll, CONFLICTO_PEDIDO_MSG, INCIERTO_PEDIDO_MSG, SESION_PEDIDO_MSG } from './ordersStore'
import { notify } from './notificationsStore'
import { limpiarFallos, getFallosSnapshot } from './escritura'
import fuente from './ordersStore.ts?raw'

const CUENTA = 'c0000000-0000-4000-8000-0000000000c1'
const PROD = 'a0000000-0000-4000-8000-0000000000ab'
const OP = { id: 'f3000000-0000-4000-8000-000000000001', folio: 'S900001' }
const REC = { rfc: ' xaxx010101000 ', razon_social: 'Cliente SA', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'FACTURA@Test.local' }
const REC_NORM = { rfc: 'XAXX010101000', razon_social: 'Cliente SA', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'factura@test.local' }
const conFactura = (extra: Record<string, unknown> = {}) => createOrder({
  lines: [{ product_id: PROD, qty: 2, unit_price: 1 }], total: 1, invoice_requested: true, customer_id: CUENTA, placedBy: 'Lucía (Ventas)',
  customer: { name: 'Cuenta', phone: null }, shipping: { line1: 'Calle 1', city: 'Culiacán', phone: '' }, receiver: REC, operacion: OP, ...extra,
})
const llamadas = () => h.rpc.mock.calls.map((c) => c[0] as string)
const ok = (d: Record<string, unknown> = {}) => ({ data: { order_id: OP.id, folio: 'S900001', total: 300, ...d }, error: null, status: 200 })
const err = (message: string, status = 400, code = 'P0001') => ({ data: null, error: { message, code }, status })

beforeEach(() => { h.rpc.mockReset(); h.from.mockClear(); vi.mocked(notify).mockClear(); limpiarFallos() })

describe('FISCAL-3-FE · selección de RPC y argumentos', () => {
  it('con factura: UNA sola llamada a crear_pedido_con_receptor con los 8 argumentos exactos', async () => {
    h.rpc.mockResolvedValueOnce(ok())
    const r = await conFactura()
    expect(r.ok).toBe(true)
    expect(llamadas()).toEqual(['crear_pedido_con_receptor'])
    const args = h.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual(['p_customer_id', 'p_doctor_id', 'p_folio', 'p_invoice_requested', 'p_lines', 'p_order_id', 'p_receiver', 'p_shipping_meta'])
    expect(args.p_order_id).toBe(OP.id); expect(args.p_folio).toBe(OP.folio); expect(args.p_invoice_requested).toBe(true)
    expect(args.p_customer_id).toBe(CUENTA); expect(args.p_doctor_id).toBeNull()
    expect(args.p_lines).toEqual([{ product_id: PROD, qty: 2 }])                    // sin precios ni total
    expect(args.p_receiver).toEqual(REC_NORM)                                        // exactamente 6 campos normalizados
    expect(args).not.toHaveProperty('p_total'); expect(JSON.stringify(args)).not.toMatch(/seller|status|uuid_cfdi|timbr|facturama/i)
  })
  it('con factura y receptor con campos extra: solo viajan los 6 del contrato', async () => {
    h.rpc.mockResolvedValueOnce(ok())
    await conFactura({ receiver: { ...REC, status: 'timbrada', cfdi_uuid: 'X', provider_id: 'Y' } })
    expect(Object.keys((h.rpc.mock.calls[0][1] as { p_receiver: object }).p_receiver).sort()).toEqual(['cp', 'email_facturacion', 'razon_social', 'regimen', 'rfc', 'uso_cfdi'])
  })
  it('con factura y SIN receptor: la llamada va igual (el servidor la rechaza), nunca crear_pedido a secas', async () => {
    h.rpc.mockResolvedValueOnce(err('DATOS_FISCALES_REQUERIDOS: el pedido solicita factura pero no trae los datos fiscales del receptor'))
    const r = await conFactura({ receiver: null })
    expect(llamadas()).toEqual(['crear_pedido_con_receptor'])
    expect((h.rpc.mock.calls[0][1] as { p_receiver: unknown }).p_receiver).toBeNull()
    expect(r.ok).toBe(false); if (!r.ok) expect(r.motivo).toBe('fiscal')
  })
  it('sin factura: contrato histórico crear_pedido, sin receptor, aunque llegue uno', async () => {
    h.rpc.mockResolvedValueOnce(ok())
    const r = await conFactura({ invoice_requested: false })
    expect(r.ok).toBe(true)
    expect(llamadas()).toEqual(['crear_pedido'])
    const args = h.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args).not.toHaveProperty('p_receiver'); expect(args.p_invoice_requested).toBe(false); expect(args.p_order_id).toBe(OP.id)
  })
  it('nunca se llama set_order_fiscal_snapshot tras crear (con o sin factura)', async () => {
    h.rpc.mockResolvedValue(ok())
    await conFactura(); await conFactura({ invoice_requested: false })
    expect(llamadas()).not.toContain('set_order_fiscal_snapshot')
    expect(h.chain.insert).not.toHaveBeenCalled(); expect(h.chain.update).not.toHaveBeenCalled()
  })
})

describe('FISCAL-3-FE · respuestas', () => {
  it('éxito: total y folio del servidor; el aviso de pedido nuevo lo emite el servidor (no el navegador)', async () => {
    h.rpc.mockResolvedValueOnce(ok({ folio: 'S123456', total: 450 }))
    const r = await conFactura()
    expect(r.ok && r.order.total).toBe(450); expect(r.ok && r.order.external_ref).toBe('S123456'); expect(r.ok && r.repetido).toBeFalsy()
    expect(notify).not.toHaveBeenCalled()   // 20270203: trigger trg_aviso_pedido_nuevo → Dirección y vendedor
  })
  it('repetido (idempotent): éxito marcado como repetido, con SU folio y total', async () => {
    h.rpc.mockResolvedValueOnce(ok({ idempotent: true, folio: 'S777777', total: 300 }))
    const r = await conFactura()
    expect(r.ok).toBe(true); if (r.ok) { expect(r.repetido).toBe(true); expect(r.order.external_ref).toBe('S777777') }
  })
  it('error fiscal: rechazo definitivo, sin pedido local ni aviso', async () => {
    const antes = getSnapshotAll().length
    h.rpc.mockResolvedValueOnce(err('FISCAL_INVALIDO: El RFC no tiene un formato válido'))
    const r = await conFactura()
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.motivo).toBe('fiscal'); expect(r.ambiguous).toBe(false); expect(r.error).toMatch(/datos fiscales no son válidos/) }
    expect(getSnapshotAll()).toHaveLength(antes); expect(notify).not.toHaveBeenCalled()
  })
  it('conflicto: mensaje genérico (sin folio, total ni datos del pedido ajeno); no es éxito', async () => {
    h.rpc.mockResolvedValueOnce(err('PEDIDO_EXISTENTE_CONFLICTO: ese identificador ya corresponde a otra solicitud de pedido'))
    const r = await conFactura()
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.motivo).toBe('conflicto'); expect(r.error).toBe(CONFLICTO_PEDIDO_MSG); expect(r.incierto).toBeFalsy() }
    expect(notify).not.toHaveBeenCalled()
  })
  it('autorización: "No autorizado" del servidor y cuenta ajena', async () => {
    h.rpc.mockResolvedValueOnce(err('No autorizado'))
    const a = await conFactura()
    h.rpc.mockResolvedValueOnce(err('CUENTA_NO_AUTORIZADA: el pedido solo puede crearse para tu propia cuenta', 403, '42501'))
    const b = await conFactura()
    for (const r of [a, b]) { expect(r.ok).toBe(false); if (!r.ok) { expect(r.motivo).toBe('autorizacion'); expect(r.ambiguous).toBe(false) } }
  })
  it('sesión expirada (401 / JWT): autorización, con mensaje de volver a entrar', async () => {
    h.rpc.mockResolvedValueOnce(err('JWT expired', 401, 'PGRST301'))
    const r = await conFactura()
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.motivo).toBe('autorizacion'); expect(r.error).toBe(SESION_PEDIDO_MSG) }
  })
  it('timeout / red: incierto, SIN consultar orders y SIN reintentar a ciegas', async () => {
    h.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    const r = await conFactura()
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.incierto).toBe(true); expect(r.ambiguous).toBe(true); expect(r.error).toBe(INCIERTO_PEDIDO_MSG); expect(r.error).not.toMatch(/NO se registró/) }
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.from).not.toHaveBeenCalledWith('orders')
    expect(getFallosSnapshot()[0].ambiguous).toBe(true)
  })
  it('respuesta 5xx sin código: incierto', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'upstream error' }, status: 503 })
    const r = await conFactura()
    expect(!r.ok && r.incierto).toBe(true)
  })
  it('reintento: misma operación ⇒ mismo id y folio en cada envío', async () => {
    h.rpc.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(ok({ idempotent: true }))
    await conFactura(); const r = await conFactura()
    expect(r.ok && r.repetido).toBe(true)
    const [a, b] = h.rpc.mock.calls.map((c) => c[1] as { p_order_id: string; p_folio: string })
    expect(b.p_order_id).toBe(a.p_order_id); expect(b.p_folio).toBe(a.p_folio)
  })
  it('sin operación explícita: cada llamada es una operación nueva (contrato anterior de createOrder)', async () => {
    h.rpc.mockResolvedValue(ok())
    await createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1 }], total: 1, invoice_requested: false, customer_id: CUENTA })
    await createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1 }], total: 1, invoice_requested: false, customer_id: CUENTA })
    const [a, b] = h.rpc.mock.calls.map((c) => (c[1] as { p_order_id: string }).p_order_id)
    expect(a).not.toBe(b)
  })
})

describe('FISCAL-3-FE · guardas de fuente', () => {
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  it('createOrder ya no escribe el receptor en una segunda llamada ni reporta "fiscalPendiente"', () => {
    const cuerpo = codigo.slice(codigo.indexOf('export async function createOrder'), codigo.indexOf('const CANCELABLE'))
    expect(cuerpo).not.toMatch(/set_order_fiscal_snapshot|fiscalPendiente|upsert_customer_fiscal|customer_fiscal/)
    expect(cuerpo.match(/supabase\.rpc\('crear_pedido_con_receptor'/g)).toHaveLength(1)
    expect(cuerpo.match(/supabase\.rpc\('crear_pedido'/g)).toHaveLength(1)
  })
  it('setOrderFiscalSnapshot (Facturación) sigue existiendo para correcciones', () => {
    expect(codigo).toMatch(/export async function setOrderFiscalSnapshot/)
  })
})
