// ADMIN · Ventas → Detalle — el LIBRO DE VENTAS (solo lectura). Pedidos del
// Portal + ventas POS (mismo store), filtrable. NO es el Tablero ni Trazabilidad.
// Agrega de useAllOrders + useProducts + useDoctors vía data/metrics. Migrable a
// un select sobre Supabase sin tocar la pantalla.
import { orderClientName } from '../../data/ops/orderClient'
import { escucharFiltro, tomarFiltro, verFiltro } from '../../data/store/filtroInicial'
import { capitalizarNombre } from '../../lib/nombres'
import { avisar, pedirTexto } from '../../app/dialogos'   // CALIDAD VISUAL · diálogos del sistema
import { Vacio, Cargando, CargandoKpis } from '../../app/EmptyState'
import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, ShoppingBag, Receipt, Store, Search, X, FileText, Undo2 } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { cantidadVista, esMediaCaja, numeroVista, precioVista } from '../../lib/cajas'   // CAJAS-MEDIOS
import { useAllOrders, isCancelable, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useTeam } from '../../data/hooks/useTeam'
import { nombreVendedorDe, ventasPorVendedor } from '../../data/comisiones'   // VENTAS POR VENDEDOR
import { useRefunds } from '../../data/hooks/useFinanzas'
import { useOrderMoney, usePaymentEntries } from '../../data/hooks/useMoney'
import { useOpId } from '../../data/hooks/useOpId'
import { autorizarCreditoDePedido, revocarCreditoDePedido } from '../../data/store/ordersStore'
import { useIntentoVentas, consumirIntentoVentas } from '../../data/store/ventasIntentStore'   // PAY-EXP-01A-3
import { METODOS, reembolsoPagado, referenciasRepetidas, type OrderMoney, type PaymentEntry, type PaymentMethod } from '../../data/ops/money'
import { creditoAbierto, creditoVencido, etiquetaLiberacion } from '../../data/ops/moneyView'
import { AMBIGUO_MSG, newOpId } from '../../data/ops/w1Command'
import { useRole } from '../../auth/RoleContext'
import { salesSummary, topProducts, canalDeVenta, ventasPorCanal, CANALES, CANAL_TEXTO, type CanalVenta } from '../../data/metrics'
import { statusView, seSurteSinPago } from '../doctor/orderStatus'
import { esRecoge } from '../../data/ops/seguimiento'
import { ExportButton } from '../../app/ExportButton'
import { CancelOrderModal } from '../../app/CancelOrderModal'
import { GuiaManualVoid } from './GuiaManualVoid'
import type { ProductSafe, Profile } from '../../data/types'
import { enPeriodo, hoyNegocio, rangoPeriodo, type PeriodoRapido } from '../../data/periodo'
import { entregaDeVenta, TIPO_ENTREGA_TEXTO, type TipoEntregaVenta } from '../../data/ops/entrega'   // ENTREGA EN VENTAS
import { extrasDe, nombrePaqueteriaExtra } from '../../data/ops/enviosExtra'
import { orderAddress, formatAddress } from '../../data/ops/shippingAddress'
import { etapaSeguimiento, seguimientoDe, fechaHora, useSeguimiento, type EtapaSeguimiento } from '../../data/ops/seguimientoVenta'   // SEGUIMIENTO (Roberto, 26 nov)

type ChannelFilter = 'todos' | CanalVenta
type EntregaFilter = 'todos' | TipoEntregaVenta
const ENTREGA_FILTROS: TipoEntregaVenta[] = ['local', 'foraneo', 'recoge', 'mostrador']
type PayFilter = 'todos' | 'pagado' | 'parcial' | 'contra' | 'pendiente'

// W2 · El estado de cobro sale del LIBRO. "Contra pedido" ya no es una forma de pago
// inventada: es un CRÉDITO autorizado, y se muestra como deuda, no como pago.
interface PayInfo { key: Exclude<PayFilter, 'todos'>; label: string; pill: string }
function payInfo(o: OrderWithItems, m?: OrderMoney | null): PayInfo {
  if (!m) {
    if (o.payment_status === 'paid') return { key: 'pagado', label: 'Pagado', pill: 'p-ok' }
    return { key: 'pendiente', label: 'Por cobrar', pill: 'p-neu' }
  }
  if (m.estado_pago === 'paid') return { key: 'pagado', label: 'Pagado', pill: 'p-ok' }
  if (creditoAbierto(m)) return { key: 'contra', label: creditoVencido(m) ? 'Crédito vencido' : 'A crédito', pill: creditoVencido(m) ? 'p-dang' : 'p-warn' }
  if (m.estado_pago === 'parcial') return { key: 'parcial', label: 'Pago parcial', pill: 'p-warn' }
  if (m.estado_pago === 'refunded') return { key: 'pendiente', label: 'Reembolsado', pill: 'p-neu' }
  return { key: 'pendiente', label: 'Por cobrar', pill: 'p-neu' }
}
const channelOf = (o: OrderWithItems): CanalVenta => canalDeVenta(o)   // CANAL DE VENTA · quién capturó el pedido

const sel: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 12,
  fontFamily: 'inherit', fontSize: 13, backgroundColor: 'var(--cp-surface)', outline: 'none',
}

/** `fuente`: pedidos y dinero ya leídos (Ventas del equipo del jefe de ventas); sin ella, los de la sesión.
 *  `soloLectura`: sin acciones de Dirección (crédito, devoluciones, guía, cancelar). */
