// Ventas del evento: ventas POS del día/evento con su total.
import React, { useMemo } from 'react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'

const isPos = (extRef: string | null) => Boolean(extRef && extRef.startsWith('POS'))

export function VentasEvento() {
  const { data: orders } = useAllOrders()
  const ventas = useMemo(() => orders.filter((o) => isPos(o.external_ref)), [orders])
  const total = ventas.reduce((s, o) => s + (o.total ?? 0), 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Punto de Venta · Ventas del evento</div>

      <div className="grid sigs">
        <div className="card sig">
          <div className="chip"><span className="mono">$</span></div>
          <div className="v">{money(total)}</div>
          <div className="k">Total del evento</div>
          <div className="s">{ventas.length} venta(s)</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead><tr><th>Folio</th><th>Fecha</th><th>Pago</th><th>Total</th></tr></thead>
            <tbody>
              {ventas.map((o) => (
                <tr key={o.id}>
                  <td data-label="Folio" className="mono">{o.external_ref}</td>
                  <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                  <td data-label="Pago"><span className="pill p-neu">{o.payment_method === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}</span></td>
                  <td data-label="Total" className="mono">{money(o.total)}</td>
                </tr>
              ))}
              {ventas.length === 0 && (
                <tr><td colSpan={4} style={{ color: 'var(--ink-3)' }}>Aún no hay ventas de evento. Cobra una en Caja.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
