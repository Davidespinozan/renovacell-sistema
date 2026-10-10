// TABLERO de Administración: centro de mando. Solo lectura; AGREGA de los stores
// compartidos (orders, shipments, lots) y reutiliza los detectores existentes
// (atorados de Seguimiento, caducidad de Almacén). No inventa datos nuevos.
import { Cargando, CargandoKpis } from '../../app/EmptyState'
import React, { useMemo, useState } from 'react'
import { Icon, type IconName } from '../../app/icons'
import { ExportButton } from '../../app/ExportButton'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useShipments } from '../../data/hooks/useShipments'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import { diagnoseShipment, isSurtible } from '../../data/ops/seguimiento'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { useKpiVentas, useKpiPorCobrar } from '../../data/hooks/useKpis'
import { avanceDeCobro } from '../../data/kpis'
import { esteMes, mesPasado, todoElHistorico, hoyNegocio } from '../../data/periodo'
import { cifra, AvisoKpi } from '../../app/Kpi'
import { doctorActivity, leadTime, valorEnRiesgo, doctoresEnRiesgo, DIAS_RIESGO } from '../../data/metrics'
import { statusView } from '../doctor/orderStatus'
import { daysUntil, severity, sevPill, sevLabel } from '../warehouse/expiry'

type Bucket = 'Pedido' | 'Empacado' | 'En camino' | 'Entregado'
function bucketOf(status: string | null): Bucket | null {
  if (['draft', 'pending_payment', 'paid', 'picking'].includes(status ?? '')) return 'Pedido'
  if (status === 'packed') return 'Empacado'
  if (status === 'shipped') return 'En camino'
  if (status === 'delivered' || status === 'fulfilled') return 'Entregado'
  return null // cancelado
}

