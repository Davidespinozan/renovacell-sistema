// TABLERO de Administración: centro de mando. Solo lectura; AGREGA de los stores
// compartidos (orders, shipments, lots) y reutiliza los detectores existentes
// (atorados de Seguimiento, caducidad de Almacén). No inventa datos nuevos.
import React, { useMemo } from 'react'
import { Icon, type IconName } from '../../app/icons'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useShipments } from '../../data/hooks/useShipments'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { diagnoseShipment, isSurtible } from '../../data/ops/seguimiento'
import { salesSummary, doctorActivity } from '../../data/metrics'
import { statusView } from '../doctor/orderStatus'
import { daysUntil, severity, sevPill, sevLabel } from '../warehouse/expiry'
import type { ProductSafe } from '../../data/types'

type Bucket = 'Pedido' | 'Empacado' | 'En camino' | 'Entregado'
function bucketOf(status: string | null): Bucket | null {
  if (['draft', 'pending_payment', 'paid', 'picking'].includes(status ?? '')) return 'Pedido'
  if (status === 'packed') return 'Empacado'
  if (status === 'shipped') return 'En camino'
  if (status === 'delivered' || status === 'fulfilled') return 'Entregado'
  return null // cancelado
}

export function Tablero() {
  const { data: orders } = useAllOrders()
  const { data: shipments } = useShipments()
  const { data: lots } = useLots()
  const { data: products } = useProducts()

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])

  const sum = salesSummary(orders)
  const act = doctorActivity(orders)

  const porEstatus = useMemo(() => {
    const acc: Record<Bucket, number> = { Pedido: 0, Empacado: 0, 'En camino': 0, Entregado: 0 }
    orders.forEach((o) => {
      const b = bucketOf(o.status)
      if (b) acc[b] += 1
    })
    return acc
  }, [orders])

  // Reusa el MISMO detector de Seguimiento.
  const atorados = useMemo(() => {
    return orders
      .filter((o) => ['packed', 'shipped'].includes(o.status ?? ''))
      .map((o) => ({ order: o, dx: diagnoseShipment(o, shipments.find((s) => s.order_id === o.id)) }))
      .filter((r) => r.dx.stuck)
  }, [orders, shipments])

  const porSurtir = orders.filter(isSurtible)

  // Reusa los helpers de caducidad de Almacén.
  const porCaducar = useMemo(
    () =>
      lots
        .filter((l) => l.quantity > 0)
        .map((l) => ({ lot: l, d: daysUntil(l.expiry_date) }))
        .filter((x) => severity(x.d) === 'expired' || severity(x.d) === 'critical')
        .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)),
    [lots],
  )

  const recientes = orders.slice(0, 6)

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="eyebrow">Administración · Tablero</div>

      {/* KPIs */}
      <div className="grid sigs">
        <Sig icon="bag" value={String(sum.orders)} k="Pedidos" s="en el sistema" />
        <Sig icon="chart" value={money(sum.revenue)} k="Ventas" s="compras acumuladas" />
        <Sig icon="receipt" value={money(sum.avgTicket)} k="Ticket promedio" s="por pedido" />
        <Sig icon="usercheck" value={String(act.active)} k="Doctores activos" s="con compra" />
        <Sig icon="layers" value={String(porSurtir.length)} k="Por surtir" s="pendientes en almacén" tone={porSurtir.length ? 'warn' : undefined} />
        <Sig icon="truck" value={String(atorados.length)} k="Atorados" s="requieren atención" tone={atorados.length ? 'dang' : undefined} />
        <Sig icon="clock" value={String(porCaducar.length)} k="Lotes por caducar" s="≤ 60 días o caducados" tone={porCaducar.length ? 'warn' : undefined} />
      </div>

      {/* Pedidos por estatus */}
      <div className="card">
        <div className="eyebrow">Pedidos por estatus</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(['Pedido', 'Empacado', 'En camino', 'Entregado'] as Bucket[]).map((b) => (
            <div key={b} className="sl-stat" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b className="mono" style={{ fontSize: 16 }}>{porEstatus[b]}</b> {b}
            </div>
          ))}
        </div>
      </div>

      {/* ALERTAS */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
        <AlertCard title="Envíos atorados" icon="truck" tone="dang" empty="Sin envíos atorados.">
          {atorados.map(({ order, dx }) => (
            <AlertItem key={order.id} folio={order.external_ref} text={dx.reason} pill="p-dang" />
          ))}
        </AlertCard>

        <AlertCard title="Lotes por caducar" icon="clock" tone="warn" empty="Nada por caducar pronto.">
          {porCaducar.map(({ lot, d }) => (
            <AlertItem
              key={lot.id}
              folio={prodName[lot.product_id] ?? 'Producto'}
              text={`${lot.lot_code} · ${fmtDate(lot.expiry_date ?? '')}`}
              pill={sevPill(severity(d))}
              badge={sevLabel(d)}
            />
          ))}
        </AlertCard>

        <AlertCard title="Pendientes de surtir" icon="layers" tone="warn" empty="Todo surtido.">
          {porSurtir.map((o) => (
            <AlertItem key={o.id} folio={o.external_ref} text={`${o.items.length} renglón(es)`} pill="p-warn" badge={money(o.total)} />
          ))}
        </AlertCard>
      </div>

      {/* Actividad reciente */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0' }}><div className="eyebrow">Actividad reciente</div></div>
        <div style={{ padding: '0 14px 8px' }}>
          <table>
            <thead><tr><th>Pedido</th><th>Estatus</th><th>Fecha</th><th>Total</th></tr></thead>
            <tbody>
              {recientes.map((o) => {
                const sv = statusView(o.status)
                return (
                  <tr key={o.id}>
                    <td className="mono">{o.external_ref}</td>
                    <td><span className={'pill ' + sv.pill}>{sv.label}</span></td>
                    <td>{fmtDate(o.created_at)}</td>
                    <td className="mono">{money(o.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Sig({ icon, value, k, s, tone }: { icon: IconName; value: string; k: string; s: string; tone?: 'warn' | 'dang' }) {
  return (
    <div className={'card sig' + (tone ? ' ' + tone : '')}>
      <div className="chip"><Icon name={icon} /></div>
      <div className="v">{value}</div>
      <div className="k">{k}</div>
      <div className="s">{s}</div>
    </div>
  )
}

function AlertCard({ title, icon, tone, empty, children }: {
  title: string
  icon: IconName
  tone: 'dang' | 'warn'
  empty: string
  children: React.ReactNode
}) {
  const items = React.Children.toArray(children)
  const color = tone === 'dang' ? 'var(--danger)' : 'var(--warn)'
  return (
    <div className="card" style={{ borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <Icon name={icon} style={{ width: 17, height: 17, color }} />
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h3>
        <span className="mono" style={{ marginLeft: 'auto', color }}>{items.length}</span>
      </div>
      {items.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{empty}</div> : children}
    </div>
  )
}

function AlertItem({ folio, text, pill, badge }: { folio: string | null; text: string; pill: string; badge?: string }) {
  return (
    <div className="lrow">
      <div>
        <div className="nm mono">{folio}</div>
        <div className="lt">{text}</div>
      </div>
      <span className={'pill ' + pill}>{badge ?? '!'}</span>
    </div>
  )
}
