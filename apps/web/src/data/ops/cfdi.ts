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
