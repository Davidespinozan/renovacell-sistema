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

// ¿Tiene un CFDI TIMBRADO de verdad y descargable? Solo entonces existe XML/PDF en Facturama:
// requiere status 'timbrada', NO simulado y con facturama_id. Un folio 'emitida' simulado/demo
// (o sin facturama_id) NO es descargable → la UI no debe ofrecer "Descargar XML/PDF".
export function cfdiTimbradoReal(o: OrderWithItems): boolean {
  const m = o.invoice_meta as { status?: string; facturama_id?: string | null; simulated?: boolean } | null
  return !!m && m.status === 'timbrada' && m.simulated !== true && typeof m.facturama_id === 'string' && m.facturama_id.length > 0
}

// Estado de la cancelación fiscal (invoice_meta.cancel.status): 'cancelada' | 'pendiente' |
// 'rechazada' | 'solicitada' | null. La cancelación es un evento fiscal separado: NO cambia
// pedido/pago/inventario/comisión.
export function estadoCancelacion(o: OrderWithItems): string | null {
  const s = (o.invoice_meta as { cancel?: { status?: string } } | null)?.cancel?.status
  return typeof s === 'string' && s.length > 0 ? s : null
}

// ¿Se puede iniciar una cancelación? Timbre real y sin cancelación en curso/hecha.
// 'rechazada' (active en SAT) permite reintentar; 'solicitada'/'pendiente'/'cancelada' bloquean.
export function cfdiCancelable(o: OrderWithItems): boolean {
  const s = estadoCancelacion(o)
  return cfdiTimbradoReal(o) && (s === null || s === 'rechazada')
}

// ¿Se puede ENVIAR como documento vigente? Un CFDI cancelado o con cancelación en curso NO se
// envía; uno 'rechazada' (sigue vigente) o sin cancelación, sí. La DESCARGA histórica no se limita.
export function cfdiEnviable(o: OrderWithItems): boolean {
  const s = estadoCancelacion(o)
  return cfdiTimbradoReal(o) && (s === null || s === 'rechazada')
}