export function VentasDetalle({ fuente, soloLectura = false }: { fuente?: { orders: OrderWithItems[]; byOrder: Record<string, OrderMoney>; cargando: boolean; vendedores?: Array<{ id: string; email: string; name: string }> }; soloLectura?: boolean } = {}) {
  const propios = useAllOrders()
  const dineroPropio = useOrderMoney()
  // TRAZABILIDAD (26 nov 2026): Dirección también ve empacado / salió / entregado de cada venta.
  const segPropio = useSeguimiento(propios.data.map((o) => o.id), !fuente)
  const conSeg = useMemo(() => propios.data.map((o) => (segPropio[o.id] ? { ...o, seguimiento: segPropio[o.id] } : o)), [propios.data, segPropio])
  const orders = fuente ? fuente.orders : conSeg
  const cargandoPedidos = fuente ? fuente.cargando : propios.loading
  const byOrder = fuente ? fuente.byOrder : dineroPropio.byOrder
  // REF-OPCIONAL · referencias de pago que están en más de un pedido (solo Dirección: ve todos los cobros).
  const { data: cobrosLibro } = usePaymentEntries()
  const repetidas = useMemo(() => (fuente ? {} : referenciasRepetidas(cobrosLibro as PaymentEntry[])), [fuente, cobrosLibro])
  const folioDe = (id: string) => orders.find((x) => x.id === id)?.external_ref ?? 'otro pedido'
  const avisoRef = (id: string): string | null => { const r = repetidas[id]; return r?.length ? r.map((x) => `«${x.referencia}» también en ${x.otros.map(folioDe).join(', ')}`).join(' · ') : null }
  const [cancelling, setCancelling] = useState<OrderWithItems | null>(null)
  const { data: products } = useProducts()
  const { data: doctors } = useDoctors()
  const { data: team } = useTeam()
  const vendedores = useMemo(() => fuente?.vendedores?.length ? fuente.vendedores : team.map((u) => ({ id: u.id, email: u.email, name: u.name })), [team, fuente?.vendedores])
  const vendedorDeVenta = (o: OrderWithItems) => nombreVendedorDe(o, vendedores)

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, ProductSafe | undefined>, [products])
  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])
  // Nombre del cliente del pedido: el snapshot del servidor (cuentas sin portal = casi todas), luego el doctor.
  const clientName = (o: OrderWithItems) => orderClientName(o, (id) => doctorsById[id]?.full_name, o.doctor_id ? 'Doctor' : 'Mostrador (POS)')
  const productsSummary = (o: OrderWithItems) => {
    const names = o.items.map((it) => productsById[it.product_id ?? '']?.name ?? 'Producto')
    if (names.length === 0) return '—'
    return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
  }

  // ABRE EN «HOY» (27 nov 2026): la pregunta de todos los días es «¿qué se vendió hoy?» y contestarla costaba poner la
  // fecha dos veces. Los botones de periodo llenan las fechas; escribir una fecha a mano deja el periodo en «otras fechas».
  // Llegada desde un pendiente de Inicio (cancelación, reembolso, pago de más): la venta puede ser de otro día, así
  // que abre en «Todo». Al entrar por el menú abre en «Hoy».
  // También llega así un pedido encontrado en el buscador de arriba («pedido:<id>»): se abre ESA venta.
  const [llegada] = useState(() => (fuente ? null : verFiltro('av_ventas')))
  useEffect(() => { if (!fuente) tomarFiltro('av_ventas') }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const [inicial] = useState<PeriodoRapido>(() => (llegada ? 'todo' : 'hoy'))
  const [periodo, setPeriodo] = useState<PeriodoRapido | 'otro'>(inicial)
  const [from, setFrom] = useState(() => rangoPeriodo(inicial, hoyNegocio()).from)
  const [to, setTo] = useState(() => rangoPeriodo(inicial, hoyNegocio()).to)
  const elegirPeriodo = (p: PeriodoRapido) => { const r = rangoPeriodo(p, hoyNegocio()); setPeriodo(p); setFrom(r.from); setTo(r.to) }
  const [channel, setChannel] = useState<ChannelFilter>('todos')
  const [pay, setPay] = useState<PayFilter>('todos')
  const [entrega, setEntrega] = useState<EntregaFilter>('todos')
  const [vendedor, setVendedor] = useState<string>('todos')
  // SEGUIMIENTO · solo en Ventas del equipo (el servidor manda cuándo se empacó, salió y se entregó cada pedido).
  const conSeguimiento = true
  const [etapa, setEtapa] = useState<'todos' | EtapaSeguimiento>('todos')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(() => (llegada?.startsWith('pedido:') ? llegada.slice(7) : null))
  // Si Ventas ya está abierta y se busca otro pedido, llega aquí al momento.
  useEffect(() => (fuente ? undefined : escucharFiltro('av_ventas', (f) => { elegirPeriodo('todo'); if (f.startsWith('pedido:')) setSelected(f.slice(7)) })), [])   // eslint-disable-line react-hooks/exhaustive-deps
  // PAY-EXP-01A-3 · "Abrir pedido en Ventas" desde Revisión económica: abre su detalle (reembolsos canónicos) si el
  // pedido está en la lista de este usuario; se consume una sola vez.
  const intento = useIntentoVentas()
  useEffect(() => {
    if (!intento) return
    consumirIntentoVentas(intento.id)
    if (intento.folio) setQ(intento.folio)
    setSelected(intento.orderId)
  }, [intento])   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return orders
      .filter((o) => {
        // «Del … al …» son DÍAS DEL NEGOCIO, ambos inclusive (mismo corte que los indicadores).
        if (!enPeriodo(o.created_at, { desde: from || null, hasta: to || null })) return false
        if (channel !== 'todos' && channelOf(o) !== channel) return false
        if (pay !== 'todos' && payInfo(o, byOrder[o.id]).key !== pay) return false
        if (entrega !== 'todos' && entregaDeVenta(o).tipo !== entrega) return false
        if (vendedor !== 'todos' && vendedorDeVenta(o).clave !== vendedor) return false
        if (conSeguimiento && etapa !== 'todos' && etapaSeguimiento(o).etapa !== etapa) return false
        if (query) {
          const hay = `${o.external_ref ?? ''} ${clientName(o)}`.toLowerCase()
          if (!hay.includes(query)) return false
        }
        return true
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, from, to, channel, pay, entrega, vendedor, etapa, vendedores, q, doctorsById])

  const sum = salesSummary(rows)
  // Vendedores con ventas (cualquier periodo) para el filtro, del que más vende al que menos; «Sin vendedor» al final.
  const opcionesVendedor = useMemo(() => ventasPorVendedor(orders, vendedores), [orders, vendedores])
  const ch = ventasPorCanal(rows)
  const prods = topProducts(rows, productsById, 3)
  const selectedOrder = orders.find((o) => o.id === selected) ?? null

  if (cargandoPedidos && orders.length === 0) {
    return (<div className="grid" style={{ gap: 16 }}><CargandoKpis n={5} /><Cargando filas={6} /></div>)
  }
  if (orders.length === 0) {
    return (
      <Vacio icono="chart" titulo="Aún no hay ventas." pista="Levanta un pedido, cobra en Punto de venta o espera un pedido del portal." />
    )
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="vd-periodos" role="group" aria-label="Periodo" data-testid="vd-periodos">
        {([['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['todo', 'Todo']] as Array<[PeriodoRapido, string]>).map(([k, t]) => (
          <button key={k} type="button" className={'fchip' + (periodo === k ? ' on' : '')} aria-pressed={periodo === k} onClick={() => elegirPeriodo(k)} data-testid={`vd-periodo-${k}`}>{t}</button>
        ))}
        {periodo === 'otro' && <span className="vd-periodo-otro">Otras fechas</span>}
      </div>
      {/* Agregados del periodo filtrado */}
      <div className="grid sigs">
        <Stat icon={<TrendingUp size={18} />} v={money(sum.revenue)} k="Total vendido" s={`${sum.orders} ventas`} />
        <Stat icon={<ShoppingBag size={18} />} v={String(sum.orders)} k="Nº de ventas" s="en el filtro" />
        <Stat icon={<Receipt size={18} />} v={money(sum.avgTicket)} k="Ticket promedio" s="por venta" />
        <Stat icon={<Store size={18} />} v={`${money(ch.vendedor.revenue + ch.direccion.revenue)} / ${money(ch.mostrador.revenue + ch.evento.revenue)} / ${money(ch.portal.revenue)}`} k="Vendedores / Caja / Portal" s={`${ch.vendedor.orders + ch.direccion.orders} · ${ch.mostrador.orders + ch.evento.orders} · ${ch.portal.orders}`} />
        <Stat icon={<Receipt size={18} />} v={prods[0]?.name ?? '—'} k="Top producto" s={prods[0] ? money(prods[0].revenue) : ''} />
      </div>

      {/* Filtros */}
      <div className="card filters">
        <div className="searchbox">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente o folio…" />
        </div>
        <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>Del <input type="date" style={sel} value={from} onChange={(e) => { setFrom(e.target.value); setPeriodo('otro') }} /></label>
        <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>al <input type="date" style={sel} value={to} onChange={(e) => { setTo(e.target.value); setPeriodo('otro') }} /></label>
        <select style={sel} value={channel} onChange={(e) => setChannel(e.target.value as ChannelFilter)}>
          <option value="todos">Todos los canales</option>
          {CANALES.map((c) => <option key={c} value={c}>{CANAL_TEXTO[c]}</option>)}
        </select>
        <select style={sel} value={pay} onChange={(e) => setPay(e.target.value as PayFilter)}>
          <option value="todos">Todo cobro</option>
          <option value="pagado">Pagado</option>
          <option value="parcial">Pago parcial</option>
          <option value="contra">A crédito</option>
          <option value="pendiente">Por cobrar</option>
        </select>
        <select style={sel} value={entrega} onChange={(e) => setEntrega(e.target.value as EntregaFilter)} aria-label="Entrega" data-testid="ventas-filtro-entrega">
          <option value="todos">Toda entrega</option>
          {ENTREGA_FILTROS.map((t) => <option key={t} value={t}>{TIPO_ENTREGA_TEXTO[t]}</option>)}
        </select>
        <select style={sel} value={vendedor} onChange={(e) => setVendedor(e.target.value)} aria-label="Vendedor" data-testid="ventas-filtro-vendedor">
          <option value="todos">Todos los vendedores</option>
          {opcionesVendedor.map((v) => <option key={v.clave} value={v.clave}>{v.nombre}</option>)}
        </select>
        {conSeguimiento && (
          <select style={sel} value={etapa} onChange={(e) => setEtapa(e.target.value as 'todos' | EtapaSeguimiento)} aria-label="Seguimiento" data-testid="ventas-filtro-seguimiento">
            <option value="todos">En cualquier paso</option>
            <option value="por_confirmar">Por confirmar · falta el pago</option>
            <option value="esperando_mercancia">Esperando mercancía (sobre pedido)</option>
            <option value="almacen">En almacén · por preparar</option>
            <option value="empacado">En almacén · preparado</option>
            <option value="salio">En camino o listo para recoger</option>
            <option value="entregado">Entregado</option>
          </select>
        )}
        {(from || to || channel !== 'todos' || pay !== 'todos' || entrega !== 'todos' || vendedor !== 'todos' || etapa !== 'todos' || q) && (
          <button className="btn ghost sm" type="button" onClick={() => { elegirPeriodo('todo'); setChannel('todos'); setPay('todos'); setEntrega('todos'); setVendedor('todos'); setEtapa('todos'); setQ('') }}>Limpiar</button>
        )}
        <ExportButton name="ventas" label="Por pedido" rows={rows} style={{ marginLeft: 'var(--filters-end, auto)' }} columns={[
          { key: 'external_ref', label: 'Folio' },
          { key: 'created_at', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
          { key: 'id', label: 'Cliente', format: (_v, o) => clientName(o) },
          { key: 'id', label: 'Productos', format: (_v, o) => productsSummary(o) },
          { key: 'id', label: 'Canal', format: (_v, o) => CANAL_TEXTO[channelOf(o)] },
          { key: 'id', label: 'Vendedor', format: (_v, o) => vendedorDeVenta(o).nombre },
          { key: 'id', label: 'Entrega', format: (_v, o) => entregaDeVenta(o).corto },
          { key: 'id', label: 'Destino', format: (_v, o) => { const a = orderAddress(o.shipping_meta); return a ? [a.city, (a as { state?: string }).state].filter(Boolean).join(', ') : '' } },
          { key: 'total', label: 'Total', format: (v) => money(v as number) },
          { key: 'id', label: 'Cobro', format: (_v, o) => payInfo(o, byOrder[o.id]).label },
          { key: 'status', label: 'Estatus', format: (_v, o) => statusView(o.status, { recoge: esRecoge(o), liberado: seSurteSinPago(o) }).label },
          { key: 'invoice_requested', label: 'Factura', format: (v) => (v ? 'Solicitada' : '') },
          ...(conSeguimiento ? [
            { key: 'id' as const, label: 'Empacado', format: (_v: unknown, o: OrderWithItems) => fechaHora(seguimientoDe(o)?.empacado_at) },
            { key: 'id' as const, label: 'Salió del almacén', format: (_v: unknown, o: OrderWithItems) => fechaHora(seguimientoDe(o)?.salio_at) },
            { key: 'id' as const, label: 'Entregado', format: (_v: unknown, o: OrderWithItems) => fechaHora(seguimientoDe(o)?.entregado_at) },
            { key: 'id' as const, label: 'Chofer / paquetería', format: (_v: unknown, o: OrderWithItems) => seguimientoDe(o)?.chofer ?? seguimientoDe(o)?.paqueteria ?? '' },
            { key: 'id' as const, label: 'Recibió', format: (_v: unknown, o: OrderWithItems) => seguimientoDe(o)?.recibio ?? '' },
          ] : []),
        ]} />
        <ExportButton
          name="ventas-partidas"
          label="Por partida"
          rows={rows.flatMap((o) => o.items.filter((it) => it.unit_price != null).map((it) => {
            const p = productsById[it.product_id ?? '']
            return {
              folio: o.external_ref, fecha: o.created_at, cliente: clientName(o),
              canal: CANAL_TEXTO[channelOf(o)],
              sku: p?.sku ?? '', producto: p?.name ?? 'Producto',
              cantidad: it.qty, precio_unitario: it.unit_price ?? 0, importe: (it.unit_price ?? 0) * it.qty,
            }
          }))}
          columns={[
            { key: 'folio', label: 'Folio' },
            { key: 'fecha', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
            { key: 'cliente', label: 'Cliente' },
            { key: 'canal', label: 'Canal' },
            { key: 'sku', label: 'SKU' },
            { key: 'producto', label: 'Producto' },
            { key: 'cantidad', label: 'Cantidad' },
            { key: 'precio_unitario', label: 'Precio unitario', format: (v) => money(v as number) },
            { key: 'importe', label: 'Importe', format: (v) => money(v as number) },
          ]}
        />
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              {/* MENOS COLUMNAS (27 nov 2026, «sistema sencillo por rol»): de 11 a 7. Canal y entrega van como segunda línea
                  del cliente; productos y estado del pedido se ven al abrir la venta. El Excel conserva todas las columnas. */}
              <tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th>Monto</th><th>Cobro</th>{conSeguimiento && <th>Dónde va</th>}</tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const p = payInfo(o, byOrder[o.id]); const sv = statusView(o.status, { recoge: esRecoge(o), liberado: seSurteSinPago(o) }); const canal = channelOf(o)
                return (
                  <tr key={o.id} className="clickrow" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }} onClick={() => setSelected(o.id)}>
                    <td data-label="Folio" className="mono">{o.external_ref}</td>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.created_at)}</td>
                    <td data-label="Cliente"><div className="vd-cliente"><b>{capitalizarNombre(clientName(o)) || clientName(o)}</b><small>{CANAL_TEXTO[canal]} · <span data-testid="venta-entrega">{entregaDeVenta(o).corto}</span></small></div></td>
                    <td data-label="Vendedor">{vendedorDeVenta(o).nombre}</td>
                    <td data-label="Monto" data-rol="valor" className="mono">{money(o.total)}</td>
                    <td data-label="Cobro"><span className={'pill ' + p.pill}>{p.label}</span>{avisoRef(o.id) && <span className="pill p-warn" style={{ marginLeft: 4 }} title={`Referencia repetida: ${avisoRef(o.id)}`} data-testid="venta-ref-repetida">Ref. repetida</span>}</td>
                    {conSeguimiento
                      ? (() => { const et = etapaSeguimiento(o); return <td data-label="Dónde va" data-rol="estado" data-testid="venta-seguimiento"><span className={'pill ' + et.pill}>{et.texto}</span></td> })()
                      : <td data-label="Pedido" data-rol="estado"><span className={'pill ' + sv.pill}>{sv.label}</span></td>}
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-3)' }} data-testid="vd-vacio">{periodo === 'hoy' ? 'Todavía no hay ventas hoy con esos filtros. Mira ayer o esta semana con los botones de arriba.' : 'Sin ventas con esos filtros.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && (
        <SaleDetail avisoRepetida={avisoRef(selectedOrder.id)} order={selectedOrder} productsById={productsById} clientName={capitalizarNombre(clientName(selectedOrder)) || clientName(selectedOrder)} channel={channelOf(selectedOrder)} dinero={byOrder[selectedOrder.id] ?? null} onClose={() => setSelected(null)} onCancel={() => setCancelling(selectedOrder)} soloLectura={soloLectura} />
      )}
      {cancelling && (
        <CancelOrderModal orderId={cancelling.id} folio={cancelling.external_ref ?? cancelling.id} requireReason actor="Administración"
          onClose={() => { setCancelling(null); setSelected(null) }} />
      )}
    </div>
  )
}

