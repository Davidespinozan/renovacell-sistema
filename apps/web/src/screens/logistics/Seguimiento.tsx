// SEGUIMIENTO (admin + staff de logística): todos los envíos —propios y
// paquetería— con su estatus, y DETECCIÓN DE ATORADOS (vencidos o surtidos sin
// salir). Es la vista para cazar el pedido que se atoró (caso S12840).
import React, { useMemo } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useShipments } from '../../data/hooks/useShipments'
import { useProducts } from '../../data/hooks/useProducts'
import { driverName } from '../../data/mock/shipments'
import { clientOf } from '../../data/mock/profiles'
import { diagnoseShipment } from '../../data/ops/seguimiento'
import type { Shipment, ProductSafe } from '../../data/types'

interface Row {
  order: OrderWithItems
  shipment: Shipment | undefined
  stuck: boolean
  reason: string
  statusLabel: string
  statusPill: string
}

export function Seguimiento() {
  const { data: orders } = useAllOrders()
  const { data: shipments, resolveIncident } = useShipments()
  const { data: products } = useProducts()

  const incidents = useMemo(
    () => shipments
      .filter((s) => s.incident && !s.incident.resolved)
      .map((s) => ({ shipment: s, order: orders.find((o) => o.id === s.order_id) })),
    [shipments, orders],
  )

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])

  const rows = useMemo(() => {
    const inFlight = orders.filter(
      (o) =>
        ['packed', 'shipped', 'delivered'].includes(o.status ?? '') &&
        (o.shipping_meta as { channel?: string } | null)?.channel !== 'pos', // POS no es envío
    )
    return inFlight
      .map((o): Row => {
        const shipment = shipments.find((s) => s.order_id === o.id)
        return { order: o, shipment, ...diagnoseShipment(o, shipment) }
      })
      .sort((a, b) => Number(b.stuck) - Number(a.stuck) || (a.order.created_at < b.order.created_at ? 1 : -1))
  }, [orders, shipments])

  const stuckCount = rows.filter((r) => r.stuck).length

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Seguimiento de envíos</div>

      {stuckCount > 0 && (
        <div className="alert">
          <div className="ico"><Icon name="truck" /></div>
          <div className="x">
            <b>{stuckCount} envío(s) atorado(s).</b> Hay pedidos vencidos o surtidos sin salir. Revísalos antes de que el doctor reclame.
          </div>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <div className="eyebrow">Incidencias de entrega ({incidents.length})</div>
          {incidents.map(({ shipment, order }) => {
            const folio = order?.external_ref ?? shipment.order_id
            return (
              <div key={shipment.id} className="lrow">
                <div>
                  <div className="nm mono">{folio}</div>
                  <div className="lt">{shipment.incident!.type}{shipment.incident!.note ? ` · ${shipment.incident!.note}` : ''}</div>
                </div>
                <button className="btn sm" type="button" onClick={() => resolveIncident(shipment.id, folio)}>
                  <Icon name="check" /> Resolver · reintentar
                </button>
              </div>
            )
          })}
        </div>
      )}

      {rows.map((r) => (
        <ShipmentRow key={r.order.id} row={r} prodName={prodName} />
      ))}
    </div>
  )
}

function ShipmentRow({ row, prodName }: { row: Row; prodName: Record<string, string> }) {
  const { order, shipment, stuck, reason, statusLabel, statusPill } = row
  const client = clientOf(order.doctor_id)
  const items = order.items.filter((it) => it.unit_price != null)
  const method = shipment
    ? shipment.driver_id
      ? `Chofer propio · ${driverName(shipment.driver_id)}`
      : `${shipment.carrier}${shipment.tracking_number ? ` · guía ${shipment.tracking_number}` : ''}`
    : 'Sin asignar'

  return (
    <div className="card" style={stuck ? { borderLeft: '4px solid var(--danger)' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
        <span className={'pill ' + statusPill}><span className="d" /> {statusLabel}</span>
        {stuck && <span className="pill p-dang"><Icon name="x" style={{ width: 12, height: 12 }} /> Detenido</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
          {shipment?.estimated_delivery_at ? `Estimada ${fmtDate(shipment.estimated_delivery_at)}` : fmtDate(order.created_at)}
        </span>
      </div>

      {stuck && (
        <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginBottom: 10 }}>
          <Icon name="truck" />
          <span>{reason}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, fontSize: 13 }}>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Cliente</div>{client.name} · {client.clinic}</div>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Dirección</div>{client.address}, {client.city}</div>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Método</div>{method}</div>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Productos</div>{items.map((it) => `${prodName[it.product_id ?? ''] ?? 'Producto'} ×${it.qty}`).join(', ')}</div>
      </div>
    </div>
  )
}
