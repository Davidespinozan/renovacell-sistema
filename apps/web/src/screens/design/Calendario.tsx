// DISEÑO · Calendario de entregas y compromisos. Agenda de próximas entregas
// (de envíos) + promociones vigentes, para planear material de producción.
import React, { useMemo } from 'react'
import { CalendarDays, Truck, Megaphone } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { usePromos, isActive } from '../../data/hooks/usePromos'

export function Calendario() {
  const { data: shipments } = useShipments()
  const { data: orders } = useAllOrders()
  const { data: promos } = usePromos()
  const today = new Date().toISOString().slice(0, 10)

  const folioOf = useMemo(() => {
    const m: Record<string, string> = {}
    orders.forEach((o) => (m[o.id] = o.external_ref ?? o.id))
    return m
  }, [orders])

  const entregas = useMemo(
    () => shipments
      .filter((s) => s.estimated_delivery_at && s.status !== 'delivered')
      .map((s) => ({ id: s.id, date: s.estimated_delivery_at as string, folio: folioOf[s.order_id] ?? s.order_id }))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [shipments, folioOf],
  )
  const vigentes = promos.filter((p) => isActive(p, today))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Diseño · Calendario de entregas y compromisos</div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <Truck size={17} style={{ color: 'var(--green-deep)' }} />
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Próximas entregas</h3>
        </div>
        {entregas.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>No hay entregas estimadas pendientes.</div>
        ) : (
          entregas.map((e) => (
            <div key={e.id} className="lrow">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CalendarDays size={15} style={{ color: 'var(--ink-3)' }} />
                <div><div className="nm mono">{e.folio}</div><div className="lt">Entrega estimada</div></div>
              </div>
              <span className="pill p-blue">{fmtDate(e.date)}</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
          <Megaphone size={17} style={{ color: 'var(--green-deep)' }} />
          <h3 style={{ fontSize: 15, fontWeight: 600 }}>Promociones vigentes</h3>
        </div>
        {vigentes.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin promociones vigentes hoy.</div>
        ) : (
          vigentes.map((p) => (
            <div key={p.id} className="lrow">
              <div><div className="nm">{p.title}</div><div className="lt">{p.description}</div></div>
              <span className="pill p-ok">{fmtDate(p.start)} – {fmtDate(p.end)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
