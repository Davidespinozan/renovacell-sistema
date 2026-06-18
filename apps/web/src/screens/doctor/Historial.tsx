// Historial: pedidos pasados del doctor (entregados / cancelados).
import React, { useMemo } from 'react'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { OrderCard } from './OrderCard'
import { isPast } from './orderStatus'
import type { ProductSafe } from '../../data/types'

export function Historial() {
  const { data: orders } = useOrders()
  const { data: products } = useProducts()

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const past = orders.filter((o) => isPast(o.status))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Portal del Doctor · Historial</div>
      {past.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Aún no hay pedidos en tu historial.
        </div>
      ) : (
        past.map((o) => <OrderCard key={o.id} order={o} productsById={byId} showTracking={false} />)
      )}
    </div>
  )
}
