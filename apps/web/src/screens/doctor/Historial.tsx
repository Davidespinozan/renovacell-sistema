// Historial: pedidos pasados del doctor (entregados / cancelados).
import { Vacio, Cargando } from '../../app/EmptyState'
import React, { useMemo } from 'react'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useRole } from '../../auth/RoleContext'
import { seedReorder } from '../../data/store/reorderStore'
import { OrderCard } from './OrderCard'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { isPast } from './orderStatus'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'

export function Historial() {
  const { data: orders, loading } = useOrders()
  const { byOrder } = useOrderMoney()
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
        <Cargando etiqueta="Cargando tu historial…" />
      ) : past.length === 0 ? (
        <Vacio icono="clock" titulo="Aún no hay pedidos en tu historial." pista="Aquí verás los pedidos ya entregados o cerrados." />
      ) : (
        past.map((o) => <OrderCard key={o.id} order={o} productsById={byId} showTracking={false} dinero={byOrder[o.id] ?? null} onReorder={() => reorder(o)} />)
      )}
    </div>
  )
}
