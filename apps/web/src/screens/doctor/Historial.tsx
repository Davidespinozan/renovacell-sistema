// Historial: pedidos pasados del doctor (entregados / cancelados).
import React, { useMemo } from 'react'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useRole } from '../../auth/RoleContext'
import { seedReorder } from '../../data/store/reorderStore'
import { OrderCard } from './OrderCard'
import { isPast } from './orderStatus'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'

export function Historial() {
  const { data: orders, loading } = useOrders()
  const { data: products } = useProducts()
  const { setScreen } = useRole()

  const reorder = (o: OrderWithItems) => {
    seedReorder(o.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty })))
    setScreen('catalogo')
  }

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const past = orders.filter((o) => isPast(o.status))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Portal del Doctor · Historial</div>
      {loading ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Cargando tu historial…</div>
      ) : past.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Aún no hay pedidos en tu historial.
        </div>
      ) : (
        past.map((o) => <OrderCard key={o.id} order={o} productsById={byId} showTracking={false} onReorder={() => reorder(o)} />)
      )}
    </div>
  )
}
