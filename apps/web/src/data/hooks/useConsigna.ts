// Hook de consignación por vendedor. Mock; con Supabase = consignment_stock.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, assignToVendor, sellFromConsigna, returnToWarehouse, balanceOf, remainingFor, remaining, type ConsignaItem } from '../store/consignaStore'

export function useConsigna() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, assignToVendor, sellFromConsigna, returnToWarehouse, balanceOf, remainingFor }
}

export { remaining }
export type { ConsignaItem }
