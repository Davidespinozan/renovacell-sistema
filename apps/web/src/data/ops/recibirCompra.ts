// RECIBIR LA COMPRA COMPLETA (27 nov 2026, «sistema sencillo por rol»): una factura de 5 productos eran 5 ventanas, cada
// una con su lote y su caducidad. Ahora los renglones de una misma compra se capturan en UNA pantalla. Las reglas no
// cambian: cada renglón entra con el MISMO comando de siempre (recibir_lote contra su orden), con su propio op_id.
import type { PurchaseOrder } from '../store/comprasStore'

export interface CompraPorRecibir { compra_id: string; proveedor: string | null; fecha: string; lineas: PurchaseOrder[] }

/** Compras con MÁS de un renglón abierto: las que vale la pena recibir juntas. Un renglón suelto sigue en la tabla. */
export function comprasPorRecibir(pendientes: PurchaseOrder[]): CompraPorRecibir[] {
  const m = new Map<string, PurchaseOrder[]>()
  for (const o of pendientes) { if (o.compra_id) m.set(o.compra_id, [...(m.get(o.compra_id) ?? []), o]) }
  return [...m.entries()].filter(([, ls]) => ls.length > 1)
    .map(([compra_id, ls]) => ({ compra_id, proveedor: ls[0].supplier, fecha: ls[0].created_at, lineas: [...ls].sort((a, b) => a.product_name.localeCompare(b.product_name)) }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
}

export interface CapturaLinea { lote: string; caducidad: string; cantidad: number }
export type EstadoLinea = { estado: 'vacia' } | { estado: 'lista' } | { estado: 'falta'; falta: string }

/** Un renglón sin lote ni caducidad es «no llegó» y se salta; a medio llenar se dice qué le falta. */
export function estadoLinea(c: CapturaLinea, pendiente: number): EstadoLinea {
  const lote = c.lote.trim()
  if (!lote && !c.caducidad) return { estado: 'vacia' }
  if (!lote) return { estado: 'falta', falta: 'el lote' }
  if (!c.caducidad) return { estado: 'falta', falta: 'la caducidad' }
  if (!(c.cantidad > 0)) return { estado: 'falta', falta: 'la cantidad que llegó' }
  if (c.cantidad > pendiente) return { estado: 'falta', falta: 'una cantidad que no pase de lo pendiente' }
  return { estado: 'lista' }
}

/** Qué decirle a quien recibe: cuántos entraron, cuáles no y cuántos quedan esperando. */
export function resumenRecepcion(rs: Array<{ producto: string; ok: boolean; error?: string }>, saltados: number): { ok: boolean; texto: string } {
  const mal = rs.filter((r) => !r.ok)
  const bien = rs.length - mal.length
  const resto = saltados ? ` Quedan ${saltados} por recibir.` : ''
  if (mal.length === 0) return { ok: true, texto: `Recibiste ${bien} producto${bien === 1 ? '' : 's'}: ya están en inventario.${resto}` }
  return { ok: false, texto: `Entraron ${bien} de ${rs.length}. No entró: ${mal.map((m) => m.producto).join(', ')}. ${mal[0].error ?? 'Revisa y vuelve a confirmar.'}` }
}
