// Tarjeta de pedido reutilizable (Mis pedidos e Historial).
import React from 'react'
import { Icon } from '../../app/icons'
import { money, fmtDate } from '../../lib/format'
import { statusView } from './orderStatus'
import { Trk } from './Trk'
import { isCancelable, type OrderWithItems } from '../../data/hooks/useOrders'
import { trackingUrl } from '../../data/shipping/provider'
import type { ProductSafe } from '../../data/types'

export function OrderCard({
  order,
  productsById,
  showTracking = true,
  onCancel,
  onPay,
}: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  showTracking?: boolean
  onCancel?: () => void
  onPay?: () => void
}) {
  const sv = statusView(order.status)
  const unpaid = order.payment_status !== 'paid' && order.status !== 'cancelled'

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
        <span className={'pill ' + sv.pill}><span className="d" /> {sv.label}</span>
        {order.payment_status === 'paid' && <span className="pill p-ok">Pagado</span>}
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

      {unpaid && onPay && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--warn-bg)', border: '1px solid #EEDDB6', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 600 }}>Este pedido está pendiente de pago.</span>
          <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={onPay}>
            <Icon name="receipt" /> Pagar {money(order.total)}
          </button>
        </div>
      )}

      {order.payment_status === 'paid' && order.payment_ref && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
          Pagado{order.payment_method ? ` · ${order.payment_method}` : ''} · ref. <span className="mono">{order.payment_ref}</span>
        </div>
      )}

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
  if (m.driver) {
    return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>Entrega: chofer propio · {m.driver}</div>
  }
  if (m.carrier) {
    const url = m.tracking ? trackingUrl(m.carrier, m.tracking) : null
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
        Paquetería: {m.carrier}
        {m.tracking && (url
          ? <> · guía <a href={url} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--green-deep)', fontWeight: 600 }}>{m.tracking}</a></>
          : <> · guía {m.tracking}</>)}
      </div>
    )
  }
  return null
}
