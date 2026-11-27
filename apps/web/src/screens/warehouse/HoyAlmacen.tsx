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
import { EntregarLote } from './EntregarLote'
import { useAgendaEntregas } from '../logistics/AgendaEntregas'
import { useRole } from '../../auth/RoleContext'
import type { ProductSafe, Shipment } from '../../data/types'
import { cantidadVista } from '../../lib/cajas'
import { capitalizarNombre } from '../../lib/nombres'
import { Hoja } from '../../app/Hoja'
import { useAnchoMinimo } from '../../app/useAnchoMinimo'

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
  // ENTREGAR VARIOS AL CHOFER: los locales ya preparados de una misma salida, de una vez.
  const [lote, setLote] = useState<{ pedidos: OrderWithItems[]; salida: string } | null>(null)
  const hoy = hoyLocal()
  const { setScreen, user, role } = useRole()
  const corte = useCorteEntrega()
  // FILA DEL DÍA (27 nov 2026) · el Inicio muestra TODO lo que le toca a Almacén, agrupado por cuándo sale: también lo
  // que ya tiene chofer y espera salida (antes desaparecía de aquí) y lo que espera a que el cliente lo recoja.
  const [filtro, setFiltro] = useState<'todos' | 'atrasados' | 'preparar' | 'salir' | 'recoger'>('todos')
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
  const atrasado = (o: OrderWithItems) => grupoDeSalida(entregaDe(o), hoy, corte).cuando === 'atrasado'
  const nAtrasados = casos.filter(atrasado).length
  const visibles = filtro === 'todos' ? casos : filtro === 'atrasados' ? casos.filter(atrasado) : filtro === 'preparar' ? casos.filter((c) => c.__accion.tipo === 'preparar') : filtro === 'salir' ? casos.filter((c) => c.__accion.tipo !== 'preparar') : []
  // Los atrasados van en UN solo grupo (antes: un grupito por cada día y paquetería); cada renglón dice cuándo debió salir.
  const grupos = agruparPorSalida(visibles, (o) => { const g = grupoDeSalida(entregaDe(o), hoy, corte); return g.cuando === 'atrasado' ? { titulo: 'Ya pasó su fecha de salida', cuando: g.cuando } : g })
  const debioSalir = (o: OrderWithItems) => { const g = grupoDeSalida(entregaDe(o), hoy, corte); return g.cuando === 'atrasado' ? g.titulo.replace(/ antes de las [^·]+/, ' ').replace(/\s+/g, ' ').trim() : null }
  const verRecoger = (filtro === 'todos' || filtro === 'recoger') && recoger.length > 0
  const total = casos.length + recoger.length
  const guiasHoy = shipments.filter((s) => s.carrier && s.tracking_number && diaLocal(s.created_at) === hoy)
  const recolecciones = shipments.map((s) => recoleccionDe(s)).filter((r): r is NonNullable<typeof r> => !!r && r.date === hoy)
  const rec = recolecciones[0]

  const chip = (clave: typeof filtro, texto: string, n: number) => (
    <button type="button" className={'fchip' + (clave === 'atrasados' ? ' fchip--aviso' : '') + (filtro === clave ? ' on' : '')} aria-pressed={filtro === clave} onClick={() => setFiltro(clave)} data-testid={`hoy-filtro-${clave}`}>{texto} <b>{n}</b></button>
  )
  // LISTA + DETALLE (27 nov 2026, dueño: «¿ya se ve moderna?» — todavía no): había una tarjeta enorme por pedido, con su
  // barra de color y el mismo botón repetido 41 veces, y un tercio de la pantalla vacío. Ahora los pedidos van en UNA
  // lista de renglones cortos y el pedido elegido se abre al lado (en el celular, en una hoja) con sus productos, su
  // dirección y su botón. Alberto sigue viendo el pedido completo en la misma pantalla y cada botón hace lo de siempre.
  type Caso = (typeof casos)[number]
  const ancho = useAnchoMinimo(1000)
  const [sel, setSel] = useState<string | null>(null)
  const claves = [...visibles.map((o) => o.id), ...(verRecoger ? recoger.map((o) => 'r:' + o.id) : [])]
  const elegido = sel && claves.includes(sel) ? sel : ancho ? claves[0] ?? null : null   // en computadora siempre hay uno abierto
  const pedido = elegido && !elegido.startsWith('r:') ? visibles.find((o) => o.id === elegido) ?? null : null
  const porRecoger = elegido && elegido.startsWith('r:') ? recoger.find((o) => 'r:' + o.id === elegido) ?? null : null
  const nombreDe = (o: OrderWithItems) => capitalizarNombre(((o.shipping_meta ?? {}) as { customer?: { name?: string } | null }).customer?.name) || 'Cliente'
  const lugarDe = (o: OrderWithItems) => {
    const ent = entregaDe(o)
    if (ent?.tipo === 'recoge' || ent?.tipo === 'mostrador') return 'Recoge en sucursal'
    const d = orderAddress(o.shipping_meta, null)
    return [d?.city, d?.state].filter(Boolean).join(', ') || 'Sin dirección'
  }
  // AUXILIAR (Blanca): la guía de paquetería la genera Almacén. En vez de un botón que la lleva a un aviso, lo dice aquí.
  const leTocaAAlmacen = (o: Caso) => role === 'packing' && o.__accion.tipo === 'enviar' && metodoSugerido(entregaDe(o)) === 'paqueteria'
  const pasoDe = (o: Caso) => (leTocaAAlmacen(o) ? { texto: 'Espera la guía', pill: 'p-neu' } : o.__accion.tipo === 'preparar' ? { texto: 'Por preparar', pill: 'p-warn' } : o.__accion.tipo === 'despacho' ? { texto: 'Falta darle salida', pill: 'p-blue' } : { texto: 'Preparado', pill: 'p-ok' })
  // En el celular el detalle es una hoja: se cierra antes de abrir la ventana de la acción (no se enciman dos capas).
  const accion = (o: Caso, que: 'preparar' | 'enviar') => { if (!ancho) setSel(null); if (que === 'preparar') setPreparar(o); else setEnviar(o) }
  const boton = (o: Caso) => {
    const ent = entregaDe(o); const envio = envioDe[o.id]
    if (leTocaAAlmacen(o)) return <span className="hoy-le-toca" data-testid={`hoy-le-toca-${o.id}`}>Le toca a Alberto: generar la guía. Déjalo empacado y listo.</span>
    return o.__accion.tipo === 'preparar'
      ? <button className="btn hoy-accion" type="button" onClick={() => accion(o, 'preparar')} data-testid={`hoy-preparar-${o.id}`}><Icon name="layers" /> Preparar pedido</button>
      : o.__accion.tipo === 'despacho' && envio
      ? <button className="btn hoy-accion" type="button" disabled={despachando === o.id} onClick={() => void despachar(o, envio)} data-testid={`hoy-despachar-${o.id}`}><Icon name="truck" /> {despachando === o.id ? 'Despachando…' : 'Ya le entregué la carga: despachar'}</button>
      : <button className="btn hoy-accion" type="button" onClick={() => accion(o, 'enviar')} data-testid={`hoy-enviar-${o.id}`}><Icon name="truck" /> {textoSiguientePaso(ent ? metodoSugerido(ent) : null)}</button>
  }
  const cuerpo = (o: Caso) => {
    const dir = orderAddress(o.shipping_meta, null)
    const ent = entregaDe(o); const envio = envioDe[o.id]; const paso = pasoDe(o)
    const recoge = ent?.tipo === 'recoge' || ent?.tipo === 'mostrador'
    return (
      <div className="hoy-detalle-cuerpo" data-testid={`hoy-detalle-${o.id}`}>
        <div className="hoy-detalle-cab">
          <div className="hoy-detalle-nombre">{nombreDe(o)}</div>
          <div className="hoy-detalle-sub"><span className="mono">{o.external_ref}</span><span className={'pill ' + paso.pill}>{o.__accion.tipo === 'despacho' ? `Con ${driverName(envio?.driver_id ?? null)} · falta darle salida` : paso.texto}</span></div>
        </div>
        <EntregaPill e={ent} />
        <div>
          <h4>Productos a empacar</h4>
          {o.items.map((it) => <div key={it.id} className="hoy-detalle-prod"><b>{cantidadVista(byId[it.product_id ?? ''], it.qty)}</b> × {byId[it.product_id ?? '']?.name ?? 'Producto'}{/* CAJAS-MEDIOS */}</div>)}
        </div>
        <div>
          <h4>{recoge ? 'Entrega' : 'Dirección'}</h4>
          <div className="hoy-detalle-dir">{recoge ? ent?.texto : dir ? formatAddress(dir) : <span style={{ color: 'var(--warn)' }}>Sin dirección en el pedido</span>}{dir?.refs ? `\nRef.: ${dir.refs}` : ''}{dir?.phone ? `\nTel: ${dir.phone}` : ''}</div>
        </div>
        {errDespacho[o.id] && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>{errDespacho[o.id]}</div>}
      </div>
    )
  }
  const filaRecoger = (o: OrderWithItems) => <FilaRecoger o={o} nombreProducto={(id) => byId[id]?.name ?? 'Producto'} producto={(id) => byId[id]} />
  const renglon = (clave: string, o: OrderWithItems, paso: { texto: string; pill: string }) => (
    <button key={clave} type="button" className={'taskrow hoy-renglon' + (elegido === clave ? ' hoy-renglon--sel' : '')} aria-pressed={elegido === clave} onClick={() => setSel(clave)} data-testid={`hoy-caso-${o.id}`}>
      <span className="taskrow-tx">
        <span className="taskrow-t">{nombreDe(o)}</span>
        <span className="taskrow-d"><span className="mono">{o.external_ref}</span> · {o.items.length} producto{o.items.length === 1 ? '' : 's'} · {lugarDe(o)}</span>
        {debioSalir(o) && <span className="taskrow-d hoy-renglon-atraso">{debioSalir(o)}</span>}
      </span>
      <span className={'pill ' + paso.pill} data-testid="hoy-paso">{paso.texto}</span>
    </button>
  )
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="hoy-fila-cab">
        <div className="eyebrow" style={{ margin: 0 }}>La fila de hoy <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>({total} {total === 1 ? 'pedido' : 'pedidos'}, por hora de salida)</span></div>
        <div className="hoy-filtros" role="group" aria-label="Ver solo una parte de la fila">
          {chip('todos', 'Todos', total)}
          {nAtrasados > 0 && chip('atrasados', 'Atrasados', nAtrasados)}
          {chip('preparar', 'Por preparar', nPreparar)}
          {chip('salir', 'Por salir', nSalir)}
          {chip('recoger', 'Para recoger', recoger.length)}
        </div>
      </div>
      {/* UN solo aviso de atraso, en vez de pintar de rojo cada grupo. En el celular basta el filtro «Atrasados N». */}
      {ancho && nAtrasados > 0 && filtro !== 'atrasados' && (
        <div className="hoy-atraso" role="status" data-testid="hoy-atraso">
          <Icon name="clock" />
          <span><b>{nAtrasados} {nAtrasados === 1 ? 'pedido ya pasó' : 'pedidos ya pasaron'} su fecha de salida.</b> Si ya {nAtrasados === 1 ? 'salió' : 'salieron'}, falta registrarlo.</span>
          <button type="button" className="btn ghost sm" onClick={() => setFiltro('atrasados')} data-testid="hoy-atraso-ver">Ver solo esos</button>
        </div>
      )}
      {claves.length === 0 ? (
        <Vacio icono="check" titulo={filtro === 'todos' ? 'Nada pendiente por ahora.' : 'Nada en esta parte de la fila.'} pista={filtro === 'todos' ? 'Los pedidos pagados aparecen aquí para prepararlos y enviarlos.' : 'Toca «Todos» para ver la fila completa.'} />
      ) : (
        <div className={'hoy-md' + (ancho ? '' : ' hoy-md--solo')}>
          <div className="tasklist hoy-lista" data-testid="hoy-lista">
            {grupos.map((g) => (
              <React.Fragment key={g.titulo + g.items[0].id}>
                <div className="hoy-grupo" data-testid="hoy-grupo"><Icon name="clock" /> {g.titulo} <span>({g.items.length})</span>{(() => {
                  // Los que ya están preparados y se vendieron con chofer, todavía sin asignar. Con dos o más, un solo botón.
                  const listos = g.items.filter((o) => o.__accion.tipo === 'enviar' && metodoSugerido(entregaDe(o)) === 'chofer')
                  return listos.length >= 2 ? <button type="button" className="btn sm hoy-lote" onClick={() => setLote({ pedidos: listos, salida: g.titulo })} data-testid="hoy-lote">Entregar los {listos.length} al chofer</button> : null
                })()}</div>
                {g.items.map((o) => renglon(o.id, o, pasoDe(o)))}
              </React.Fragment>
            ))}
            {verRecoger && (
              <>
                <div className="hoy-grupo" data-testid="hoy-grupo-recoger"><Icon name="box" /> Esperan a que el cliente los recoja <span>({recoger.length})</span></div>
                {recoger.map((o) => renglon('r:' + o.id, o, { texto: 'Listo para recoger', pill: 'p-ok' }))}
              </>
            )}
          </div>
          {ancho && (
            <aside className="card hoy-detalle" data-testid="hoy-detalle" aria-label="Pedido elegido">
              {pedido ? <>{cuerpo(pedido)}<div className="hoy-detalle-accion">{boton(pedido)}</div></> : porRecoger ? filaRecoger(porRecoger) : null}
            </aside>
          )}
        </div>
      )}
      {!ancho && (
        <Hoja abierta={!!(pedido || porRecoger)} onCerrar={() => setSel(null)} titulo={pedido ? `Pedido ${pedido.external_ref ?? ''}` : 'Para recoger'} pie={pedido ? boton(pedido) : undefined} testid="hoy-hoja">
          {pedido ? cuerpo(pedido) : porRecoger ? filaRecoger(porRecoger) : null}
        </Hoja>
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
      {lote && <EntregarLote pedidos={lote.pedidos} salida={lote.salida} quien={user?.name ?? 'Almacén'} onCerrar={() => setLote(null)} />}
    </div>
  )
}
