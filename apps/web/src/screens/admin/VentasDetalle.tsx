// ADMIN · Ventas → Detalle — el LIBRO DE VENTAS (solo lectura). Pedidos del
// Portal + ventas POS (mismo store), filtrable. NO es el Tablero ni Trazabilidad.
// Agrega de useAllOrders + useProducts + useDoctors vía data/metrics. Migrable a
// un select sobre Supabase sin tocar la pantalla.
import React, { useMemo, useState } from 'react'
import { TrendingUp, ShoppingBag, Receipt, Store, Search, X, FileText, Undo2 } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders, isCancelable, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useRefunds } from '../../data/hooks/useFinanzas'
import { useRole } from '../../auth/RoleContext'
import { salesSummary, channelSplit, topProducts, isPosOrder } from '../../data/metrics'
import { statusView } from '../doctor/orderStatus'
import { ExportButton } from '../../app/ExportButton'
import type { ProductSafe, Profile } from '../../data/types'

type ChannelFilter = 'todos' | 'portal' | 'pos'
type PayFilter = 'todos' | 'pagado' | 'contra' | 'pendiente'

interface PayInfo { key: Exclude<PayFilter, 'todos'>; label: string; pill: string }
function payInfo(o: OrderWithItems): PayInfo {
  if (o.payment_status === 'paid') return { key: 'pagado', label: 'Pagado', pill: 'p-ok' }
  if (o.payment_method === 'contra_pedido') return { key: 'contra', label: 'Contra pedido', pill: 'p-warn' }
  return { key: 'pendiente', label: 'Pendiente', pill: 'p-neu' }
}
const channelOf = (o: OrderWithItems): 'portal' | 'pos' => (isPosOrder(o) ? 'pos' : 'portal')

const sel: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 11,
  fontFamily: 'inherit', fontSize: 13, background: '#fff', outline: 'none',
}

export function VentasDetalle() {
  const { data: orders, cancelOrder } = useAllOrders()
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

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return orders
      .filter((o) => {
        const d = o.created_at.slice(0, 10)
        if (from && d < from) return false
        if (to && d > to) return false
        if (channel !== 'todos' && channelOf(o) !== channel) return false
        if (pay !== 'todos' && payInfo(o).key !== pay) return false
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
        <Stat icon={<TrendingUp size={18} />} v={money(sum.revenue)} k="Total vendido" s={`${rows.length} ventas`} />
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
          <option value="contra">Contra pedido</option>
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
          { key: 'id', label: 'Cobro', format: (_v, o) => payInfo(o).label },
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
                const p = payInfo(o); const sv = statusView(o.status); const isPos = channelOf(o) === 'pos'
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
        <SaleDetail order={selectedOrder} productsById={productsById} clientName={clientName(selectedOrder)} channel={channelOf(selectedOrder)} onClose={() => setSelected(null)} onCancel={() => { if (window.confirm('¿Cancelar este pedido? Se reingresa el inventario si ya estaba surtido.')) { const r = cancelOrder(selectedOrder.id, 'Administración'); if (!r.ok) window.alert('Este pedido ya no se puede cancelar (cambió de estado).'); setSelected(null) } }} />
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

function SaleDetail({ order, productsById, clientName, channel, onClose, onCancel }: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  clientName: string
  channel: 'portal' | 'pos'
  onClose: () => void
  onCancel: () => void
}) {
  const p = payInfo(order); const sv = statusView(order.status)
  const { user } = useRole()
  const { data: refunds, refundedByOrder } = useRefunds()
  const misDevs = refunds.filter((r) => r.order_id === order.id)
  const yaDevuelto = refundedByOrder(refunds)[order.id] ?? 0
  const restante = (order.total ?? 0) - yaDevuelto
  const puedeDevolver = order.status !== 'cancelled' && order.status !== 'draft' && restante > 0.0001
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
              {misDevs.map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className={'pill ' + (r.tipo === 'correccion' ? 'p-warn' : 'p-neu')}>{r.tipo === 'correccion' ? 'Corrección' : 'Devolución'}</span>
                  <span className="mono" style={{ color: 'var(--danger)' }}>− {money(r.monto)}</span>
                  <span style={{ color: 'var(--ink-2)', flex: 1 }}>{r.motivo}</span>
                  <span style={{ color: 'var(--ink-3)', fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)} · {r.usuario}</span>
                </div>
              ))}
            </div>
          )}

          {puedeDevolver && !showForm && (
            <div style={{ marginTop: 14 }}>
              <button className="btn ghost sm" type="button" onClick={() => setShowForm(true)}><Undo2 size={14} /> Devolver / Corregir</button>
            </div>
          )}
          {puedeDevolver && showForm && (
            <DevolverForm order={order} restante={restante} usuario={user?.name ?? 'Administración'} onClose={() => setShowForm(false)} />
          )}

          {order.invoice_requested && (
            <div className="sysnote" style={{ marginTop: 14 }}>
              <FileText size={16} />
              <span>El cliente solicitó factura. La generación del CFDI se hace en <b>Facturación</b> (diferido); aquí solo se refleja la solicitud.</span>
            </div>
          )}

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

