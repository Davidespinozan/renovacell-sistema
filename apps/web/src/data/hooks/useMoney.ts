// W2 · Lectura del dinero para las pantallas. `v_order_money` es la ÚNICA fuente:
// ninguna pantalla suma cobros ni deduce si un pedido está pagado.
import { useMemo, useSyncExternalStore } from 'react'
import { hasSupabase } from '../../lib/supabase'
import {
  subscribeMoney, getMoneySnapshot, moneyReady,
  subscribeClaims, getClaimsSnapshot, claimsReady,
  subscribeEntries, getEntriesSnapshot, entriesReady,
  subscribeDemoCredits, getDemoCredits,
  moneyIndex, reloadMoney,
} from '../store/moneyStore'
import { subscribe as subOrders, getSnapshotAll as snapOrders } from '../store/ordersStore'
import { subscribe as subRefunds, getSnapshot as snapRefunds, refundedByOrder } from '../store/refundsStore'
import { claimsFromOrders, moneyFromOrder } from '../ops/moneyMock'
import { hoyNegocio } from '../periodo'
import type { OrderMoney, PaymentClaim, PaymentEntry } from '../ops/money'

export function useOrderMoney(): { data: OrderMoney[]; byOrder: Record<string, OrderMoney>; loading: boolean; reload: () => Promise<void> } {
  const server = useSyncExternalStore(subscribeMoney, getMoneySnapshot, getMoneySnapshot)
  // Demo (sin backend): se deriva de las semillas; con backend manda `v_order_money`.
  const orders = useSyncExternalStore(subOrders, snapOrders, snapOrders)
  const refunds = useSyncExternalStore(subRefunds, snapRefunds, snapRefunds)
  const credits = useSyncExternalStore(subscribeDemoCredits, getDemoCredits, getDemoCredits)
  const data = useMemo(() => {
    if (hasSupabase) return server
    const dev = refundedByOrder(refunds)
    const hoy = hoyNegocio()
    return orders.map((o) => moneyFromOrder(o, dev[o.id] ?? 0, credits[o.id] ?? null, hoy))
  }, [server, orders, refunds, credits])
  const byOrder = useMemo(() => moneyIndex(data), [data])
  return { data, byOrder, loading: hasSupabase && !moneyReady(), reload: reloadMoney }
}

export function usePaymentClaims(): { data: PaymentClaim[]; loading: boolean; reload: () => Promise<void> } {
  const server = useSyncExternalStore(subscribeClaims, getClaimsSnapshot, getClaimsSnapshot)
  const orders = useSyncExternalStore(subOrders, snapOrders, snapOrders)
  const data = useMemo(() => (hasSupabase ? server : claimsFromOrders(orders)), [server, orders])
  return { data, loading: hasSupabase && !claimsReady(), reload: reloadMoney }
}

export function usePaymentEntries(): { data: PaymentEntry[]; loading: boolean; reload: () => Promise<void> } {
  const data = useSyncExternalStore(subscribeEntries, getEntriesSnapshot, getEntriesSnapshot)
  return { data, loading: hasSupabase && !entriesReady(), reload: reloadMoney }
}
