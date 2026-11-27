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
import { AsignarModal, EntregaPill, entregaDe, metodoSugerido, ordenarPorSalida } from '../packing/Cola'
import { textoSiguientePaso } from '../../data/ops/entregarChofer'
import { agruparPorSalida, grupoDeSalida } from '../../data/ops/entrega'
import { useCorteEntrega } from '../../data/hooks/useCorteEntrega'
import { envioVigente } from '../../data/ops/seguimiento'
import { markShipped } from '../../data/store/ordersStore'
import { driverName } from '../../data/mock/shipments'
import { FilaRecoger, paraRecoger } from '../logistics/ParaRecoger'
import { SurtirModal } from './Surtido'
import { useAgendaEntregas } from '../logistics/AgendaEntregas'
import { useRole } from '../../auth/RoleContext'
import type { ProductSafe, Shipment } from '../../data/types'
import { cantidadVista } from '../../lib/cajas'

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
    // Tamaños en pulido-operacion.css (.hoy-kpi-*): en teléfono la rejilla pasa a 2 columnas compactas.
    <div className="card hoy-kpi" style={{ border: alerta ? '1.5px solid var(--warn)' : undefined, minWidth: 0 }} data-testid={testid}>
      <div className="hoy-kpi-t">{titulo}<span style={{ marginLeft: 'auto', color: alerta ? 'var(--warn)' : 'var(--green-deep)' }}><Icon name={icono} /></span></div>
      <div className="hoy-kpi-v" style={{ color: alerta ? 'var(--warn)' : 'var(--ink)' }}>{valor}</div>
      <div className="hoy-kpi-p">{pie}</div>
    </div>
  )
}