function Stat({ icon, v, k, s }: { icon: React.ReactNode; v: string; k: string; s: string }) {
  return (
    <div className="card sig">
      <div className="chip">{icon}</div>
      <div className="v" style={{ fontSize: 18 }}>{v}</div>
      <div className="k">{k}</div>
      <div className="s">{s}</div>
    </div>
  )
}

/** ENTREGA EN VENTAS · cómo y a dónde se entrega: tipo, paquetería u horario, promesa, flete, domicilio y envíos extra. */
function EntregaDeLaVenta({ order }: { order: OrderWithItems }) {
  const ev = entregaDeVenta(order, hoyNegocio())
  const e = (order.shipping_meta as { entrega?: { flete?: number } } | null)?.entrega ?? null
  const dir = ev.tipo === 'local' || ev.tipo === 'foraneo' ? orderAddress(order.shipping_meta) : null
  const extras = extrasDe(order)
  return (
    <div className="sysnote" style={{ marginBottom: 14, display: 'grid', gap: 4 }} data-testid="venta-detalle-entrega">
      <div><b>Entrega:</b> {ev.corto}{ev.promesa ? ` · ${ev.promesa}` : ''}{e && typeof e.flete === 'number' ? ` · envío ${e.flete > 0 ? money(e.flete) : 'gratis'}` : ''}</div>
      {dir && <div style={{ color: 'var(--ink-2)' }}>{formatAddress(dir)}</div>}
      {extras.map((x) => (
        <div key={x.paquete} style={{ color: 'var(--ink-2)' }}>Envío extra {x.paquete}{nombrePaqueteriaExtra(x.paqueteria) ? ` (${nombrePaqueteriaExtra(x.paqueteria)})` : ''}: {formatAddress(x.address)}{x.flete > 0 ? ` · ${money(x.flete)}` : ''}</div>
      ))}
    </div>
  )
}

