// Mis pedidos: pedidos ACTIVOS del doctor (no entregados/cancelados) con su
// estatus y seguimiento. Solo ve SUS pedidos (lo garantiza el store/RLS).
import React, { useMemo, useState } from 'react'
import { useOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { OrderCard } from './OrderCard'
import { PaymentModal } from './PaymentModal'
import { isPast } from './orderStatus'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'

export function MisPedidos() {
  const { data: orders, loading, cancelOrder, payOrder } = useOrders()
  const { data: products } = useProducts()
  const [paying, setPaying] = useState<OrderWithItems | null>(null)

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const active = orders.filter((o) => !isPast(o.status))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Portal del Doctor · Mis pedidos</div>
      {loading ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Cargando tus pedidos…</div>
      ) : active.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No tienes pedidos activos. Crea uno desde el catálogo.
        </div>
      ) : (
        active.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            productsById={byId}
            onPay={() => setPaying(o)}
            onCancel={() => { if (window.confirm('¿Cancelar este pedido?')) cancelOrder(o.id, 'Portal del Doctor') }}
          />
        ))
      )}

      {paying && (
        <PaymentModal
          folio={paying.external_ref ?? paying.id}
          amount={paying.total ?? 0}
          orderId={paying.id}
          onPaid={(r) => payOrder(paying.id, { method: r.method, ref: r.id, actor: 'Portal del Doctor' })}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  )
}
