// TRAZABILIDAD (COFEPRIS). Responde en segundos dos preguntas del negocio:
//  · "Seguir un lote" (recall): si un lote sale con problema, ¿A QUÉ CLIENTES
//    llegó? — para avisarles. Incluye de dónde vino y qué queda.
//  · "Revisar un pedido": ¿con qué lotes se surtió? (recall inverso).
// Solo lectura; agrega de inventory_movements + lots + orders. No inventa datos.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { money, fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useInventory } from '../../data/hooks/useInventory'
import { useLots } from '../../data/hooks/useLots'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { daysUntil } from '../warehouse/expiry'
import { statusView } from '../doctor/orderStatus'
import { clientOf } from '../../data/mock/profiles'
import type { InventoryMovement, Lot } from '../../data/types'

type Mode = 'lote' | 'pedido'

const clientLabel = (o: OrderWithItems | undefined): string =>
  !o ? '—' : o.doctor_id ? clientOf(o.doctor_id).name : 'Venta en mostrador (POS)'

function lotStatus(lot: Lot): { label: string; pill: string } {
  if (lot.quantity <= 0) return { label: 'Agotado', pill: 'p-neu' }
  const d = daysUntil(lot.expiry_date)
  if (d != null && d < 0) return { label: 'Caducado', pill: 'p-dang' }
  return { label: 'Activo', pill: 'p-ok' }
}

const selStyle: React.CSSProperties = {
  padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 11,
  fontFamily: 'inherit', fontSize: 13.5, background: '#fff', minWidth: 260,
}

export function Trazabilidad() {
  const { data: movements } = useInventory()
  const { data: lots } = useLots()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const [mode, setMode] = useState<Mode>('lote')

  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const lotById = useMemo(() => Object.fromEntries(lots.map((l) => [l.id, l])) as Record<string, Lot | undefined>, [lots])
  const orderByRef = useMemo(() => {
    const m: Record<string, OrderWithItems | undefined> = {}
    orders.forEach((o) => { if (o.external_ref) m[o.external_ref] = o })
    return m
  }, [orders])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Trazabilidad">
        Para responder al instante: si un <b>lote</b> sale con problema, <b>a qué clientes llegó</b> (para
        avisarles); y con qué lotes se surtió un <b>pedido</b>. Es tu respaldo ante COFEPRIS y para un recall.
      </PageHead>

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={mode === 'lote' ? 'active' : undefined} onClick={() => setMode('lote')}>
          <Icon name="fingerprint" /> Seguir un lote
        </button>
        <button type="button" className={mode === 'pedido' ? 'active' : undefined} onClick={() => setMode('pedido')}>
          <Icon name="bag" /> Revisar un pedido
        </button>
      </div>

      {mode === 'lote'
        ? <PorLote lots={lots} movements={movements} prodName={prodName} orderByRef={orderByRef} />
        : <PorPedido orders={orders} movements={movements} lotById={lotById} prodName={prodName} />}
    </div>
  )
}

