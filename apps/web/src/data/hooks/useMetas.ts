// Hook de metas y comisiones (solo Dirección). Mock hoy; con Supabase = tabla sales_targets.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, targetFor, globalRate, lineRate, setTarget, setGlobalRate, setLineRate, type SalesTarget, type ProductLine } from '../store/metasStore'

export function useMetas() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, targetFor, globalRate, lineRate, setTarget, setGlobalRate, setLineRate }
}

export type { SalesTarget, ProductLine }
