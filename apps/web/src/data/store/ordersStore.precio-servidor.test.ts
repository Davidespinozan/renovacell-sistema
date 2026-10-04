// P0-A (auditoría de cierre) — EL FRONTEND NO ES AUTORIDAD DEL PRECIO.
// Estos tests fuerzan la ruta BACKEND (mockeando lib/supabase con hasSupabase=true) y
// demuestran que el cliente: (1) solo manda {product_id, qty} al RPC crear_pedido —nunca
// unit_price ni total—, (2) no inserta orders/order_items directo, (3) refleja/queda con lo
// que decide el servidor y (4) revierte el pedido optimista si el servidor rechaza.
// La autoridad REAL del precio (calcular 13500 aunque el cliente mande 1, rechazar producto
// sin precio, cantidad<=0, lista ajena) se prueba en el self-test SQL de la migración
// 20260915120000_p0_precio_servidor.sql (precio_de + crear_pedido no reciben precio por firma).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'maybeSingle', 'single']) {
    chain[m] = vi.fn(() => chain)
  }
  // Lo que responde una lectura/escritura directa a tabla. Configurable: W4 necesita
  // simular la VERIFICACIÓN posterior a un resultado desconocido.
  const tabla: { data: unknown; error: unknown } = { data: null, error: null }
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: tabla.data, error: tabla.error }).then(res)
  const rpc = vi.fn(async () => ({ data: { order_id: 'srv', total: 13500, items: [] }, error: null }))
  const from = vi.fn(() => chain)
  return { chain, rpc, from, tabla }
})

vi.mock('../../lib/supabase', () => ({
  hasSupabase: true,
  currentUserId: () => 'd0000000-0000-4000-8000-000000000001',
  supabase: { rpc: h.rpc, from: h.from, auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./notificationsStore', () => ({ notify: vi.fn() }))
vi.mock('./auditStore', () => ({ logAudit: vi.fn() }))
vi.mock('./lotsStore', () => ({ restockByReference: vi.fn() }))

import { createOrder, getSnapshotAll } from './ordersStore'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { getFallosSnapshot, limpiarFallos } from './escritura'

const DOCTOR = 'd0000000-0000-4000-8000-000000000001'
const PROD = 'a0000000-0000-4000-8000-0000000000ab'

beforeEach(() => {
  h.rpc.mockClear()
  h.chain.insert.mockClear()
  h.tabla.data = null; h.tabla.error = null
  vi.mocked(notify).mockClear(); vi.mocked(logAudit).mockClear()
  limpiarFallos()
  h.rpc.mockResolvedValue({ data: { order_id: 'srv', total: 13500, items: [] }, error: null } as never)
})

describe('P0-A · el frontend NO es autoridad del precio', () => {
  it('manda SOLO {product_id, qty} al RPC crear_pedido — nunca unit_price ni total', async () => {
    // Cliente intenta manipular: unit_price=1 y total=1 para un producto caro.
    await createOrder({ lines: [{ product_id: PROD, qty: 3, unit_price: 1 }], total: 1, invoice_requested: false, doctor_id: DOCTOR })
    expect(h.rpc).toHaveBeenCalledTimes(1)
    const [name, args] = h.rpc.mock.calls[0] as unknown as [string, { p_total?: unknown; p_lines: Array<Record<string, unknown>> }]
    expect(name).toBe('crear_pedido')
    // El payload no lleva total ni precio: es imposible que el cliente los imponga.
    expect(args).not.toHaveProperty('p_total')
    for (const l of args.p_lines) {
      expect(l).toHaveProperty('product_id')
      expect(l).toHaveProperty('qty')
      expect(l).not.toHaveProperty('unit_price')
      expect(l).not.toHaveProperty('price')
    }
    // Tampoco manda la lista de precios: la elige el servidor desde el perfil del doctor.
    expect(args).not.toHaveProperty('p_list')
  })

  it('NO inserta orders/order_items directo desde el cliente (todo pasa por el RPC)', async () => {
    await createOrder({ lines: [{ product_id: PROD, qty: 2, unit_price: 999 }], total: 999, invoice_requested: false, doctor_id: DOCTOR })
    expect(h.chain.insert).not.toHaveBeenCalled()
  })

  it('el pedido confirmado lleva el TOTAL DEL SERVIDOR, no el que mandó el cliente', async () => {
    const r = await createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1 }], total: 1, invoice_requested: false, doctor_id: DOCTOR })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.order.total).toBe(13500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// W4-01 · UN PEDIDO SOLO "SE CREÓ" CUANDO EL SERVIDOR LO DIJO.
// Antes el store devolvía el pedido, avisaba a Almacén y escribía la bitácora ANTES
// de la respuesta; un rechazo dejaba un aviso de un pedido que no existía.
// ─────────────────────────────────────────────────────────────────────────────
describe('W4-01 · createOrder dice la verdad', () => {
  const pedir = () => createOrder({ lines: [{ product_id: PROD, qty: 1, unit_price: 1 }], total: 1, invoice_requested: false, doctor_id: DOCTOR })

  it('RECHAZADO: no hay éxito, no aparece en pantalla, no se avisa a Almacén ni se audita', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PRODUCTO_INACTIVO: ese producto ya no se vende', code: 'P0001' } } as never)
    const antes = getSnapshotAll().length
    const r = await pedir()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.ambiguous).toBe(false)
    expect(getSnapshotAll()).toHaveLength(antes)
    expect(notify).not.toHaveBeenCalled()
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('RECHAZADO: el motivo queda visible en la franja global, no en la consola', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } } as never)
    const r = await pedir()
    expect(r.ok).toBe(false)
    const f = getFallosSnapshot()
    expect(f).toHaveLength(1)
    expect(f[0].que).toMatch(/crear el pedido/)
    // Y nunca el texto crudo de Postgres.
    expect(f[0].error).toBe('No tienes permiso para esta operación.')
    expect(f[0].error).not.toMatch(/row-level|policy|violates/)
  })

  it('CONFIRMADO: solo entonces se avisa a Almacén y se audita', async () => {
    const r = await pedir()
    expect(r.ok).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(getFallosSnapshot()).toHaveLength(0)
  })

  it('DESCONOCIDO pero el servidor SÍ lo tiene: es éxito, no se manda a crear otro', async () => {
    h.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    h.tabla.data = { id: 'x', total: 13500 }
    const r = await pedir()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.order.total).toBe(13500)
    expect(h.rpc).toHaveBeenCalledTimes(1) // no reintentó a ciegas
  })

  it('DESCONOCIDO y el servidor NO lo tiene: fallo claro, se puede reintentar', async () => {
    h.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    h.tabla.data = null
    const r = await pedir()
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.ambiguous).toBe(false); expect(r.error).toMatch(/NO se registró/) }
    expect(notify).not.toHaveBeenCalled()
  })

  it('DESCONOCIDO y tampoco se puede verificar: NO se convierte en éxito ni en fracaso', async () => {
    h.rpc.mockRejectedValueOnce(new Error('Failed to fetch'))
    h.tabla.error = { message: 'Failed to fetch' }
    const r = await pedir()
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.ambiguous).toBe(true); expect(r.error).toMatch(/Revisa en "Pedidos" antes de crearlo otra vez/) }
    expect(getFallosSnapshot()[0].ambiguous).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
})
