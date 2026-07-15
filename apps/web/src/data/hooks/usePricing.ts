// Precios por cliente. `priceFor(productId, base, listId?)` resuelve el precio: en el
// Portal del Doctor (sin listId) devuelve el de SU lista (RLS); en admin (con listId) el
// de esa lista; si no hay override, el precio base.
import { useSyncExternalStore } from 'react'
import { subscribe, getLists, getPrices, priceFor } from '../store/pricingStore'

export function usePricing() {
  const prices = useSyncExternalStore(subscribe, getPrices, getPrices)
  const lists = useSyncExternalStore(subscribe, getLists, getLists)
  return { prices, lists, priceFor }
}
