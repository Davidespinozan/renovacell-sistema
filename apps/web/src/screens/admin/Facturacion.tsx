// ADMIN · Facturación — gestión de CFDI y cobro (solo lectura + acciones mock).
// Trabaja sobre el MISMO store de pedidos (Portal + POS): muestra estatus de
// cobro y de CFDI, y permite "Emitir CFDI" / "Marcar cobrado". La emisión REAL
// del CFDI (Facturama/PAC) y el cobro por Stripe se conectan en la fase de
// Supabase; aquí es simulación con la forma final de orders.invoice_meta.
import React, { useMemo, useState } from 'react'
import { Receipt, FileText, FileCheck2, BadgeDollarSign, Clock, X } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import { markInvoiced, markPaid } from '../../data/store/ordersStore'
import { billingSummary, isPosOrder } from '../../data/metrics'
import { ExportButton } from '../../app/ExportButton'
import type { ProductSafe, Profile } from '../../data/types'

type Filter = 'todos' | 'por_emitir' | 'emitidos' | 'por_cobrar'

const isEmitida = (o: OrderWithItems): boolean =>
  ((o.invoice_meta as Record<string, unknown> | null)?.status as string) === 'emitida'
const cfdiUuid = (o: OrderWithItems): string | null =>
  ((o.invoice_meta as Record<string, unknown> | null)?.uuid as string) ?? null
const notCancelled = (o: OrderWithItems) => o.status !== 'cancelled'

interface Tag { label: string; pill: string }
function cobroTag(o: OrderWithItems): Tag {
  if (o.payment_status === 'paid') return { label: 'Pagado', pill: 'p-ok' }
  if (o.payment_method === 'contra_pedido') return { label: 'Contra pedido', pill: 'p-warn' }
  return { label: 'Pendiente', pill: 'p-neu' }
}
function cfdiTag(o: OrderWithItems): Tag {
  if (isEmitida(o)) return { label: 'Emitido', pill: 'p-ok' }
  if (o.invoice_requested) return { label: 'Solicitado', pill: 'p-warn' }
  return { label: 'Sin CFDI', pill: 'p-neu' }
}

