// Ventas del evento: ventas POS atribuidas a los eventos del usuario (aislado por
// membresía; Admin ve todas). Cada venta lleva event_id + vendedor en shipping_meta.
import React, { useMemo } from 'react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useEvents } from '../../data/hooks/useEvents'
import { useRole } from '../../auth/RoleContext'

const isPos = (extRef: string | null) => Boolean(extRef && extRef.startsWith('POS'))
const eventOf = (o: { shipping_meta: unknown }): string | null => ((o.shipping_meta as Record<string, unknown> | null)?.event_id as string) ?? null

export function VentasEvento() {
  const { data: orders } = useAllOrders()
  const { data: events } = useEvents()
  const { role, user } = useRole()

  // Admin ve todas las POS; el vendedor solo las de SUS eventos.
  const myEventIds = useMemo(
    () => (role === 'admin' ? null : new Set(events.filter((e) => e.members.includes(user?.email ?? '')).map((e) => e.id))),
    [events, role, user],
  )
  const ventas = useMemo(
    () => orders.filter((o) => isPos(o.external_ref) && (myEventIds === null || myEventIds.has(eventOf(o) ?? ''))),
    [orders, myEventIds],
  )
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