/** SEGUIMIENTO · cuándo se empacó, salió del almacén y se entregó; quién despachó, el chofer y quién recibió. */
function SeguimientoDeLaVenta({ order }: { order: OrderWithItems }) {
  const s = seguimientoDe(order) ?? {}
  const pasos: Array<[string, string | null | undefined, string?]> = [
    ['Empacado', s.empacado_at],
    ['Salió del almacén', s.salio_at, [s.despacho_por ? `despachó ${s.despacho_por}` : '', s.chofer ? `chofer ${s.chofer}` : '', s.paqueteria ? s.paqueteria.toUpperCase() : '', s.guia ? `guía ${s.guia}` : ''].filter(Boolean).join(' · ')],
    ['El chofer recibió la carga', s.carga_recibida_at],
    ['Entregado', s.entregado_at, [s.recibio ? `recibió ${s.recibio}` : '', s.con_foto ? 'con foto de evidencia' : ''].filter(Boolean).join(' · ')],
  ]
  return (
    <div className="sysnote" style={{ marginBottom: 14, display: 'grid', gap: 4 }} data-testid="venta-detalle-seguimiento">
      <div><b>Seguimiento</b></div>
      {pasos.filter(([, at]) => !!at || false).map(([k, at, extra]) => (
        <div key={k}>✓ {k}: {fechaHora(at)}{extra ? <span style={{ color: 'var(--ink-2)' }}> · {extra}</span> : null}</div>
      ))}
      {!s.empacado_at && !s.salio_at && !s.entregado_at && <div style={{ color: 'var(--ink-2)' }}>Aún en almacén: no se ha empacado.</div>}
      {s.incidente && <div style={{ color: 'var(--dang, #b42318)' }}>Incidente: {s.incidente}</div>}
    </div>
  )
}

