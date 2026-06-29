// Hook de promociones. Mock hoy; con Supabase = tabla promotions.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addPromo, isActive, type Promo } from '../store/promosStore'

export function usePromos() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, addPromo }
}

export { isActive }
export type { Promo }
