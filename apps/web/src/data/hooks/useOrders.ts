// Hook de acceso a los pedidos del doctor. HOY lee del store mock compartido;
// MAÑANA se cambia a Supabase (select sobre orders+order_items con RLS, que ya
// limita al doctor a SUS pedidos) SIN tocar las pantallas.
import { useSyncExternalStore } from 'react'
import { hasSupabase } from '../../lib/supabase'
import {
  subscribe,
  getSnapshot,
  getSnapshotAll,
  ready,
  createOrder,
  cancelOrder,
  payOrder,
  isCancelable,
  type OrderWithItems,
  type NewOrderLine,
} from '../store/ordersStore'

// Pedidos del doctor actual (Portal). Mañana lo limita la RLS de Supabase.
export function useOrders() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, loading: hasSupabase && !ready(), error: null as string | null, createOrder, cancelOrder, payOrder }
}

// Todos los pedidos (staff de operación: almacén/empaque).
export function useAllOrders() {
  const data = useSyncExternalStore(subscribe, getSnapshotAll, getSnapshotAll)
  return { data, loading: hasSupabase && !ready(), error: null as string | null, cancelOrder }
}

export { isCancelable }

export type { OrderWithItems, NewOrderLine }
