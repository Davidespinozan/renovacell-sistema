// Hooks de Finanzas (gastos + cierres de caja). Mock hoy; con Supabase = tablas
// expenses / cash_closings. Solo Dirección los consume.
import { useSyncExternalStore } from 'react'
import { subscribe as subG, getSnapshot as snapG, addGasto, removeGasto, type Gasto, type GastoCategoria } from '../store/gastosStore'
import { subscribe as subC, getSnapshot as snapC, registrarCierre, type Cierre } from '../store/cierresStore'

export function useGastos() {
  const data = useSyncExternalStore(subG, snapG, snapG)
  return { data, addGasto, removeGasto }
}

export function useCierres() {
  const data = useSyncExternalStore(subC, snapC, snapC)
  return { data, registrarCierre }
}

export type { Gasto, GastoCategoria, Cierre }
