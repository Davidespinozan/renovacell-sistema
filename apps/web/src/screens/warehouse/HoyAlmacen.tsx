// ALM-1 · "Hoy en Almacén": UNA pantalla para el día de Alberto (lo que el sistema viejo mostraba junto). Arriba lo
// que cuenta hoy (por preparar, por enviar, guías DHL de hoy, recolección DHL de hoy); abajo una sola lista "Esperan tu
// decisión" con cada pedido: productos a empacar, dirección, cómo se vendió (ENT) y el botón de lo que toca ahora
// (Preparar → Asignar envío), sin cambiar de pestaña. Las pestañas de detalle (Preparar pedidos, Por enviar, Guías,
// Despacho, Seguimiento) siguen para consultar; esta es la de trabajar.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { Vacio } from '../../app/EmptyState'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { useProducts } from '../../data/hooks/useProducts'
import { useShipments } from '../../data/hooks/useShipments'
import { isSurtible } from '../../data/ops/seguimiento'
import { orderAddress, formatAddress } from '../../data/ops/shippingAddress'
import { recoleccionDe } from '../../data/shipping/recoleccion'
import { AsignarModal, EntregaPill, entregaDe, ordenarPorSalida } from '../packing/Cola'
import { SurtirModal } from './Surtido'
import type { ProductSafe, Shipment } from '../../data/types'

const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const diaLocal = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) : '')

type Accion = { tipo: 'preparar' } | { tipo: 'enviar' } | { tipo: 'despacho' } | { tipo: 'pago' }
export function accionDe(o: OrderWithItems, liberado: boolean, envio: Shipment | undefined): Accion | null {
  if (o.status === 'packed') return envio && envio.status === 'por_despachar' ? { tipo: 'despacho' } : { tipo: 'enviar' }
  if (isSurtible(o, { liberado })) return { tipo: 'preparar' }
  if (!liberado && ['pending_payment', 'draft', 'paid'].includes(o.status ?? '')) return null   // espera pago: no es decisión de Almacén
  return null
}

function Tarjeta({ titulo, valor, pie, icono, alerta, testid }: { titulo: string; valor: React.ReactNode; pie: React.ReactNode; icono: React.ComponentProps<typeof Icon>['name']; alerta?: boolean; testid: string }) {
  return (
    <div className="card" style={{ border: alerta ? '1.5px solid var(--warn)' : undefined, minWidth: 0 }} data-testid={testid}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>{titulo}<span style={{ marginLeft: 'auto', color: alerta ? 'var(--warn)' : 'var(--green-deep)' }}><Icon name={icono} /></span></div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: alerta ? 'var(--warn)' : 'var(--ink)' }}>{valor}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{pie}</div>
    </div>
  )
}