function SaleDetail({ order, productsById, clientName, channel, dinero = null, onClose, onCancel, soloLectura = false, avisoRepetida = null }: {
  soloLectura?: boolean
  avisoRepetida?: string | null
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  clientName: string
  channel: CanalVenta
  dinero?: OrderMoney | null
  onClose: () => void
  onCancel: () => void
}) {
  const p = payInfo(order, dinero); const sv = statusView(order.status, { recoge: esRecoge(order), liberado: seSurteSinPago(order) })
  const { user, role } = useRole()
  const { data: refunds, refundedByOrder } = useRefunds()
  const { data: entries } = usePaymentEntries()
  const misDevs = refunds.filter((r) => r.order_id === order.id)
  const yaDevuelto = refundedByOrder(refunds)[order.id] ?? 0
  const restante = (order.total ?? 0) - yaDevuelto
  // TOPE real de un reembolso: no se puede devolver dinero que nunca entró. El servidor
  // reimpone ambos topes (restante del pedido y cobrado neto).
  const topeReembolso = Math.min(restante, dinero ? dinero.cobrado_neto : restante)
  // Un pedido CANCELADO que ya se cobró también se reembolsa (Revisión económica manda aquí); solo dinero: el
  // producto regresa por el reingreso de la cancelación.
  const puedeDevolver = !soloLectura && order.status !== 'draft' && topeReembolso > 0.0001
  const lib = dinero ? etiquetaLiberacion(dinero) : null
  const [showForm, setShowForm] = useState(false)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>{order.external_ref}</h3>
            <div className="ms">{clientName} · {CANAL_TEXTO[channel]}{(order.shipping_meta as { placed_by?: string } | null)?.placed_by && channel !== 'portal' && channel !== 'mostrador' ? ` · ${(order.shipping_meta as { placed_by?: string }).placed_by}` : ''} · {fmtDate(order.created_at)}</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className={'pill ' + p.pill}>{p.label}</span>
            <span className={'pill ' + sv.pill}>{sv.label}</span>
            {order.invoice_requested && <span className="pill p-blue"><FileText size={12} /> CFDI solicitado</span>}
          </div>

          <EntregaDeLaVenta order={order} />
          {avisoRepetida && <div className="sysnote" style={{ marginBottom: 14, color: 'var(--warn, #b54708)' }} data-testid="venta-detalle-ref-repetida"><b>Referencia repetida:</b> {avisoRepetida}. Revisa que no sea el mismo pago registrado dos veces.</div>}
          {seguimientoDe(order) && <SeguimientoDeLaVenta order={order} />}

          {dinero && (
            <div className="sysnote" style={{ marginBottom: 14 }}>
              <span style={{ flex: 1 }}>
                {order.status === 'cancelled'
                  // Cancelado: ya no se cobra; lo único que importa es si queda dinero del cliente por devolver.
                  ? <>Pedido cancelado · cobrado neto <b>{money(dinero.cobrado_neto)}</b>{dinero.cobrado_neto > 0.0001 && dinero.reembolso_pendiente <= 0.0001 ? ' · falta autorizar su reembolso' : dinero.cobrado_neto <= 0.0001 ? ' · nada por cobrar ni por devolver' : ''}</>
                  : <>Cobrado <b>{money(dinero.cobrado_neto)}</b> de {money(dinero.total)} · saldo <b>{money(dinero.saldo)}</b>
                    {lib && <> · {lib.texto}{lib.detalle ? ` (${lib.detalle})` : ''}</>}</>}
                {dinero.reembolso_pendiente > 0.0001 && <> · <b style={{ color: 'var(--warn)' }}>reembolso autorizado sin pagar: {money(dinero.reembolso_pendiente)}</b></>}
              </span>
            </div>
          )}

          {dinero && role === 'admin' && order.status !== 'cancelled' && dinero.saldo > 0.0001 && (
            <CreditoAcciones order={order} dinero={dinero} />
          )}

          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td data-label="Producto">{productsById[it.product_id ?? '']?.name ?? 'Producto'}</td>
                  {/* CAJAS-MEDIOS: cantidad y precio por caja para la media caja; el importe no cambia */}
                  <td data-label="Cant." className="mono">{cantidadVista(productsById[it.product_id ?? ''], it.qty)}</td>
                  <td data-label="Precio" className="mono">{money(precioVista(productsById[it.product_id ?? ''], it.unit_price ?? 0))}{esMediaCaja(productsById[it.product_id ?? '']) ? ' por caja' : ''}</td>
                  <td data-label="Importe" className="mono">{money((it.unit_price ?? 0) * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(() => { const envio = Number((order as { shipping_cost?: number | null }).shipping_cost ?? 0); return envio > 0 ? <div className="cototal" style={{ marginTop: 12, fontSize: 13 }} data-testid="detalle-envio"><span>Envío</span><b>{money(envio)}</b></div> : null })()}
          <div className="cototal" style={{ marginTop: 12 }}><span>Total</span><b>{money(order.total)}</b></div>
          {yaDevuelto > 0 && (
            <>
              <div className="cototal" style={{ color: 'var(--danger)' }}><span>Devoluciones</span><b>− {money(yaDevuelto)}</b></div>
              <div className="cototal" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}><span>Neto cobrado</span><b>{money(restante)}</b></div>
            </>
          )}

          {misDevs.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Devoluciones y correcciones</div>
              {misDevs.map((r) => {
                const pagado = reembolsoPagado(entries as PaymentEntry[], r.id)
                return (
                <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                  <span className={'pill ' + (r.tipo === 'devolucion' ? 'p-neu' : 'p-warn')}>{({ devolucion: 'Devolución', correccion: 'Corrección', cortesia: 'Cortesía' } as Record<string, string>)[r.tipo] ?? 'Devolución'}</span>
                  <span className="mono" style={{ color: 'var(--danger)' }}>− {money(r.monto)}</span>
                  <span className={'pill ' + (pagado ? 'p-ok' : 'p-warn')}>{pagado ? 'dinero entregado' : 'autorizado · sin pagar'}</span>
                  <span style={{ color: 'var(--ink-2)', flex: 1 }}>{r.motivo}</span>
                  <span style={{ color: 'var(--ink-3)', fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)} · {r.usuario}</span>
                  {!pagado && role === 'admin' && <PagarReembolso refundId={r.id} monto={r.monto} usuario={user?.name ?? 'Administración'} />}
                </div>
              )})}
            </div>
          )}

          {puedeDevolver && !showForm && (
            <div style={{ marginTop: 14 }}>
              <button className="btn ghost sm" type="button" onClick={() => setShowForm(true)}><Undo2 size={14} /> {order.status === 'cancelled' ? 'Reembolsar al cliente' : 'Devolver / Corregir'}</button>
            </div>
          )}
          {puedeDevolver && showForm && (
            <DevolverForm order={order} restante={topeReembolso} usuario={user?.name ?? 'Administración'} productsById={productsById} onClose={() => setShowForm(false)} />
          )}

          {order.invoice_requested && (
            <div className="sysnote" style={{ marginTop: 14 }}>
              <FileText size={16} />
              <span>El cliente solicitó factura. La generación del CFDI se hace en <b>Facturación</b> (diferido); aquí solo se refleja la solicitud.</span>
            </div>
          )}

          {!soloLectura && order.status === 'packed' && <GuiaManualVoid orderId={order.id} />}

          {!soloLectura && isCancelable(order.status) && (
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={onCancel}>Cancelar pedido</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Formulario de Devolver/Corregir. W2 · AUTORIZA el reembolso: queda el compromiso, el
// dinero NO sale todavía (eso es "Pagar reembolso"). El monto tiene TOPE (lo que resta
// del pedido y lo realmente cobrado) y el motivo es obligatorio; el servidor reimpone ambos.
const PRESETS_CORR = ['Cobro duplicado', 'No pagó (era cortesía)', 'Error de captura']
const PRESETS_DEV = ['Producto devuelto', 'Cliente canceló', 'Producto dañado']
function DevolverForm({ order, restante, usuario, productsById, onClose }: {
  order: OrderWithItems
  restante: number
  usuario: string
  productsById: Record<string, ProductSafe | undefined>
  onClose: () => void
}) {
  const { data: refunds, autorizarReembolso, returnedByItem } = useRefunds()
  const { opId, renew } = useOpId()
  const cancelado = order.status === 'cancelled'
  const [tipo, setTipo] = useState<'devolucion' | 'correccion' | 'cortesia'>(cancelado ? 'correccion' : 'devolucion')
  const [qtys, setQtys] = useState<Record<string, number>>({})   // piezas a regresar por renglón
  const [montoCorr, setMontoCorr] = useState(String(restante))    // monto libre para corrección
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const sellable = order.items.filter((it) => it.unit_price != null)
  const returned = returnedByItem(refunds, order.id)
  const returnable = (it: (typeof sellable)[number]) => Math.max(0, it.qty - (returned[it.id] ?? 0))
  const setQ = (id: string, v: number, max: number) => setQtys((q) => ({ ...q, [id]: Math.max(0, Math.min(max, v)) }))

  // Devolución: el monto se DERIVA de los renglones que regresan (no se teclea).
  const montoDev = sellable.reduce((s, it) => s + (qtys[it.id] ?? 0) * (it.unit_price ?? 0), 0)
  const montoN = tipo === 'devolucion' ? montoDev : Math.max(0, Number(montoCorr) || 0)
  const valid = montoN > 0 && montoN <= restante + 0.0001 && motivo.trim().length >= 3

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setErr('')
    const items = tipo === 'devolucion'
      ? sellable.filter((it) => (qtys[it.id] ?? 0) > 0).map((it) => ({ item_id: it.id, lot_id: it.lot_id ?? null, qty: qtys[it.id] }))
      : undefined
    const r = await autorizarReembolso(opId, { orderId: order.id, tipo, monto: montoN, motivo, usuario, items })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo autorizar el reembolso.')); return }
    renew()
    onClose()
  }

  const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none' }
  return (
    <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--hueso, #f8f9f6)' }}>
      <div className="seg" style={{ marginBottom: 12 }}>
        {!cancelado && <button type="button" className={tipo === 'devolucion' ? 'active' : undefined} onClick={() => setTipo('devolucion')}>Devolución</button>}
        <button type="button" className={tipo === 'correccion' ? 'active' : undefined} onClick={() => setTipo('correccion')}>{cancelado ? 'Reembolso por cancelación' : 'Corrección'}</button>
        {!cancelado && <button type="button" className={tipo === 'cortesia' ? 'active' : undefined} onClick={() => setTipo('cortesia')}>Cortesía</button>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 10 }}>
        {cancelado ? 'El pedido se canceló después de cobrarse: devuelve el dinero al cliente. Esto AUTORIZA el reembolso; el dinero sale cuando se registre su pago. El producto regresa por el reingreso de la cancelación.'
          : tipo === 'devolucion' ? 'Reembolso por producto devuelto: elige renglones y piezas para calcular el monto. Esto AUTORIZA el reembolso; el dinero sale cuando se registre su pago. La entrada física del producto la registra Almacén en «Devoluciones y reingresos» y Dirección decide su destino.'
          : tipo === 'correccion' ? 'El cobro estuvo mal (no entró producto). Solo corrige el dinero; no toca inventario.'
          : 'Se cobró pero no debía (cortesía). Regresa el dinero; el producto se queda con el cliente, no toca inventario.'}
      </div>

      {tipo === 'devolucion' ? (
        <div style={{ marginBottom: 12 }}>
          {sellable.map((it) => {
            const max = returnable(it); const q = qtys[it.id] ?? 0
            const yaDev = it.qty - max
            const p = productsById[it.product_id ?? '']   // CAJAS-MEDIOS: se muestra en cajas; el −/+ mueve media caja (interno)
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{productsById[it.product_id ?? '']?.name ?? 'Producto'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{money(precioVista(p, it.unit_price ?? 0))}{esMediaCaja(p) ? ' por caja' : ''} · comprado {cantidadVista(p, it.qty)}{yaDev > 0 ? ` · ya devuelto ${cantidadVista(p, yaDev)}` : ''}</div>
                </div>
                {max === 0 ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Devuelto</span> : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" className="btn ghost sm" disabled={q <= 0} onClick={() => setQ(it.id, q - 1, max)}>−</button>
                    <span className="mono" style={{ minWidth: 24, textAlign: 'center' }}>{numeroVista(p, q)}<span style={{ color: 'var(--ink-3)' }}>/{numeroVista(p, max)}</span></span>
                    <button type="button" className="btn ghost sm" disabled={q >= max} onClick={() => setQ(it.id, q + 1, max)}>+</button>
                  </div>
                )}
              </div>
            )
          })}
          <div className="cototal" style={{ marginTop: 10 }}><span>A devolver</span><b>{money(montoDev)}</b></div>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Monto (máx {money(restante)})</label>
          <input type="number" min={0} max={restante} style={{ ...fld, marginTop: 5, maxWidth: 200 }} value={montoCorr} onChange={(e) => setMontoCorr(e.target.value)} />
        </div>
      )}

      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Motivo</label>
      <input style={{ ...fld, marginTop: 5, marginBottom: 8 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué?" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {(cancelado ? ['Cliente canceló', 'Pedido duplicado', 'Sin existencia'] : tipo === 'devolucion' ? PRESETS_DEV : PRESETS_CORR).map((pz) => (
          <button key={pz} type="button" className="chip-btn" style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 999, backgroundColor: 'var(--cp-surface)', cursor: 'pointer' }} onClick={() => setMotivo(pz)}>{pz}</button>
        ))}
      </div>
      {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginBottom: 10 }}><span>{err}</span></div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn sm" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={submit}>
          {busy ? 'Autorizando…' : `Autorizar ${cancelado ? 'reembolso' : ({ devolucion: 'devolución', correccion: 'corrección', cortesia: 'cortesía' } as const)[tipo]}`}
        </button>
      </div>
    </div>
  )
}

