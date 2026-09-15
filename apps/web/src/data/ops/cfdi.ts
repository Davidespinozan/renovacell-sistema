// Estado del CFDI de un pedido — ÚNICA fuente de verdad para toda la UI (evita que unos
// consumidores miren 'emitida' y otros 'timbrada' → doble timbrado, auditoría de cierre).
// 'emitida'  = folio optimista/simulado (demo o seam 501, sin PAC).
// 'timbrada' = timbre REAL de Facturama (con UUID del SAT).
// Ambos significan "el pedido YA tiene CFDI" → no debe volver a ofrecerse "Emitir CFDI".
import type { OrderWithItems } from '../hooks/useOrders'

export function tieneCfdi(o: OrderWithItems): boolean {
  const status = (o.invoice_meta as { status?: string } | null)?.status
  return status === 'emitida' || status === 'timbrada'
}