export function Facturacion() {
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { data: doctors } = useDoctors()
  const [filter, setFilter] = useState<Filter>('todos')
  const [selected, setSelected] = useState<string | null>(null)

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, ProductSafe | undefined>, [products])
  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])
  const clientName = (o: OrderWithItems) => (o.doctor_id ? doctorsById[o.doctor_id]?.full_name ?? 'Doctor' : 'Mostrador (POS)')

  const valid = useMemo(() => orders.filter(notCancelled), [orders])
  const bill = billingSummary(valid)
  const solicitados = valid.filter((o) => o.invoice_requested).length
  const porEmitir = valid.filter((o) => o.invoice_requested && !isEmitida(o)).length
  const emitidos = valid.filter(isEmitida).length

  const rows = useMemo(() => {
    const base = valid.filter((o) => {
      if (filter === 'por_emitir') return o.invoice_requested && !isEmitida(o)
      if (filter === 'emitidos') return isEmitida(o)
      if (filter === 'por_cobrar') return o.payment_status !== 'paid'
      return true
    })
    return base.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }, [valid, filter])

  // Cuentas por cobrar agregadas por cliente (Sección B: alertas de adeudo).
  const debt = useMemo(() => {
    const m = new Map<string, { name: string; count: number; total: number; oldest: string }>()
    valid.filter((o) => o.payment_status !== 'paid' && o.doctor_id).forEach((o) => {
      const id = o.doctor_id as string
      const e = m.get(id) ?? { name: doctorsById[id]?.full_name ?? 'Doctor', count: 0, total: 0, oldest: o.created_at }
      e.count += 1; e.total += o.total ?? 0
      if (o.created_at < e.oldest) e.oldest = o.created_at
      m.set(id, e)
    })
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [valid, doctorsById])
  const debtTotal = debt.reduce((s, d) => s + d.total, 0)

  const selectedOrder = orders.find((o) => o.id === selected) ?? null

  if (orders.length === 0) {
    return <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Aún no hay ventas que facturar.</div>
  }

  const CHIPS: { k: Filter; label: string }[] = [
    { k: 'todos', label: 'Todos' },
    { k: 'por_emitir', label: `Por emitir${porEmitir ? ` · ${porEmitir}` : ''}` },
    { k: 'emitidos', label: 'Emitidos' },
    { k: 'por_cobrar', label: 'Por cobrar' },
  ]

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Administración · Facturación</div>

      {/* KPIs */}
      <div className="grid sigs">
        <Stat icon={<FileText size={18} />} v={String(solicitados)} k="CFDI solicitados" s="por el cliente" />
        <Stat icon={<Receipt size={18} />} v={String(porEmitir)} k="Por emitir" s="solicitados sin CFDI" />
        <Stat icon={<FileCheck2 size={18} />} v={String(emitidos)} k="Emitidos" s="CFDI generados" />
        <Stat icon={<BadgeDollarSign size={18} />} v={money(bill.paid)} k="Cobrado" s="pagos confirmados" />
        <Stat icon={<Clock size={18} />} v={money(bill.pending)} k="Por cobrar" s="contra pedido / pendiente" />
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="fchips">
          {CHIPS.map((c) => (
            <button key={c.k} type="button" className={'fchip' + (filter === c.k ? ' on' : '')} onClick={() => setFilter(c.k)}>{c.label}</button>
          ))}
        </div>
        <ExportButton name="facturacion" rows={rows} style={{ marginLeft: 'auto' }} columns={[
          { key: 'external_ref', label: 'Folio' },
          { key: 'created_at', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
          { key: 'id', label: 'Cliente', format: (_v, o) => clientName(o) },
          { key: 'total', label: 'Total', format: (v) => money(v as number) },
          { key: 'id', label: 'Cobro', format: (_v, o) => cobroTag(o).label },
          { key: 'id', label: 'CFDI', format: (_v, o) => cfdiTag(o).label },
          { key: 'id', label: 'UUID', format: (_v, o) => cfdiUuid(o) ?? '' },
          { key: 'payment_method', label: 'Método de pago' },
        ]} />
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Monto</th><th>Cobro</th><th>CFDI</th></tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const cob = cobroTag(o); const cf = cfdiTag(o); const pos = isPosOrder(o)
                return (
                  <tr key={o.id} className="clickrow" onClick={() => setSelected(o.id)}>
                    <td data-label="Folio" className="mono">{o.external_ref}</td>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.created_at)}</td>
                    <td data-label="Cliente">{clientName(o)}{pos ? ' ' : ''}</td>
                    <td data-label="Monto" className="mono">{money(o.total)}</td>
                    <td data-label="Cobro"><span className={'pill ' + cob.pill}>{cob.label}</span></td>
                    <td data-label="CFDI"><span className={'pill ' + cf.pill}>{cf.label}</span></td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>Sin ventas en este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cuentas por cobrar por cliente (alertas de adeudo) */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Cuentas por cobrar · por cliente</div>
          {debtTotal > 0 && <span className="pill p-warn" style={{ marginLeft: 'auto' }}>Adeudo total {money(debtTotal)}</span>}
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Cliente</th><th>Pedidos</th><th>Adeudo</th><th>Antigüedad</th></tr></thead>
            <tbody>
              {debt.map((d) => {
                const days = Math.max(0, Math.floor((Date.now() - new Date(d.oldest).getTime()) / 86_400_000))
                return (
                  <tr key={d.name}>
                    <td data-label="Cliente">{d.name}</td>
                    <td data-label="Pedidos" className="mono">{d.count}</td>
                    <td data-label="Adeudo" className="mono">{money(d.total)}</td>
                    <td data-label="Antigüedad"><span className={'pill ' + (days > 30 ? 'p-warn' : 'p-neu')}>{days} d</span></td>
                  </tr>
                )
              })}
              {debt.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-3)' }}>Sin adeudos · todo cobrado. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedOrder && (
        <BillDetail order={selectedOrder} productsById={productsById} clientName={clientName(selectedOrder)} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function Stat({ icon, v, k, s }: { icon: React.ReactNode; v: string; k: string; s: string }) {
  return (
    <div className="card sig">
      <div className="chip">{icon}</div>
      <div className="v" style={{ fontSize: 19 }}>{v}</div>
      <div className="k">{k}</div>
      <div className="s">{s}</div>
    </div>
  )
}

function BillDetail({ order, productsById, clientName, onClose }: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  clientName: string
  onClose: () => void
}) {
  const cob = cobroTag(order); const cf = cfdiTag(order)
  const emitida = isEmitida(order); const uuid = cfdiUuid(order)
  const paid = order.payment_status === 'paid'

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>{order.external_ref}</h3>
            <div className="ms">{clientName} · {fmtDate(order.created_at)}</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className={'pill ' + cob.pill}>{cob.label}</span>
            <span className={'pill ' + cf.pill}>{cf.label}</span>
          </div>

          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td data-label="Producto">{productsById[it.product_id ?? '']?.name ?? 'Producto'}</td>
                  <td data-label="Cant." className="mono">{it.qty}</td>
                  <td data-label="Importe" className="mono">{money((it.unit_price ?? 0) * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="cototal" style={{ marginTop: 12 }}><span>Total</span><b>{money(order.total)}</b></div>

          {emitida && uuid && (
            <div className="sysnote" style={{ marginTop: 14 }}>
              <FileCheck2 size={16} />
              <span>CFDI emitido · UUID <b className="mono">{uuid}</b></span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {!paid && (
              <button className="btn ghost" type="button" onClick={() => markPaid(order.id)}>
                <BadgeDollarSign size={15} /> Marcar cobrado
              </button>
            )}
            {!emitida ? (
              <button className="btn" type="button" onClick={() => markInvoiced(order.id)}>
                <FileText size={15} /> Emitir CFDI
              </button>
            ) : (
              <button className="btn" type="button" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                <FileCheck2 size={15} /> CFDI emitido
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