// Formulario de Devolver/Corregir: mismo movimiento contable, distinta semántica.
// El monto tiene TOPE (lo que resta del pedido) y el motivo es obligatorio. La RPC
// reimpone ambas validaciones del lado servidor.
const PRESETS_CORR = ['Cobro duplicado', 'No pagó (era cortesía)', 'Error de captura']
const PRESETS_DEV = ['Producto devuelto', 'Cliente canceló', 'Producto dañado']
function DevolverForm({ order, restante, usuario, onClose }: {
  order: OrderWithItems
  restante: number
  usuario: string
  onClose: () => void
}) {
  const { registrarDevolucion } = useRefunds()
  const [tipo, setTipo] = useState<'devolucion' | 'correccion'>('devolucion')
  const [monto, setMonto] = useState(String(restante))
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const montoN = Math.max(0, Number(monto) || 0)
  const valid = montoN > 0 && montoN <= restante + 0.0001 && motivo.trim().length >= 3
  const presets = tipo === 'correccion' ? PRESETS_CORR : PRESETS_DEV

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setErr('')
    const r = await registrarDevolucion({ orderId: order.id, tipo, monto: montoN, motivo, usuario })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'No se pudo registrar.'); return }
    onClose()
  }

  const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, outline: 'none' }
  return (
    <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--hueso, #f8f9f6)' }}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button type="button" className={tipo === 'devolucion' ? 'active' : undefined} onClick={() => setTipo('devolucion')}>Devolución al cliente</button>
        <button type="button" className={tipo === 'correccion' ? 'active' : undefined} onClick={() => setTipo('correccion')}>Corrección de error</button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 10 }}>
        {tipo === 'devolucion' ? 'Se le regresó dinero al cliente (producto devuelto, etc.).' : 'El cobro estuvo mal (no entró dinero de verdad). Corrige el neto.'}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
        <div style={{ flex: '0 0 140px' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Monto (máx {money(restante)})</label>
          <input type="number" min={0} max={restante} style={{ ...fld, marginTop: 5 }} value={monto} onChange={(e) => setMonto(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Motivo</label>
          <input style={{ ...fld, marginTop: 5 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué?" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {presets.map((pz) => (
          <button key={pz} type="button" className="chip-btn" style={{ fontSize: 11.5, padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 999, background: '#fff', cursor: 'pointer' }} onClick={() => setMotivo(pz)}>{pz}</button>
        ))}
      </div>
      {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginBottom: 10 }}><span>{err}</span></div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn sm" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={submit}>
          {busy ? 'Registrando…' : `Registrar ${tipo === 'correccion' ? 'corrección' : 'devolución'}`}
        </button>
      </div>
    </div>
  )
}