export function HoyAlmacen() {
  const { data: orders } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const { data: products } = useProducts()
  const { data: shipments } = useShipments()
  const [preparar, setPreparar] = useState<OrderWithItems | null>(null)
  const [enviar, setEnviar] = useState<OrderWithItems | null>(null)
  const hoy = hoyLocal()

  const byId = useMemo(() => { const m: Record<string, ProductSafe | undefined> = {}; products.forEach((p) => (m[p.id] = p)); return m }, [products])
  const envioDe = useMemo(() => { const m: Record<string, Shipment> = {}; shipments.forEach((s) => { if (!m[s.order_id] || s.created_at > m[s.order_id].created_at) m[s.order_id] = s }); return m }, [shipments])

  const casos = useMemo(() => ordenarPorSalida(orders.map((o) => ({ o, accion: accionDe(o, byOrder[o.id]?.liberado ?? o.payment_status === 'paid', envioDe[o.id]) })).filter((x) => x.accion && x.accion.tipo !== 'despacho').map((x) => Object.assign(x.o, { __accion: x.accion! })) as Array<OrderWithItems & { __accion: Accion }>), [orders, byOrder, envioDe])
  const nPreparar = casos.filter((c) => c.__accion.tipo === 'preparar').length
  const nEnviar = casos.filter((c) => c.__accion.tipo === 'enviar').length
  const guiasHoy = shipments.filter((s) => s.carrier && s.tracking_number && diaLocal(s.created_at) === hoy)
  const recolecciones = shipments.map((s) => recoleccionDe(s)).filter((r): r is NonNullable<typeof r> => !!r && r.date === hoy)
  const rec = recolecciones[0]

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Almacén · Hoy</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tarjeta titulo="Esperan tu decisión" valor={casos.length} pie={`${nPreparar} por preparar · ${nEnviar} por enviar`} icono="layers" alerta={casos.length > 0} testid="hoy-decision" />
        <Tarjeta titulo="Guías DHL hoy" valor={guiasHoy.length} pie={guiasHoy.length ? 'generadas y con número de rastreo' : 'ninguna todavía'} icono="truck" testid="hoy-guias" />
        <Tarjeta titulo="Recolección DHL hoy" valor={rec ? `${rec.ready}–${rec.close}` : '—'} pie={rec ? <>Confirmada <span className="mono">{rec.confirmation}</span>{recolecciones.length > 1 ? ` · +${recolecciones.length - 1} más` : ''}</> : 'sin recolección agendada para hoy'} icono="clock" testid="hoy-recoleccion" />
        <Tarjeta titulo="En camino" valor={orders.filter((o) => o.status === 'shipped').length} pie="pedidos enviados sin confirmar entrega" icono="pkg" testid="hoy-camino" />
      </div>

      <div className="eyebrow">Esperan tu decisión <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>({casos.length} {casos.length === 1 ? 'caso' : 'casos'})</span></div>
      {casos.length === 0 ? (
        <Vacio icono="check" titulo="Nada pendiente por ahora." pista="Los pedidos pagados aparecen aquí para prepararlos y enviarlos." />
      ) : casos.map((o) => {
        const meta = (o.shipping_meta ?? {}) as { customer?: { name?: string } | null }
        const dir = orderAddress(o.shipping_meta, null)
        const ent = entregaDe(o)
        return (
          <div key={o.id} className="card" data-testid={`hoy-caso-${o.id}`} style={{ borderLeft: '4px solid ' + (o.__accion.tipo === 'preparar' ? 'var(--warn)' : 'var(--green-deep)') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
              <b style={{ fontSize: 14 }}>{meta.customer?.name ?? 'Cliente'}</b>
              <span className={'pill ' + (o.__accion.tipo === 'preparar' ? 'p-warn' : 'p-ok')}>{o.__accion.tipo === 'preparar' ? 'Por preparar' : 'Empacado · por enviar'}</span>
            </div>
            <EntregaPill e={ent} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>Productos a empacar</div>
                {o.items.map((it) => <div key={it.id} style={{ fontSize: 13 }}><b>{it.qty}</b> × {byId[it.product_id ?? '']?.name ?? 'Producto'}</div>)}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>{ent?.tipo === 'recoge' || ent?.tipo === 'mostrador' ? 'Entrega' : 'Dirección'}</div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{ent?.tipo === 'recoge' || ent?.tipo === 'mostrador' ? ent.texto : dir ? formatAddress(dir) : <span style={{ color: 'var(--warn)' }}>Sin dirección en el pedido</span>}{dir?.refs ? `\nRef.: ${dir.refs}` : ''}{dir?.phone ? `\nTel: ${dir.phone}` : ''}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              {o.__accion.tipo === 'preparar'
                ? <button className="btn" type="button" onClick={() => setPreparar(o)} data-testid={`hoy-preparar-${o.id}`}><Icon name="layers" /> Preparar pedido</button>
                : <button className="btn" type="button" onClick={() => setEnviar(o)} data-testid={`hoy-enviar-${o.id}`}><Icon name="truck" /> Asignar envío</button>}
            </div>
          </div>
        )
      })}
      {preparar && <SurtirModal order={preparar} productsById={byId} onClose={() => setPreparar(null)} />}
      {enviar && <AsignarModal order={enviar} onClose={() => setEnviar(null)} />}
    </div>
  )
}
