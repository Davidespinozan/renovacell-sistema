// PAY-EXP-01A-3 · Intención de navegación "abre ESTE pedido en Ventas" (desde Revisión económica), para llegar al
// flujo canónico de reembolsos (autorizar / pagar) del detalle del pedido. Solo lleva el id; Ventas lo consume una
// vez y abre el detalle si el pedido está en SU lista (RLS). Aislado del intento de conversaciones (CHV2-B).
import { useSyncExternalStore } from 'react'
export interface IntentoVentas { id: number; orderId: string; folio: string | null }
let actual: IntentoVentas | null = null
let seq = 0
const oyentes = new Set<() => void>()
const emitir = () => oyentes.forEach((l) => l())
export function pedirAbrirPedido(orderId: string, folio: string | null): IntentoVentas { seq += 1; actual = { id: seq, orderId, folio }; emitir(); return actual }
export function consumirIntentoVentas(id: number) { if (actual?.id === id) { actual = null; emitir() } }
export const intentoVentasActual = (): IntentoVentas | null => actual
export function useIntentoVentas(): IntentoVentas | null {
  return useSyncExternalStore((cb) => { oyentes.add(cb); return () => { oyentes.delete(cb) } }, intentoVentasActual, intentoVentasActual)
}