export function Tablero() {
  const { data: orders, loading: cargandoPedidos } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const { data: shipments } = useShipments()
  const { data: lots } = useLots()
  const { data: products } = useProducts()

  // CIFRAS DE CABECERA: las responde el servidor (kpi_ventas / kpi_por_cobrar), con el
  // mes del NEGOCIO. Aquí no se suma dinero de pedidos.
  const hoy = hoyNegocio()
  const pMes = useMemo(() => esteMes(), [hoy])           // eslint-disable-line react-hooks/exhaustive-deps
  const pAnterior = useMemo(() => mesPasado(), [hoy])    // eslint-disable-line react-hooks/exhaustive-deps
  const pTodo = useMemo(() => todoElHistorico(), [])
  const kMes = useKpiVentas(pMes)
  const kAnterior = useKpiVentas(pAnterior)
  const kTodo = useKpiVentas(pTodo)
  const cxc = useKpiPorCobrar()

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])

  // Servicio: cuánto tardamos de pedido a entrega. Riesgo: cuánto dinero está por caducar.
  const lt = useMemo(() => leadTime(orders, shipments), [orders, shipments])
  const act = doctorActivity(orders)
  // Dato hero = ventas del MES en curso + variación vs el mes anterior (ambos del servidor).
  const deltaPct = kMes.data && kAnterior.data && kAnterior.data.ventas > 0
    ? ((kMes.data.ventas - kAnterior.data.ventas) / kAnterior.data.ventas) * 100 : null
  const avance = kMes.data ? avanceDeCobro(kMes.data) : null

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

  const porSurtir = orders.filter((o) => isSurtible(o, byOrder[o.id]))

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
  const riesgo = useMemo(() => valorEnRiesgo(porCaducar.map(({ lot }) => lot)), [porCaducar])
  // Un lote sin costo no vale cero: el valor se muestra como mínimo y se dice cuántos faltan.
  const riesgoTexto = riesgo.completo
    ? `${money(riesgo.valor)} en riesgo`
    : `al menos ${money(riesgo.valor)} en riesgo · ${riesgo.lotesSinCosto} lote(s) sin costo`

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow">Administración · Tablero</div>
        <ExportButton
          name="tablero-indicadores"
          style={{ marginLeft: 'auto' }}
          rows={[
            { indicador: `Ventas · ${pMes.etiqueta}`, valor: kMes.data?.ventas ?? 'No disponible' },
            { indicador: `Cobrado · ${pMes.etiqueta}`, valor: kMes.data?.cobrado_neto ?? 'No disponible' },
            { indicador: 'Por cobrar · a hoy', valor: cxc.data?.total ?? 'No disponible' },
            { indicador: 'Pedidos · histórico', valor: kTodo.data?.pedidos ?? 'No disponible' },
            { indicador: 'Ventas · histórico', valor: kTodo.data?.ventas ?? 'No disponible' },
            { indicador: 'Ticket promedio · histórico', valor: kTodo.data?.ticket ?? 'No disponible' },
            { indicador: 'Doctores con compra · histórico', valor: act.active },
            { indicador: 'Por surtir', valor: porSurtir.length },
            { indicador: 'Envíos atorados', valor: atorados.length },
            { indicador: 'Lotes por caducar', valor: porCaducar.length },
            { indicador: riesgo.completo ? 'Valor en riesgo por caducidad' : 'Valor en riesgo por caducidad (mínimo: hay lotes sin costo)', valor: riesgo.valor },
            { indicador: 'Lotes por caducar sin costo registrado', valor: riesgo.lotesSinCosto },
            { indicador: 'Lead time pedido→entrega (días)', valor: lt.promedioDias ?? '' },
            { indicador: 'Entregas medidas', valor: lt.entregados },
          ]}
          columns={[
            { key: 'indicador', label: 'Indicador' },
            { key: 'valor', label: 'Valor' },
          ]}
        />
      </div>
      {cargandoPedidos && orders.length === 0 ? (<><CargandoKpis n={4} /><Cargando filas={4} /></>) : (<>

      <AvisoKpi estados={[kMes, kAnterior, kTodo, cxc]} />

      {/* Dato HERO (estilo app) */}
      <div className="grid two" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="feature">
          <div className="fk">Ventas · {pMes.etiqueta}</div>
          <div className="fv">{cifra(kMes, (k) => money(k.ventas))}</div>
          <div className="fs">
            {deltaPct != null && <span className={'delta ' + (deltaPct >= 0 ? 'up' : 'down')}>{deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%</span>}
            <span>vs. {pAnterior.etiqueta.toLowerCase()} · {cifra(kTodo, (k) => money(k.ventas))} histórico</span>
          </div>
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="eyebrow" style={{ margin: '0 0 12px' }}>Pedidos por estatus</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(['Pedido', 'Empacado', 'En camino', 'Entregado'] as Bucket[]).map((b) => (
              <div key={b} className="sl-stat" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b className="mono" style={{ fontSize: 18 }}>{porEstatus[b]}</b> {b}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TU DINERO (posición de cobranza del mes, en lenguaje llano — inspirado en CuboPolar) */}
      <div>
        <div className="eyebrow" style={{ margin: '0 0 12px' }}>Tu dinero · {pMes.etiqueta}</div>
        <div className="grid sigs">
          <Sig icon="chart" value={cifra(kMes, (k) => money(k.ventas))} k="Vendiste" s="pedidos levantados en el mes" />
          <Sig icon="receipt" value={cifra(kMes, (k) => money(k.cobrado_neto))} k="Cobrado en el mes" s="dinero que entró en el mes, menos lo que salió" />
          <Sig icon="check" value={cifra(kMes, () => (avance == null ? '—' : `${Math.round(avance)}%`))} k="Avance de cobro" s="de lo vendido en el mes, ya cobrado" tone={avance != null && avance < 70 ? 'warn' : undefined} />
          <Sig icon="clock" value={cifra(cxc, (c) => money(c.total))} k="Te deben" s={cxc.data ? `a hoy · ${cxc.data.pedidos} pedido(s) con saldo · incluye crédito` : 'saldo a hoy'} tone={cxc.data && cxc.data.total > 0 ? 'warn' : undefined} />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid sigs">
        <Sig icon="bag" value={cifra(kTodo, (k) => String(k.pedidos))} k="Pedidos" s="histórico · ventas confirmadas" />
        <Sig icon="chart" value={cifra(kTodo, (k) => money(k.ventas))} k="Ventas" s="histórico" />
        <Sig icon="receipt" value={cifra(kTodo, (k) => money(k.ticket))} k="Ticket promedio" s="histórico · por pedido" />
        <Sig icon="usercheck" value={String(act.active)} k="Doctores con compra" s="histórico" />
        <Sig icon="layers" value={String(porSurtir.length)} k="Por surtir" s="pendientes en almacén" tone={porSurtir.length ? 'warn' : undefined} />
        <Sig icon="truck" value={String(atorados.length)} k="Atorados" s="requieren atención" tone={atorados.length ? 'dang' : undefined} />
        <Sig icon="clock" value={String(porCaducar.length)} k="Lotes por caducar" s={porCaducar.length ? riesgoTexto : '≤ 60 días o caducados'} tone={porCaducar.length ? 'warn' : undefined} />
        <Sig icon="truck" value={lt.promedioDias == null ? '—' : `${lt.promedioDias} d`} k="Pedido → entrega" s={lt.entregados ? `promedio de ${lt.entregados} entregas · peor ${lt.peorDias} d` : 'sin entregas aún'} />
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
          <table className="tbl-cards">
            <thead><tr><th>Pedido</th><th>Estatus</th><th>Fecha</th><th>Total</th></tr></thead>
            <tbody>
              {recientes.map((o) => {
                const sv = statusView(o.status)
                return (
                  <tr key={o.id}>
                    <td data-label="Pedido" className="mono">{o.external_ref}</td>
                    <td data-label="Estatus"><span className={'pill ' + sv.pill}>{sv.label}</span></td>
                    <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                    <td data-label="Total" className="mono">{money(o.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <DoctoresRiesgo />
      </>)}
    </div>
  )
}

// Retención: doctores verificados que ya compraban y llevan tiempo sin pedir.
// Lista para LLAMAR antes de perderlos, ordenada por urgencia, con contacto directo.
function DoctoresRiesgo() {
  const { data: orders } = useAllOrders()
  const { data: doctors } = useDoctors()
  const [days, setDays] = useState(DIAS_RIESGO)
  const enRiesgo = useMemo(() => doctoresEnRiesgo(orders, doctors, { days }), [orders, doctors, days])
  const OPCIONES = [30, 45, 60, 90]

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Doctores en riesgo · llámalos</div>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          {OPCIONES.map((d) => (
            <button key={d} type="button" className={days === d ? 'active' : undefined} onClick={() => setDays(d)}>+{d}d</button>
          ))}
        </div>
        {enRiesgo.length > 0 && (
          <ExportButton name={`doctores-en-riesgo-${days}d`} rows={enRiesgo} columns={[
            { key: 'name', label: 'Doctor' },
            { key: 'organization', label: 'Consultorio' },
            { key: 'diasSinPedir', label: 'Días sin pedir' },
            { key: 'lastOrder', label: 'Último pedido', format: (v) => fmtDate(v as string) },
            { key: 'orders', label: 'Pedidos' },
            { key: 'total', label: 'Gasto histórico', format: (v) => money(v as number) },
            { key: 'phone', label: 'Teléfono' },
            { key: 'email', label: 'Correo' },
          ]} />
        )}
      </div>
      <div style={{ padding: '10px 18px 6px', fontSize: 12.5, color: 'var(--ink-3)' }}>
        Doctores verificados que ya compraron y llevan <b>{days} días o más</b> sin pedir. Contáctalos antes de perderlos.
      </div>
      <div style={{ padding: '0 14px 8px' }}>
        {enRiesgo.length === 0 ? (
          <div style={{ padding: '14px 4px', color: 'var(--ink-3)', fontSize: 13 }}>Ningún doctor con +{days} días sin pedir. 👍</div>
        ) : (
          <table className="tbl-cards">
            <thead><tr><th>Doctor</th><th>Sin pedir</th><th>Histórico</th><th>Contacto</th></tr></thead>
            <tbody>
              {enRiesgo.slice(0, 20).map((d) => (
                <tr key={d.id}>
                  <td data-label="Doctor">
                    <div style={{ fontWeight: 600 }}>{d.name}</div>
                    {d.organization && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{d.organization}</div>}
                  </td>
                  <td data-label="Sin pedir">
                    <span className={'pill ' + (d.diasSinPedir >= 90 ? 'p-dang' : d.diasSinPedir >= 60 ? 'p-warn' : 'p-neu')}>{d.diasSinPedir} días</span>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>últ. {fmtDate(d.lastOrder)}</div>
                  </td>
                  <td data-label="Histórico" className="mono">{money(d.total)}<div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{d.orders} pedido(s)</div></td>
                  <td data-label="Contacto">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {d.phone && <a className="btn ghost sm" href={`tel:${d.phone}`}><Icon name="usercheck" /> Llamar</a>}
                      {d.email && <a className="btn ghost sm" href={`mailto:${d.email}`}>Correo</a>}
                      {!d.phone && !d.email && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Sin contacto</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {enRiesgo.length > 20 && <div style={{ padding: '8px 4px', fontSize: 12, color: 'var(--ink-3)' }}>…y {enRiesgo.length - 20} más (usa Exportar para verlos todos).</div>}
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
