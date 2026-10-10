// ADMIN · Ventas → Detalle — el LIBRO DE VENTAS (solo lectura). Pedidos del
// Portal + ventas POS (mismo store), filtrable. NO es el Tablero ni Trazabilidad.
// Agrega de useAllOrders + useProducts + useDoctors vía data/metrics. Migrable a
// un select sobre Supabase sin tocar la pantalla.
import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, ShoppingBag, Receipt, Store, Search, X, FileText, Undo2 } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders, isCancelable, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useRefunds } from '../../data/hooks/useFinanzas'
import { useOrderMoney, usePaymentEntries } from '../../data/hooks/useMoney'
import { useOpId } from '../../data/hooks/useOpId'
import { autorizarCreditoDePedido, revocarCreditoDePedido } from '../../data/store/ordersStore'
import { useIntentoVentas, consumirIntentoVentas } from '../../data/store/ventasIntentStore'   // PAY-EXP-01A-3
import { METODOS, reembolsoPagado, type OrderMoney, type PaymentEntry, type PaymentMethod } from '../../data/ops/money'
import { etiquetaLiberacion } from '../../data/ops/moneyView'
import { AMBIGUO_MSG, newOpId } from '../../data/ops/w1Command'
import { useRole } from '../../auth/RoleContext'
import { salesSummary, channelSplit, topProducts, isPosOrder } from '../../data/metrics'
import { statusView } from '../doctor/orderStatus'
import { ExportButton } from '../../app/ExportButton'
import { CancelOrderModal } from '../../app/CancelOrderModal'
import { GuiaManualVoid } from './GuiaManualVoid'
import type { ProductSafe, Profile } from '../../data/types'
import { enPeriodo } from '../../data/periodo'

type ChannelFilter = 'todos' | 'portal' | 'pos'
type PayFilter = 'todos' | 'pagado' | 'parcial' | 'contra' | 'pendiente'

// W2 · El estado de cobro sale del LIBRO. "Contra pedido" ya no es una forma de pago
// inventada: es un CRÉDITO autorizado, y se muestra como deuda, no como pago.
interface PayInfo { key: Exclude<PayFilter, 'todos'>; label: string; pill: string }
function payInfo(o: OrderWithItems, m?: OrderMoney | null): PayInfo {
  if (!m) {
    if (o.payment_status === 'paid') return { key: 'pagado', label: 'Pagado', pill: 'p-ok' }
    return { key: 'pendiente', label: 'Pendiente', pill: 'p-neu' }
  }
  if (m.estado_pago === 'paid') return { key: 'pagado', label: 'Pagado', pill: 'p-ok' }
  if (m.credito_autorizado) return { key: 'contra', label: m.vencido ? 'Crédito vencido' : 'A crédito', pill: m.vencido ? 'p-dang' : 'p-warn' }
  if (m.estado_pago === 'parcial') return { key: 'parcial', label: 'Pago parcial', pill: 'p-warn' }
  if (m.estado_pago === 'refunded') return { key: 'pendiente', label: 'Reembolsado', pill: 'p-neu' }
  return { key: 'pendiente', label: 'Pendiente', pill: 'p-neu' }
}
const channelOf = (o: OrderWithItems): 'portal' | 'pos' => (isPosOrder(o) ? 'pos' : 'portal')

const sel: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 12,
  fontFamily: 'inherit', fontSize: 13, backgroundColor: 'var(--cp-surface)', outline: 'none',
}

