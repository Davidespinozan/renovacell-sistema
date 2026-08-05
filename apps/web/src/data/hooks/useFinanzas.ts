// Hooks de Finanzas (gastos + cierres de caja). Mock hoy; con Supabase = tablas
// expenses / cash_closings. Solo Dirección los consume.
import { useSyncExternalStore } from 'react'
import { subscribe as subG, getSnapshot as snapG, addGasto, removeGasto, type Gasto, type GastoCategoria } from '../store/gastosStore'
import { subscribe as subC, getSnapshot as snapC, registrarCierre, type Cierre } from '../store/cierresStore'
import { subscribe as subR, getSnapshot as snapR, registrarDevolucion, refundedByOrder, returnedByItem, type Refund, type RefundItem } from '../store/refundsStore'

export function useGastos() {
  const data = useSyncExternalStore(subG, snapG, snapG)
  return { data, addGasto, removeGasto }
}

export function useCierres() {
  const data = useSyncExternalStore(subC, snapC, snapC)
  return { data, registrarCierre }
}

export function useRefunds() {
  const data = useSyncExternalStore(subR, snapR, snapR)
  return { data, registrarDevolucion, refundedByOrder, returnedByItem }
}

export type { Gasto, GastoCategoria, Cierre, Refund, RefundItem }
