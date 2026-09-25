// Máquina de estados PURA de la revisión de una transferencia (confirmar/rechazar).
// Es el espejo fiel de la RPC server-side review_transfer_payment: el store la usa en el
// modo mock y las pruebas cubren aquí la matriz de idempotencia sin tocar la base.
export type ReviewAction = 'confirm' | 'reject'

export interface ReviewState {
  paymentStatus: string          // 'pending' | 'paid' | …
  reported?: boolean             // transfer.reported
  reviewStatus?: string          // transfer.review.status: 'pending' | 'confirmed' | 'rejected'
}

export type ReviewDecision =
  | { ok: true; effect: 'confirm'; status: 'confirmed' }
  | { ok: true; effect: 'reject'; status: 'rejected' }
  | { ok: true; effect: 'noop'; status: 'already_confirmed' | 'already_rejected' }
  | { ok: false; error: string }

// Estado de revisión efectivo: usa review.status si existe; si no, deriva de reported.
export function effectiveReview(s: ReviewState): string | undefined {
  return s.reviewStatus ?? (s.reported ? 'pending' : undefined)
}

export function decideTransferReview(s: ReviewState, action: ReviewAction, reason?: string): ReviewDecision {
  const review = effectiveReview(s)
  // Debe existir una transferencia reportada por revisar.
  if (!s.reported && !review) return { ok: false, error: 'El pedido no tiene una transferencia por revisar.' }

  if (action === 'confirm') {
    // Idempotente: ya pagado/confirmado → no-op.
    if (s.paymentStatus === 'paid' || review === 'confirmed') return { ok: true, effect: 'noop', status: 'already_confirmed' }
    // No confirmar un reporte previamente RECHAZADO (requiere nuevo reporte del cliente).
    if (review === 'rejected') return { ok: false, error: 'Reporte rechazado: requiere un nuevo reporte del cliente.' }
    return { ok: true, effect: 'confirm', status: 'confirmed' }
  }

  // Rechazar: no se puede rechazar un pago ya confirmado.
  if (s.paymentStatus === 'paid' || review === 'confirmed') return { ok: false, error: 'No se puede rechazar un pago ya confirmado.' }
  if (!reason?.trim()) return { ok: false, error: 'El rechazo necesita un motivo.' }
  // Idempotente: ya rechazado → no-op.
  if (review === 'rejected') return { ok: true, effect: 'noop', status: 'already_rejected' }
  return { ok: true, effect: 'reject', status: 'rejected' }
}