export function HoyAlmacen() {
  const { data: orders } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const { data: products } = useProducts()
  const { data: shipments, dispatchShipment } = useShipments()
  const [preparar, setPreparar] = useState<OrderWithItems | null>(null)
  const [enviar, setEnviar] = useState<OrderWithItems | null>(null)
  const hoy = hoyLocal()
  const { setScreen, user } = useRole()
  const corte = useCorteEntrega()
  // FILA DEL DÍA (27 nov 2026) · el Inicio muestra TODO lo que le toca a Almacén, agrupado por cuándo sale: también lo
  // que ya tiene chofer y espera salida (antes desaparecía de aquí) y lo que espera a que el cliente lo recoja.
  const [filtro, setFiltro] = useState<'todos' | 'preparar' | 'salir' | 'recoger'>('todos')
  const [despachando, setDespachando] = useState<string | null>(null)
  const [errDespacho, setErrDespacho] = useState<Record<string, string>>({})
  const despachar = async (o: OrderWithItems, envio: Shipment) => {
    if (!envio.driver_id || despachando) return
    setDespachando(o.id); setErrDespacho((m) => ({ ...m, [o.id]: '' }))
    const d = await dispatchShipment(envio.id, user?.name ?? 'Almacén', o.external_ref ?? o.id)
    const e = d.ok ? await markShipped(o.id, { method: 'chofer', driver: driverName(envio.driver_id), driver_id: envio.driver_id }) : d
    setDespachando(null)
    if (!e.ok) setErrDespacho((m) => ({ ...m, [o.id]: d.ok ? `La carga salió, pero el pedido NO pasó a En camino. ${e.error}` : `NO se despachó. ${e.error}` }))
  }
  // ENT-H · entregas locales de hoy con su horario (agenda del servidor).
  const agenda = useAgendaEntregas(hoy, hoy)
  const diaHoy = agenda.data?.dias.find((d) => d.fecha === hoy) ?? null
  const entregasHoy = diaHoy ? diaHoy.slots.flatMap((s) => s.pedidos.filter((p) => p.estado_pedido !== 'cancelled').map((p) => ({ ...p, inicio: s.inicio, fin: s.fin }))) : []
  const proxima = entregasHoy.find((e) => e.estado_pedido !== 'delivered')

  const byId = useMemo(() => { const m: Record<string, ProductSafe | undefined> = {}; products.forEach((p) => (m[p.id] = p)); return m }, [products])
  const envioDe = useMemo(() => { const m: Record<string, Shipment> = {}; shipments.forEach((s) => { if (!m[s.order_id] || s.created_at > m[s.order_id].created_at) m[s.order_id] = s }); return m }, [shipments])

  const casos = useMemo(() => ordenarPorSalida(orders.map((o) => ({ o, accion: accionDe(o, byOrder[o.id]?.liberado ?? o.payment_status === 'paid', envioDe[o.id]) })).filter((x) => x.accion).map((x) => Object.assign(x.o, { __accion: x.accion! })) as Array<OrderWithItems & { __accion: Accion }>), [orders, byOrder, envioDe])
  const nPreparar = casos.filter((c) => c.__accion.tipo === 'preparar').length
  const nSalir = casos.length - nPreparar   // preparados: por asignar envío o con chofer esperando salida
  const recoger = useMemo(() => paraRecoger(orders, (id) => !!envioVigente(shipments, id)), [orders, shipments])
  const visibles = filtro === 'todos' ? casos : filtro === 'preparar' ? casos.filter((c) => c.__accion.tipo === 'preparar') : filtro === 'salir' ? casos.filter((c) => c.__accion.tipo !== 'preparar') : []
  const grupos = agruparPorSalida(visibles, (o) => grupoDeSalida(entregaDe(o), hoy, corte))
  const verRecoger = (filtro === 'todos' || filtro === 'recoger') && recoger.length > 0
  const total = casos.length + recoger.length
  const guiasHoy = shipments.filter((s) => s.carrier && s.tracking_number && diaLocal(s.created_at) === hoy)
  const recolecciones = shipments.map((s) => recoleccionDe(s)).filter((r): r is NonNullable<typeof r> => !!r && r.date === hoy)
  const rec = recolecciones[0]

  const chip = (clave: typeof filtro, texto: string, n: number) => (
    <button type="button" className={'fchip' + (filtro === clave ? ' on' : '')} aria-pressed={filtro === clave} onClick={() => setFiltro(clave)} data-testid={`hoy-filtro-${clave}`}>{texto} <b>{n}</b></button>
  )
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hoy-fila-cab">
        <div className="eyebrow" style={{ margin: 0 }}>La fila de hoy <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>({total} {total === 1 ? 'pedido' : 'pedidos'}, por hora de salida)</span></div>
        <div className="hoy-filtros" role="group" aria-label="Ver solo una parte de la fila">
          {chip('todos', 'Todos', total)}
          {chip('preparar', 'Por preparar', nPreparar)}
          {chip('salir', 'Por salir', nSalir)}
          {chip('recoger', 'Para recoger', recoger.length)}
        </div>
      </div>
      {grupos.length === 0 && !verRecoger ? (
        <Vacio icono="check" titulo={filtro === 'todos' ? 'Nada pendiente por ahora.' : 'Nada en esta parte de la fila.'} pista={filtro === 'todos' ? 'Los pedidos pagados aparecen aquí para prepararlos y enviarlos.' : 'Toca «Todos» para ver la fila completa.'} />
      ) : grupos.map((g) => (
        <React.Fragment key={g.titulo + g.items[0].id}>
          <div className={'hoy-grupo hoy-grupo--' + g.cuando} data-testid="hoy-grupo"><Icon name="clock" /> {g.titulo} <span>({g.items.length})</span></div>
          {g.items.map((o) => {
          const meta = (o.shipping_meta ?? {}) as { customer?: { name?: string } | null }
          const dir = orderAddress(o.shipping_meta, null)
          const ent = entregaDe(o)
          const envio = envioDe[o.id]
          return (
            <div key={o.id} className="card" data-testid={`hoy-caso-${o.id}`} style={{ borderLeft: '4px solid ' + (o.__accion.tipo === 'preparar' ? 'var(--warn)' : 'var(--green-deep)') }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
                <b style={{ fontSize: 14 }}>{meta.customer?.name ?? 'Cliente'}</b>
                <span className={'pill ' + (o.__accion.tipo === 'preparar' ? 'p-warn' : o.__accion.tipo === 'despacho' ? 'p-blue' : 'p-ok')} data-testid="hoy-paso">{o.__accion.tipo === 'preparar' ? 'Por preparar' : o.__accion.tipo === 'despacho' ? `Con ${driverName(envio?.driver_id ?? null)} · falta darle salida` : 'Preparado · por salir'}</span>
              </div>
              <EntregaPill e={ent} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>Productos a empacar</div>
                  {o.items.map((it) => <div key={it.id} style={{ fontSize: 13 }}><b>{cantidadVista(byId[it.product_id ?? ''], it.qty)}</b> × {byId[it.product_id ?? '']?.name ?? 'Producto'}{/* CAJAS-MEDIOS */}</div>)}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>{ent?.tipo === 'recoge' || ent?.tipo === 'mostrador' ? 'Entrega' : 'Dirección'}</div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{ent?.tipo === 'recoge' || ent?.tipo === 'mostrador' ? ent.texto : dir ? formatAddress(dir) : <span style={{ color: 'var(--warn)' }}>Sin dirección en el pedido</span>}{dir?.refs ? `\nRef.: ${dir.refs}` : ''}{dir?.phone ? `\nTel: ${dir.phone}` : ''}</div>
                </div>
              </div>
              {errDespacho[o.id] && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{errDespacho[o.id]}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                {o.__accion.tipo === 'preparar'
                  ? <button className="btn" type="button" onClick={() => setPreparar(o)} data-testid={`hoy-preparar-${o.id}`}><Icon name="layers" /> Preparar pedido</button>
                  : o.__accion.tipo === 'despacho' && envio
                  ? <button className="btn" type="button" disabled={despachando === o.id} onClick={() => void despachar(o, envio)} data-testid={`hoy-despachar-${o.id}`}><Icon name="truck" /> {despachando === o.id ? 'Despachando…' : 'Ya le entregué la carga: despachar'}</button>
                  : <button className="btn" type="button" onClick={() => setEnviar(o)} data-testid={`hoy-enviar-${o.id}`}><Icon name="truck" /> {textoSiguientePaso(ent ? metodoSugerido(ent) : null)}</button>}
              </div>
            </div>
          )
          })}
        </React.Fragment>
      ))}
      {verRecoger && (
        <>
          <div className="hoy-grupo" data-testid="hoy-grupo-recoger"><Icon name="box" /> Esperan a que el cliente los recoja <span>({recoger.length})</span></div>
          {recoger.map((o) => <FilaRecoger key={o.id} o={o} nombreProducto={(id) => byId[id]?.name ?? 'Producto'} producto={(id) => byId[id]} />)}
        </>
      )}

      <div className="eyebrow" style={{ margin: '6px 0 0' }}>El día en números</div>
      {/* Rejilla de indicadores: auto-fit en escritorio; ≤640 px, 2 columnas para que el trabajo del día
          (la lista de abajo) no quede a cinco tarjetas de distancia. */}
      <div className="hoy-kpis">
        <Tarjeta titulo="Esperan tu decisión" valor={casos.length} pie={`${nPreparar} por preparar · ${nSalir} por salir`} icono="layers" alerta={casos.length > 0} testid="hoy-decision" />
        <Tarjeta titulo="Guías DHL hoy" valor={guiasHoy.length} pie={guiasHoy.length ? 'generadas y con número de rastreo' : 'ninguna todavía'} icono="truck" testid="hoy-guias" />
        <Tarjeta titulo="Recolección DHL hoy" valor={rec ? `${rec.ready}–${rec.close}` : <span className="hoy-kpi-tenue">Sin agendar</span>} pie={rec ? <>Confirmada <span className="mono">{rec.confirmation}</span>{recolecciones.length > 1 ? ` · +${recolecciones.length - 1} más` : ''}</> : 'sin recolección agendada para hoy'} icono="clock" testid="hoy-recoleccion" />
        <Tarjeta titulo="En camino" valor={orders.filter((o) => o.status === 'shipped').length} pie="pedidos enviados sin confirmar entrega" icono="pkg" testid="hoy-camino" />
        <div role="button" tabIndex={0} onClick={() => setScreen('agenda_entregas')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setScreen('agenda_entregas') }} style={{ cursor: 'pointer', display: 'contents' }} aria-label="Ver horarios de entrega">
          <Tarjeta titulo="Entregas locales hoy" valor={agenda.data ? entregasHoy.length : '—'} pie={agenda.error ? 'No se pudo leer la agenda' : proxima ? <>Siguiente <b>{proxima.inicio}</b> · {proxima.cliente}</> : entregasHoy.length ? 'todas entregadas' : 'ninguna agendada · ver horarios'} icono="clock" alerta={!!proxima} testid="hoy-entregas-locales" />
        </div>
      </div>
      {preparar && <SurtirModal order={preparar} productsById={byId} onClose={() => setPreparar(null)} />}
      {enviar && <AsignarModal order={enviar} onClose={() => setEnviar(null)} />}
    </div>
  )
}
