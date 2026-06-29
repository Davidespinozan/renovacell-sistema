// Mis pedidos: pedidos ACTIVOS del doctor (no entregados/cancelados) con su
// estatus y seguimiento. Solo ve SUS pedidos (lo garantiza el store/RLS).
import React, { useMemo } from 'react'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { OrderCard } from './OrderCard'
import { isPast } from './orderStatus'
import type { ProductSafe } from '../../data/types'

export function MisPedidos() {
  const { data: orders, cancelOrder } = useOrders()
  const { data: products } = useProducts()

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const active = orders.filter((o) => !isPast(o.status))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Portal del Doctor · Mis pedidos</div>
      {active.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No tienes pedidos activos. Crea uno desde el catálogo.
        </div>
      ) : (
        active.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            productsById={byId}
            onCancel={() => { if (window.confirm('¿Cancelar este pedido?')) cancelOrder(o.id, 'Portal del Doctor') }}
          />
        ))
      )}
    </div>
  )
}
