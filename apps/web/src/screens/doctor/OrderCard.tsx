// Tarjeta de pedido reutilizable (Mis pedidos e Historial).
import React from 'react'
import { money, fmtDate } from '../../lib/format'
import { statusView } from './orderStatus'
import { Trk } from './Trk'
import { isCancelable, type OrderWithItems } from '../../data/hooks/useOrders'
import type { ProductSafe } from '../../data/types'

export function OrderCard({
  order,
  productsById,
  showTracking = true,
  onCancel,
}: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  showTracking?: boolean
  onCancel?: () => void
}) {
  const sv = statusView(order.status)

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
        <span className={'pill ' + sv.pill}><span className="d" /> {sv.label}</span>
        {order.invoice_requested && <span className="pill p-neu">CFDI</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(order.created_at)}</span>
      </div>

      <div style={{ marginBottom: 8 }}>
        {order.items.map((it) => {
          const p = productsById[it.product_id ?? '']
          return (
            <div key={it.id} className="coitem">
              <span>
                {p?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{it.qty}</span>
              </span>
              <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
            </div>
          )
        })}
      </div>

      <div className="cototal">
        <span>Total</span>
        <b>{money(order.total)}</b>
      </div>

      {showTracking && order.status !== 'cancelled' && <Trk step={sv.step} />}

      <ShippingLine meta={order.shipping_meta} />

      {onCancel && isCancelable(order.status) && (
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={onCancel}>Cancelar pedido</button>
        </div>
      )}
    </div>
  )
}

function ShippingLine({ meta }: { meta: OrderWithItems['shipping_meta'] }) {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as { carrier?: string; tracking?: string; driver?: string }
  let text = ''
  if (m.driver) text = `Entrega: chofer propio · ${m.driver}`
  else if (m.carrier) text = `Paquetería: ${m.carrier}${m.tracking ? ` · guía ${m.tracking}` : ''}`
  if (!text) return null
  return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>{text}</div>
}