function PorLote({ lots, movements, prodName, orderByRef }: {
  lots: Lot[]; movements: InventoryMovement[]; prodName: Record<string, string>; orderByRef: Record<string, OrderWithItems | undefined>
}) {
  const [lotId, setLotId] = useState(lots[0]?.id ?? '')
  const lot = lots.find((l) => l.id === lotId) ?? lots[0]

  const hist = useMemo(
    () => movements.filter((m) => m.lot_id === lot?.id).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
    [movements, lot],
  )
  if (!lot) return <div className="card">No hay lotes registrados.</div>

  const st = lotStatus(lot)
  const entrada = hist.find((m) => m.change > 0)
  const salidas = hist.filter((m) => m.change < 0)
  // Clientes alcanzados por el lote (para el recall).
  const destinos = salidas.map((m) => {
    const o = orderByRef[m.reference ?? '']
    return { qty: -m.change, folio: m.reference ?? '—', cliente: clientLabel(o), fecha: m.created_at }
  })
  const clientesUnicos = new Set(destinos.map((d) => d.cliente)).size

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Lote</span>
        <select style={selStyle} value={lotId} onChange={(e) => setLotId(e.target.value)}>
          {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_code} · {prodName[l.product_id] ?? 'Producto'}</option>)}
        </select>
      </div>

      {/* Resumen */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span className="lc" style={{ fontSize: 13 }}>{lot.lot_code}</span>
          <span style={{ fontWeight: 600 }}>{prodName[lot.product_id] ?? 'Producto'}</span>
          <span className={'pill ' + st.pill} style={{ marginLeft: 'auto' }}>{st.label}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, fontSize: 13 }}>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Quedan</div><b className="mono">{lot.quantity} u</b></div>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Caduca</div>{fmtDate(lot.expiry_date ?? '')}</div>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Ubicación</div>{lot.location ?? '—'}</div>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Llegó a</div><b>{clientesUnicos}</b> cliente(s)</div>
        </div>
      </div>

      {/* De dónde vino */}
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 8 }}>De dónde vino</div>
        {entrada
          ? <div style={{ fontSize: 14 }}><span className="pill p-ok" style={{ marginRight: 8 }}>Alta en almacén</span><b className="mono">+{entrada.change} u</b> el {fmtDate(entrada.created_at)}{entrada.reference ? <span style={{ color: 'var(--ink-3)' }}> · ref. {entrada.reference}</span> : null}</div>
          : <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Sin registro de entrada.</div>}
      </div>

      {/* A dónde llegó (recall) */}
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 4 }}>A dónde llegó · recall</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>
          Si este lote saliera con problema, estos son los clientes a los que tendrías que avisar.
        </div>
        {destinos.length === 0 ? (
          <div className="sysnote"><Icon name="check" /><span>Este lote aún no ha salido a ningún cliente.</span></div>
        ) : (
          <table className="tbl-cards">
            <thead><tr><th>Cliente</th><th>Pedido</th><th>Cantidad</th><th>Fecha</th></tr></thead>
            <tbody>
              {destinos.map((d, i) => (
                <tr key={i}>
                  <td data-label="Cliente"><b>{d.cliente}</b></td>
                  <td data-label="Pedido" className="mono">{d.folio}</td>
                  <td data-label="Cantidad" className="mono">{d.qty} u</td>
                  <td data-label="Fecha">{fmtDate(d.fecha)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function PorPedido({ orders, movements, lotById, prodName }: {
  orders: OrderWithItems[]; movements: InventoryMovement[]; lotById: Record<string, Lot | undefined>; prodName: Record<string, string>
}) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '')
  const order = orders.find((o) => o.id === orderId) ?? orders[0]
  const salidas = useMemo(
    () => (order ? movements.filter((m) => m.reference === order.external_ref && m.change < 0) : []),
    [movements, order],
  )
  if (!order) return <div className="card">No hay pedidos registrados.</div>
  const sv = statusView(order.status)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Pedido</span>
        <select style={selStyle} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.external_ref} · {clientLabel(o)}</option>)}
        </select>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
          <span className={'pill ' + sv.pill}>{sv.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>{clientLabel(order)} · {fmtDate(order.created_at)}</span>
        </div>

        <div className="eyebrow" style={{ marginBottom: 4 }}>Con qué lotes se surtió</div>
        {salidas.length === 0 ? (
          <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
            <Icon name="fingerprint" />
            <span>Todavía sin salidas de inventario. Aparecerá aquí en cuanto Almacén lo surta (o si es POS, al cobrar).</span>
          </div>
        ) : (
          <table className="tbl-cards">
            <thead><tr><th>Lote</th><th>Producto</th><th>Cantidad</th><th>Caduca</th></tr></thead>
            <tbody>
              {salidas.map((m) => {
                const lot = lotById[m.lot_id]
                return (
                  <tr key={m.id}>
                    <td data-label="Lote"><span className="lc">{lot?.lot_code ?? m.lot_id}</span></td>
                    <td data-label="Producto">{lot ? prodName[lot.product_id] ?? 'Producto' : '—'}</td>
                    <td data-label="Cantidad" className="mono">{-m.change} u</td>
                    <td data-label="Caduca">{lot ? fmtDate(lot.expiry_date ?? '') : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0' }}><div className="eyebrow">Qué se pidió</div></div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td data-label="Producto">{prodName[it.product_id ?? ''] ?? 'Producto'}</td>
                  <td data-label="Cant." className="mono">{it.qty} {it.qty === 1 ? 'pza' : 'pzas'}</td>
                  <td data-label="Importe" className="mono">{money((it.unit_price ?? 0) * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
