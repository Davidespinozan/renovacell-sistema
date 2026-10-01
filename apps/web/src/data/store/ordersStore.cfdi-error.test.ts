// P0-CFDI · W3-A — EL CLIENTE YA NO DECIDE NADA FISCAL.
//
// Este archivo probaba el comportamiento anterior: ante un fallo, markInvoiced escribía
// `invoice_meta = null` y dejaba `invoice_requested = true` "para reintentar". Esa pareja
// de escrituras ERA el mecanismo P0: en un timeout DESPUÉS de que el PAC ya hubiera timbrado,
// borraba el folio real y volvía a habilitar la emisión → segundo CFDI ante el SAT.
//
// Las pruebas se reescriben sobre los invariantes nuevos, que son estrictamente más fuertes:
//   1) markInvoiced NO invoca la Edge Function de timbrado;
//   2) NO escribe invoice_meta ni invoice_requested, ni en éxito ni en fallo;
//   3) pasa por el comando del servidor (solicitar_cfdi) y respeta lo que este responda;
//   4) "CFDI emitido" ya no se anuncia desde el cliente: el cliente solo registra la solicitud.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'maybeSingle', 'single']) {
    chain[m] = vi.fn(() => chain)
  }
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  const from = vi.fn(() => chain)
  const invoke = vi.fn(async () => ({ data: null, error: null }))
  const rpc = vi.fn(async () => ({ data: { status: 'applied', doc_id: 'd-1' }, error: null }))
  const notify = vi.fn()
  const logAudit = vi.fn()
  return { chain, from, invoke, rpc, notify, logAudit }
})

vi.mock('../../lib/supabase', () => ({
  hasSupabase: true,
  currentUserId: () => 'd0000000-0000-4000-8000-000000000001',
  supabase: { from: h.from, rpc: h.rpc, functions: { invoke: h.invoke }, auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./notificationsStore', () => ({ notify: h.notify }))
vi.mock('./auditStore', () => ({ logAudit: h.logAudit }))
vi.mock('./lotsStore', () => ({ restockByReference: vi.fn() }))

import { markInvoiced } from './ordersStore'

const ORDER = 'a0000000-0000-4000-8000-0000000000cf'

// Toda escritura que el store haya intentado sobre la tabla `orders`.
const updatePayloads = (): Record<string, unknown>[] =>
  h.chain.update.mock.calls.map((c) => c[0] as Record<string, unknown>)

beforeEach(() => {
  h.chain.update.mockClear(); h.from.mockClear(); h.invoke.mockClear()
  h.rpc.mockClear(); h.notify.mockClear(); h.logAudit.mockClear()
  h.rpc.mockResolvedValue({ data: { status: 'applied', doc_id: 'd-1' }, error: null } as never)
})

describe('markInvoiced · el cliente registra la intención, no timbra', () => {
  it('1) NO invoca la Edge Function de timbrado', async () => {
    await markInvoiced(ORDER)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('2) pasa por el comando del servidor con un identificador de operación', async () => {
    await markInvoiced(ORDER)
    expect(h.rpc).toHaveBeenCalledWith('solicitar_cfdi', expect.objectContaining({ p_order_id: ORDER }))
    const args = h.rpc.mock.calls[0] as unknown as [string, { p_op_id?: string }]
    expect(args[1].p_op_id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('3) NO escribe evidencia fiscal sobre el pedido (el P0, cerrado)', async () => {
    await markInvoiced(ORDER)
    for (const p of updatePayloads()) {
      expect(p).not.toHaveProperty('invoice_meta')
      expect(p).not.toHaveProperty('invoice_requested')
    }
  })

  it('4) ante un FALLO del servidor tampoco borra ni fabrica evidencia', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DATOS_FISCALES_REQUERIDOS: faltan datos' } } as never)
    const r = await markInvoiced(ORDER)
    expect(r.ok).toBe(false)
    for (const p of updatePayloads()) {
      expect(p).not.toHaveProperty('invoice_meta')
      expect(p).not.toHaveProperty('invoice_requested')
    }
    // Y el mensaje que ve el operador está en español, sin tokens internos.
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Faltan datos fiscales'),
    }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('DATOS_FISCALES_REQUERIDOS'),
    }))
    expect(h.logAudit).not.toHaveBeenCalled()
  })

  it('5) un resultado AMBIGUO (timeout de red) no invita a duplicar', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } } as never)
    const r = await markInvoiced(ORDER)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/NO la duplicará/)
    for (const p of updatePayloads()) expect(p).not.toHaveProperty('invoice_meta')
  })

  it('6) si el servidor dice que YA está timbrado, se informa sin reintentar', async () => {
    h.rpc.mockResolvedValueOnce({ data: { status: 'already_stamped', doc_id: 'd-1' }, error: null } as never)
    const r = await markInvoiced(ORDER)
    expect(r.status).toBe('already_stamped')
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('ya tiene CFDI emitido'),
    }))
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('7) el cliente NO anuncia "CFDI emitido": solo que la solicitud quedó registrada', async () => {
    await markInvoiced(ORDER)
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('CFDI emitido'),
    }))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Factura solicitada'),
    }))
    expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'Solicitud de CFDI registrada' }))
  })
})