export function VentasDetalle() {
  const { data: orders } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const [cancelling, setCancelling] = useState<OrderWithItems | null>(null)
  const { data: products } = useProducts()
  const { data: doctors } = useDoctors()

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, ProductSafe | undefined>, [products])
  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])
  const clientName = (o: OrderWithItems) => (o.doctor_id ? doctorsById[o.doctor_id]?.full_name ?? 'Doctor' : 'Mostrador (POS)')
  const productsSummary = (o: OrderWithItems) => {
    const names = o.items.map((it) => productsById[it.product_id ?? '']?.name ?? 'Producto')
    if (names.length === 0) return '—'
    return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
  }

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [channel, setChannel] = useState<ChannelFilter>('todos')
  const [pay, setPay] = useState<PayFilter>('todos')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
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
        if (query) {
          const hay = `${o.external_ref ?? ''} ${clientName(o)}`.toLowerCase()
          if (!hay.includes(query)) return false
        }
        return true
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, from, to, channel, pay, q, doctorsById])

  const sum = salesSummary(rows)
  const ch = channelSplit(rows)
  const prods = topProducts(rows, productsById, 3)
  const selectedOrder = orders.find((o) => o.id === selected) ?? null

  if (orders.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
        Aún no hay ventas. Crea un pedido en el Portal del Doctor o cobra en Punto de Venta.
      </div>
    )
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Agregados del periodo filtrado */}
      <div className="grid sigs">
        <Stat icon={<TrendingUp size={18} />} v={money(sum.revenue)} k="Total vendido" s={`${sum.orders} ventas`} />
        <Stat icon={<ShoppingBag size={18} />} v={String(sum.orders)} k="Nº de ventas" s="en el filtro" />
        <Stat icon={<Receipt size={18} />} v={money(sum.avgTicket)} k="Ticket promedio" s="por venta" />
        <Stat icon={<Store size={18} />} v={`${money(ch.portal.revenue)} / ${money(ch.pos.revenue)}`} k="Portal / POS" s={`${ch.portal.orders} · ${ch.pos.orders}`} />
        <Stat icon={<Receipt size={18} />} v={prods[0]?.name ?? '—'} k="Top producto" s={prods[0] ? money(prods[0].revenue) : ''} />
      </div>

      {/* Filtros */}
      <div className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="searchbox" style={{ width: 220 }}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente o folio…" />
        </div>
        <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>Del <input type="date" style={sel} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>al <input type="date" style={sel} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select style={sel} value={channel} onChange={(e) => setChannel(e.target.value as ChannelFilter)}>
          <option value="todos">Todos los canales</option>
          <option value="portal">Portal del Doctor</option>
          <option value="pos">Punto de Venta</option>
        </select>
        <select style={sel} value={pay} onChange={(e) => setPay(e.target.value as PayFilter)}>
          <option value="todos">Todo cobro</option>
          <option value="pagado">Pagado</option>
          <option value="parcial">Pago parcial</option>
          <option value="contra">A crédito</option>
          <option value="pendiente">Pendiente</option>
        </select>
        {(from || to || channel !== 'todos' || pay !== 'todos' || q) && (
          <button className="btn ghost sm" type="button" onClick={() => { setFrom(''); setTo(''); setChannel('todos'); setPay('todos'); setQ('') }}>Limpiar</button>
        )}
        <ExportButton name="ventas" label="Por pedido" rows={rows} style={{ marginLeft: 'auto' }} columns={[
          { key: 'external_ref', label: 'Folio' },
          { key: 'created_at', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
          { key: 'id', label: 'Cliente', format: (_v, o) => clientName(o) },
          { key: 'id', label: 'Productos', format: (_v, o) => productsSummary(o) },
          { key: 'id', label: 'Canal', format: (_v, o) => (channelOf(o) === 'pos' ? 'Punto de Venta' : 'Portal') },
          { key: 'total', label: 'Total', format: (v) => money(v as number) },
          { key: 'id', label: 'Cobro', format: (_v, o) => payInfo(o, byOrder[o.id]).label },
          { key: 'status', label: 'Estatus', format: (_v, o) => statusView(o.status).label },
          { key: 'invoice_requested', label: 'Factura', format: (v) => (v ? 'Solicitada' : '') },
        ]} />
        <ExportButton
          name="ventas-partidas"
          label="Por partida"
          rows={rows.flatMap((o) => o.items.filter((it) => it.unit_price != null).map((it) => {
            const p = productsById[it.product_id ?? '']
            return {
              folio: o.external_ref, fecha: o.created_at, cliente: clientName(o),
              canal: channelOf(o) === 'pos' ? 'Punto de Venta' : 'Portal',
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
              <tr><th>Folio</th><th>Fecha</th><th>Canal</th><th>Cliente</th><th>Productos</th><th>Monto</th><th>Cobro</th><th>Pedido</th></tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const p = payInfo(o, byOrder[o.id]); const sv = statusView(o.status); const isPos = channelOf(o) === 'pos'
                return (
                  <tr key={o.id} className="clickrow" onClick={() => setSelected(o.id)}>
                    <td data-label="Folio" className="mono">{o.external_ref}</td>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.created_at)}</td>
                    <td data-label="Canal"><span className={'pill ' + (isPos ? 'p-neu' : 'p-blue')}>{isPos ? 'POS' : 'Portal'}</span></td>
                    <td data-label="Cliente">{clientName(o)}</td>
                    <td data-label="Productos" style={{ color: 'var(--ink-2)' }}>{productsSummary(o)}</td>
                    <td data-label="Monto" className="mono">{money(o.total)}</td>
                    <td data-label="Cobro"><span className={'pill ' + p.pill}>{p.label}</span></td>
                    <td data-label="Pedido"><span className={'pill ' + sv.pill}>{sv.label}</span></td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--ink-3)' }}>Sin ventas con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && (
        <SaleDetail order={selectedOrder} productsById={productsById} clientName={clientName(selectedOrder)} channel={channelOf(selectedOrder)} dinero={byOrder[selectedOrder.id] ?? null} onClose={() => setSelected(null)} onCancel={() => setCancelling(selectedOrder)} />
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

function SaleDetail({ order, productsById, clientName, channel, dinero = null, onClose, onCancel }: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  clientName: string
  channel: 'portal' | 'pos'
  dinero?: OrderMoney | null
  onClose: () => void
  onCancel: () => void
}) {
  const p = payInfo(order, dinero); const sv = statusView(order.status)
  const { user, role } = useRole()
  const { data: refunds, refundedByOrder } = useRefunds()
  const { data: entries } = usePaymentEntries()
  const misDevs = refunds.filter((r) => r.order_id === order.id)
  const yaDevuelto = refundedByOrder(refunds)[order.id] ?? 0
  const restante = (order.total ?? 0) - yaDevuelto
  // TOPE real de un reembolso: no se puede devolver dinero que nunca entró. El servidor
  // reimpone ambos topes (restante del pedido y cobrado neto).
  const topeReembolso = Math.min(restante, dinero ? dinero.cobrado_neto : restante)
  const puedeDevolver = order.status !== 'cancelled' && order.status !== 'draft' && topeReembolso > 0.0001
  const lib = dinero ? etiquetaLiberacion(dinero) : null
  const [showForm, setShowForm] = useState(false)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>{order.external_ref}</h3>
            <div className="ms">{clientName} · {channel === 'pos' ? 'Punto de Venta' : 'Portal del Doctor'} · {fmtDate(order.created_at)}</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className={'pill ' + p.pill}>{p.label}</span>
            <span className={'pill ' + sv.pill}>{sv.label}</span>
            {order.invoice_requested && <span className="pill p-blue"><FileText size={12} /> CFDI solicitado</span>}
          </div>

          {dinero && (
            <div className="sysnote" style={{ marginBottom: 14 }}>
              <span style={{ flex: 1 }}>
                Cobrado <b>{money(dinero.cobrado_neto)}</b> de {money(dinero.total)} · saldo <b>{money(dinero.saldo)}</b>
                {lib && <> · {lib.texto}{lib.detalle ? ` (${lib.detalle})` : ''}</>}
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
                  <td data-label="Cant." className="mono">{it.qty}</td>
                  <td data-label="Precio" className="mono">{money(it.unit_price ?? 0)}</td>
                  <td data-label="Importe" className="mono">{money((it.unit_price ?? 0) * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>

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
              <button className="btn ghost sm" type="button" onClick={() => setShowForm(true)}><Undo2 size={14} /> Devolver / Corregir</button>
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

          {order.status === 'packed' && <GuiaManualVoid orderId={order.id} />}

          {isCancelable(order.status) && (
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
  const [tipo, setTipo] = useState<'devolucion' | 'correccion' | 'cortesia'>('devolucion')
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
        <button type="button" className={tipo === 'devolucion' ? 'active' : undefined} onClick={() => setTipo('devolucion')}>Devolución</button>
        <button type="button" className={tipo === 'correccion' ? 'active' : undefined} onClick={() => setTipo('correccion')}>Corrección</button>
        <button type="button" className={tipo === 'cortesia' ? 'active' : undefined} onClick={() => setTipo('cortesia')}>Cortesía</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 10 }}>
        {tipo === 'devolucion' ? 'Reembolso por producto devuelto: elige renglones y piezas para calcular el monto. Esto AUTORIZA el reembolso; el dinero sale cuando se registre su pago. La entrada física del producto la registra Almacén en «Devoluciones y reingresos» y Dirección decide su destino.'
          : tipo === 'correccion' ? 'El cobro estuvo mal (no entró producto). Solo corrige el dinero; no toca inventario.'
          : 'Se cobró pero no debía (cortesía). Regresa el dinero; el producto se queda con el cliente, no toca inventario.'}
      </div>

      {tipo === 'devolucion' ? (
        <div style={{ marginBottom: 12 }}>
          {sellable.map((it) => {
            const max = returnable(it); const q = qtys[it.id] ?? 0
            const yaDev = it.qty - max
            return (
              <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>{productsById[it.product_id ?? '']?.name ?? 'Producto'}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{money(it.unit_price ?? 0)} · comprado {it.qty}{yaDev > 0 ? ` · ya devuelto ${yaDev}` : ''}</div>
                </div>
                {max === 0 ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Devuelto</span> : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" className="btn ghost sm" disabled={q <= 0} onClick={() => setQ(it.id, q - 1, max)}>−</button>
                    <span className="mono" style={{ minWidth: 24, textAlign: 'center' }}>{q}<span style={{ color: 'var(--ink-3)' }}>/{max}</span></span>
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
        {(tipo === 'devolucion' ? PRESETS_DEV : PRESETS_CORR).map((pz) => (
          <button key={pz} type="button" className="chip-btn" style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 999, backgroundColor: 'var(--cp-surface)', cursor: 'pointer' }} onClick={() => setMotivo(pz)}>{pz}</button>
        ))}
      </div>
      {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginBottom: 10 }}><span>{err}</span></div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn sm" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={submit}>
          {busy ? 'Autorizando…' : `Autorizar ${({ devolucion: 'devolución', correccion: 'corrección', cortesia: 'cortesía' } as const)[tipo]}`}
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
    const m = window.prompt('Motivo para revocar el crédito (el pedido dejará de estar liberado si no hay cobro suficiente).')
    if (m == null) return
    if (!m.trim()) { window.alert('La revocación necesita un motivo.'); return }
    const r = await revocarCreditoDePedido(newOpId(), { orderId: order.id, motivo: m })
    if (!r.ok) window.alert(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo revocar el crédito.'))
  }

  const fld: React.CSSProperties = { padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)' }

  if (dinero.credito_autorizado) {
    return (
      <div className="sysnote" style={{ marginBottom: 14, background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
        <span style={{ flex: 1 }}>
          <b>Crédito autorizado{dinero.vencido ? ' y VENCIDO' : ''}.</b> El pedido se puede surtir, pero <b>sigue debiendo {money(dinero.saldo)}</b>
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