// CRÉDITO (contra pedido) — solo Dirección. Autorizarlo LIBERA el surtido sin decir que
// el pedido está pagado: el saldo sigue ahí y la etiqueta lo dice.
function CreditoAcciones({ order, dinero }: { order: OrderWithItems; dinero: OrderMoney }) {
  const [abierto, setAbierto] = useState(false)
  const [vence, setVence] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { opId, renew } = useOpId()

  const autorizar = async () => {
    if (busy) return
    if (!vence) { setErr('Indica la fecha límite de pago.'); return }
    if (motivo.trim().length < 3) { setErr('Escribe el motivo del crédito.'); return }
    setBusy(true); setErr('')
    const r = await autorizarCreditoDePedido(opId, { orderId: order.id, dueDate: vence, motivo: motivo.trim() })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo autorizar el crédito.')); return }
    renew(); setAbierto(false); setVence(''); setMotivo('')
  }

  const revocar = async () => {
    const m = (await pedirTexto('Motivo para revocar el crédito (el pedido dejará de estar liberado si no hay cobro suficiente).'))
    if (m == null) return
    if (!m.trim()) { void avisar('La revocación necesita un motivo.'); return }
    const r = await revocarCreditoDePedido(newOpId(), { orderId: order.id, motivo: m })
    if (!r.ok) void avisar(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo revocar el crédito.'))
  }

  const fld: React.CSSProperties = { padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)' }

  // Crédito que después se cobró completo: quedó saldado. Ya no se debe nada ni hay qué revocar.
  if (dinero.credito_autorizado && !creditoAbierto(dinero)) {
    return (
      <div className="sysnote" style={{ marginBottom: 14 }} data-testid="credito-saldado">
        <span style={{ flex: 1 }}><b>Crédito saldado.</b> Se autorizó a crédito y ya se cobró completo.</span>
      </div>
    )
  }

  if (dinero.credito_autorizado) {
    return (
      <div className="sysnote" style={{ marginBottom: 14, background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
        <span style={{ flex: 1 }}>
          <b>Crédito autorizado{creditoVencido(dinero) ? ' y VENCIDO' : ''}.</b> El pedido se puede surtir, pero <b>sigue debiendo {money(dinero.saldo)}</b>
          {dinero.due_date ? ` · fecha límite ${fmtDate(dinero.due_date)}` : ''}.
        </span>
        <button className="btn ghost sm" type="button" onClick={() => void revocar()}>Revocar crédito</button>
      </div>
    )
  }

  return abierto ? (
    <div style={{ marginBottom: 14, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--hueso, #f8f9f6)' }}>
      <div style={{ fontSize: 12.5, marginBottom: 8 }}>
        Autorizar crédito libera el surtido de este pedido <b>sin marcarlo pagado</b>. Queda registrado quién lo autorizó, por qué y para cuándo.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" style={fld} value={vence} onChange={(e) => setVence(e.target.value)} />
        <input style={{ ...fld, flex: 1, minWidth: 180 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del crédito" />
        <button className="btn sm" type="button" disabled={busy} onClick={() => void autorizar()}>{busy ? 'Autorizando…' : 'Autorizar crédito'}</button>
        <button className="btn ghost sm" type="button" onClick={() => { setAbierto(false); setErr('') }}>Cancelar</button>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </div>
  ) : (
    <div style={{ marginBottom: 14 }}>
      <button className="btn ghost sm" type="button" onClick={() => setAbierto(true)}>Autorizar crédito (contra pedido)</button>
    </div>
  )
}

// PAGAR un reembolso autorizado: aquí SÍ sale el dinero (asiento 'out' en el libro).
function PagarReembolso({ refundId, monto, usuario }: { refundId: string; monto: number; usuario: string }) {
  const { pagarReembolso } = useRefunds()
  const { opId, renew } = useOpId()
  const [abierto, setAbierto] = useState(false)
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')
  const [motivoVia, setMotivoVia] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pagar = async () => {
    if (busy) return
    setBusy(true); setErr('')
    const r = await pagarReembolso(opId, {
      refundId, method: metodo, reference: referencia.trim() || null,
      motivoVia: motivoVia.trim() || null, usuario,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo registrar el pago del reembolso.')); return }
    renew(); setAbierto(false)
  }

  const fld: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none', backgroundColor: 'var(--cp-surface)' }

  if (!abierto) return <button className="btn ghost sm" type="button" onClick={() => setAbierto(true)}>Pagar {money(monto)}</button>
  return (
    <div style={{ width: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      <select style={fld} value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
        {METODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <input style={{ ...fld, flex: 1, minWidth: 120 }} value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia (opcional)" />
      <input style={{ ...fld, flex: 1, minWidth: 140 }} value={motivoVia} onChange={(e) => setMotivoVia(e.target.value)} placeholder="Si la vía es distinta a la del cobro: por qué" />
      <button className="btn sm" type="button" disabled={busy} onClick={() => void pagar()}>{busy ? 'Registrando…' : 'Registrar salida'}</button>
      <button className="btn ghost sm" type="button" onClick={() => { setAbierto(false); setErr('') }}>Cancelar</button>
      {err && <div style={{ fontSize: 12, color: 'var(--danger)', width: '100%' }}>{err}</div>}
    </div>
  )
}
