// Guías: envíos generados (paquetería con guía o chofer propio) con su estatus.
import React, { useMemo } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { driverName } from '../../data/mock/shipments'

function shipPill(status: string | null): { label: string; pill: string } {
  switch (status) {
    case 'assigned': return { label: 'Asignado a chofer', pill: 'p-warn' }
    case 'por_despachar': return { label: 'Por despachar', pill: 'p-warn' }
    case 'despachado': return { label: 'Despachado', pill: 'p-blue' }
    case 'in_transit': return { label: 'En camino', pill: 'p-blue' }
    case 'out_for_delivery': return { label: 'En reparto', pill: 'p-blue' }
    case 'incident': return { label: 'Incidencia', pill: 'p-dang' }
    case 'delivered': return { label: 'Entregado', pill: 'p-ok' }
    default: return { label: status ?? '—', pill: 'p-neu' }
  }
}

export function Guias() {
  const { data: shipments } = useShipments()
  const { data: orders } = useAllOrders()

  const folioOf = useMemo(() => {
    const m: Record<string, string> = {}
    orders.forEach((o) => (m[o.id] = o.external_ref ?? o.id))
    return m
  }, [orders])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Empaque · Guías</div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Pedido</th><th>Método</th><th>Estimada</th><th>Estatus</th></tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const sp = shipPill(s.status)
                return (
                  <tr key={s.id}>
                    <td data-label="Pedido" className="mono">{folioOf[s.order_id] ?? s.order_id}</td>
                    <td data-label="Método">
                      {s.driver_id ? (
                        <span><Icon name="usercheck" style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px' }} /> {driverName(s.driver_id)}</span>
                      ) : (
                        <span>{s.carrier} {s.tracking_number && <span className="lc" style={{ marginLeft: 6 }}>{s.tracking_number}</span>}</span>
                      )}
                    </td>
                    <td data-label="Estimada">{s.estimated_delivery_at ? fmtDate(s.estimated_delivery_at) : '—'}</td>
                    <td data-label="Estatus"><span className={'pill ' + sp.pill}>{sp.label}</span></td>
                  </tr>
                )
              })}
              {shipments.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--ink-3)' }}>Aún no hay envíos generados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
