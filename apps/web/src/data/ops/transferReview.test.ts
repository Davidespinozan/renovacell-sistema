// Matriz de idempotencia/transiciones de la revisión de transferencias. Es el contrato
// que la RPC review_transfer_payment y el store mock deben cumplir por igual.
import { describe, it, expect } from 'vitest'
import { decideTransferReview, effectiveReview, type ReviewState } from './transferReview'

const pending: ReviewState = { paymentStatus: 'pending', reported: true, reviewStatus: 'pending' }

describe('decideTransferReview — camino feliz', () => {
  it('confirmar un reporte pendiente → confirma y marca pagado', () => {
    expect(decideTransferReview(pending, 'confirm')).toEqual({ ok: true, effect: 'confirm', status: 'confirmed' })
  })
  it('rechazar un reporte pendiente con motivo → rechaza', () => {
    expect(decideTransferReview(pending, 'reject', 'no cayó el dinero')).toEqual({ ok: true, effect: 'reject', status: 'rejected' })
  })
  it('deriva "pending" desde reported cuando aún no hay review.status', () => {
    expect(effectiveReview({ paymentStatus: 'pending', reported: true })).toBe('pending')
    expect(decideTransferReview({ paymentStatus: 'pending', reported: true }, 'confirm')).toMatchObject({ effect: 'confirm' })
  })
})

describe('decideTransferReview — idempotencia', () => {
  const confirmed: ReviewState = { paymentStatus: 'paid', reported: false, reviewStatus: 'confirmed' }
  const rejected: ReviewState = { paymentStatus: 'pending', reported: false, reviewStatus: 'rejected' }

  it('confirmar dos veces = no-op (already_confirmed), sin doble efecto', () => {
    expect(decideTransferReview(confirmed, 'confirm')).toEqual({ ok: true, effect: 'noop', status: 'already_confirmed' })
  })
  it('confirmar cuando ya está pagado (aunque review no diga confirmed) = no-op', () => {
    expect(decideTransferReview({ paymentStatus: 'paid', reported: true, reviewStatus: 'pending' }, 'confirm'))
      .toMatchObject({ effect: 'noop', status: 'already_confirmed' })
  })
  it('rechazar dos veces = no-op (already_rejected)', () => {
    expect(decideTransferReview(rejected, 'reject', 'otra vez')).toEqual({ ok: true, effect: 'noop', status: 'already_rejected' })
  })
})

describe('decideTransferReview — transiciones inválidas (denegadas)', () => {
  it('rechazar después de confirmado → DENEGADO', () => {
    const r = decideTransferReview({ paymentStatus: 'paid', reported: false, reviewStatus: 'confirmed' }, 'reject', 'x')
    expect(r).toEqual({ ok: false, error: 'No se puede rechazar un pago ya confirmado.' })
  })
  it('confirmar después de rechazado → DENEGADO (no confirma un reporte ya rechazado)', () => {
    const r = decideTransferReview({ paymentStatus: 'pending', reported: false, reviewStatus: 'rejected' }, 'confirm')
    expect(r).toEqual({ ok: false, error: 'Reporte rechazado: requiere un nuevo reporte del cliente.' })
  })
  it('rechazar sin motivo → DENEGADO', () => {
    expect(decideTransferReview(pending, 'reject', '   ')).toEqual({ ok: false, error: 'El rechazo necesita un motivo.' })
    expect(decideTransferReview(pending, 'reject')).toEqual({ ok: false, error: 'El rechazo necesita un motivo.' })
  })
  it('revisar un pedido sin transferencia reportada → DENEGADO', () => {
    const none: ReviewState = { paymentStatus: 'pending', reported: false }
    expect(decideTransferReview(none, 'confirm')).toEqual({ ok: false, error: 'El pedido no tiene una transferencia por revisar.' })
    expect(decideTransferReview(none, 'reject', 'x')).toEqual({ ok: false, error: 'El pedido no tiene una transferencia por revisar.' })
  })
})

describe('decideTransferReview — re-reporte tras rechazo reabre la cola', () => {
  it('un nuevo reporte (reported=true, review=pending) vuelve a ser confirmable', () => {
    const reReported: ReviewState = { paymentStatus: 'pending', reported: true, reviewStatus: 'pending' }
    expect(decideTransferReview(reReported, 'confirm')).toMatchObject({ effect: 'confirm', status: 'confirmed' })
  })
})
