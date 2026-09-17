// P0-CFDI (hardening) — un fallo de Facturama JAMÁS deja el pedido como CFDI emitido.
// Fuerzan la ruta BACKEND (mockeando lib/supabase con hasSupabase=true) y verifican que
// markInvoiced: (1) solo marca `timbrada` con UUID real tras éxito; (2) ante error de invoke
// deja invoice_meta=null e invoice_requested=true (reintentable) sin falso éxito; (3) ante
// 501/not_configured no persiste ningún CFDI falso; (4) el notify/logAudit "CFDI emitido"
// ocurre EXCLUSIVAMENTE tras el timbre real.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'order', 'maybeSingle', 'single']) {
    chain[m] = vi.fn(() => chain)
  }
  ;(chain as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  const from = vi.fn(() => chain)
  const invoke = vi.fn(async () => ({ data: { uuid: 'SAT-REAL-1', id: 'FAC-1' }, error: null }))
  const notify = vi.fn()
  const logAudit = vi.fn()
  return { chain, from, invoke, notify, logAudit }
})

vi.mock('../../lib/supabase', () => ({
  hasSupabase: true,
  currentUserId: () => 'd0000000-0000-4000-8000-000000000001',
  supabase: { from: h.from, functions: { invoke: h.invoke }, auth: { onAuthStateChange: vi.fn() } },
}))
vi.mock('./notificationsStore', () => ({ notify: h.notify }))
vi.mock('./auditStore', () => ({ logAudit: h.logAudit }))
vi.mock('./lotsStore', () => ({ restockByReference: vi.fn() }))

import { markInvoiced } from './ordersStore'

const ORDER = 'a0000000-0000-4000-8000-0000000000cf'
const tick = () => new Promise((r) => setTimeout(r, 0))

// La última llamada a orders.update(...) es la persistencia decidida por markInvoiced.
const lastUpdatePayload = (): Record<string, unknown> => {
  const calls = h.chain.update.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}
// Un error de invoke tipo FunctionsHttpError: el detalle vive en context.json().
const httpError = (message: string) => ({
  message: `Edge Function returned a non-2xx status`,
  context: { json: async () => ({ message }) },
})

beforeEach(() => {
  h.chain.update.mockClear()
  h.from.mockClear()
  h.invoke.mockClear()
  h.notify.mockClear()
  h.logAudit.mockClear()
  h.invoke.mockResolvedValue({ data: { uuid: 'SAT-REAL-1', id: 'FAC-1' }, error: null } as never)
})

describe('markInvoiced · un fallo de Facturama nunca deja CFDI emitido', () => {
  it('1) ÉXITO real → persiste status=timbrada, UUID real, facturama_id real, simulated=false', async () => {
    markInvoiced(ORDER)
    await tick()
    const meta = lastUpdatePayload().invoice_meta as Record<string, unknown>
    expect(meta).toMatchObject({ status: 'timbrada', uuid: 'SAT-REAL-1', facturama_id: 'FAC-1', simulated: false })
    expect(lastUpdatePayload().invoice_requested).toBe(true)
  })

  it('2) ERROR de invoke → invoice_meta=null, invoice_requested=true (reintentable), sin falso éxito', async () => {
    h.invoke.mockResolvedValueOnce({ data: null, error: httpError('RFC del receptor inválido') } as never)
    markInvoiced(ORDER)
    await tick()
    const payload = lastUpdatePayload()
    expect(payload.invoice_meta).toBeNull() // no queda emitido → reintentable
    expect(payload.invoice_requested).toBe(true)
    // Nunca se generó un UUID/folio falso ni un status 'emitida'/'timbrada'.
    expect(payload.invoice_meta).not.toMatchObject({ status: 'emitida' })
    // No hubo aviso/auditoría de éxito; sí se notificó el error real.
    expect(h.logAudit).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('CFDI emitido') }))
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('RFC del receptor inválido') }))
  })

  it('3) 501/not_configured → no persiste ningún CFDI falso (invoice_meta=null) y no ruidea al admin', async () => {
    h.invoke.mockResolvedValueOnce({ data: null, error: httpError('not_configured') } as never)
    markInvoiced(ORDER)
    await tick()
    expect(lastUpdatePayload().invoice_meta).toBeNull()
    expect(h.logAudit).not.toHaveBeenCalled()
    // not_configured es estado de demo, no un fallo: no se notifica (ni de éxito ni de error).
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('4) notify/logAudit "CFDI emitido" SOLO tras el timbre real', async () => {
    // Primero un fallo: no debe avisar ni auditar éxito.
    h.invoke.mockResolvedValueOnce({ data: null, error: httpError('El emisor requiere régimen fiscal') } as never)
    markInvoiced(ORDER)
    await tick()
    expect(h.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'CFDI emitido' }))
    expect(h.notify).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('CFDI emitido') }))

    // Ahora un éxito real: recién entonces avisa y audita.
    h.notify.mockClear()
    h.logAudit.mockClear()
    markInvoiced(ORDER)
    await tick()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('CFDI emitido') }))
    expect(h.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CFDI emitido' }))
  })
})
