// TRAZABILIDAD (COFEPRIS): rastrear un lote de punta a punta. Solo lectura;
// AGREGA de inventory_movements + orders + lots existentes. No inventa datos.
//  - Por LOTE: entrada -> cada salida (a qué pedido/venta fue).
//  - Por PEDIDO (recall inverso): qué lotes lo surtieron (incluye splits FEFO).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { money, fmtDate } from '../../lib/format'
import { useInventory } from '../../data/hooks/useInventory'
import { useLots } from '../../data/hooks/useLots'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { daysUntil } from '../warehouse/expiry'
import { statusView } from '../doctor/orderStatus'
import { clientOf } from '../../data/mock/profiles'
import type { InventoryMovement, Lot } from '../../data/types'

type Mode = 'lote' | 'pedido'

const reasonLabel = (r: string | null): string =>
  r === 'entrada' ? 'Entrada' : r === 'surtido' ? 'Surtido' : r === 'venta' ? 'Venta POS' : r ?? '—'

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
  fontFamily: 'inherit', fontSize: 13.5, background: '#fff', minWidth: 240,
}

export function Trazabilidad() {
  const { data: movements } = useInventory()
  const { data: lots } = useLots()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()

  const [mode, setMode] = useState<Mode>('lote')

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])
  const lotById = useMemo(() => {
    const m: Record<string, Lot | undefined> = {}
    lots.forEach((l) => (m[l.id] = l))
    return m
  }, [lots])
  const orderByRef = useMemo(() => {
    const m: Record<string, OrderWithItems | undefined> = {}
    orders.forEach((o) => { if (o.external_ref) m[o.external_ref] = o })
    return m
  }, [orders])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Administración · Trazabilidad (COFEPRIS)</div>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={mode === 'lote' ? 'active' : undefined} onClick={() => setMode('lote')}>
          <Icon name="fingerprint" /> Por lote
        </button>
        <button type="button" className={mode === 'pedido' ? 'active' : undefined} onClick={() => setMode('pedido')}>
          <Icon name="bag" /> Por pedido (recall)
        </button>
      </div>

      {mode === 'lote' ? (
        <PorLote lots={lots} movements={movements} prodName={prodName} orderByRef={orderByRef} />
      ) : (
        <PorPedido orders={orders} movements={movements} lotById={lotById} prodName={prodName} />
      )}
    </div>
  )
}

function PorLote({
  lots, movements, prodName, orderByRef,
}: {
  lots: Lot[]
  movements: InventoryMovement[]
  prodName: Record<string, string>
  orderByRef: Record<string, OrderWithItems | undefined>
}) {
  const [lotId, setLotId] = useState(lots[0]?.id ?? '')
  const lot = lots.find((l) => l.id === lotId) ?? lots[0]

  const history = useMemo(
    () =>
      movements
        .filter((m) => m.lot_id === lot?.id)
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)), // cronológico (entrada primero)
    [movements, lot],
  )

  if (!lot) return <div className="card">No hay lotes registrados.</div>
  const st = lotStatus(lot)
  const salidas = history.filter((m) => m.change < 0)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Lote</span>
        <select style={selStyle} value={lotId} onChange={(e) => setLotId(e.target.value)}>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>{l.lot_code} · {prodName[l.product_id] ?? 'Producto'}</option>
          ))}
        </select>
      </div>

      {/* Resumen del lote */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span className="lc" style={{ fontSize: 13 }}>{lot.lot_code}</span>
          <span style={{ fontWeight: 600 }}>{prodName[lot.product_id] ?? 'Producto'}</span>
          <span className={'pill ' + st.pill} style={{ marginLeft: 'auto' }}>{st.label}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, fontSize: 13 }}>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Stock restante</div><b className="mono">{lot.quantity} u</b></div>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Caducidad</div>{fmtDate(lot.expiry_date ?? '')}</div>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Ubicación</div>{lot.location}</div>
          <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Salidas</div>{salidas.length}</div>
        </div>
      </div>

      {/* Cadena completa */}
      <div className="card">
        <div className="eyebrow">Cadena del lote</div>
        {history.length === 0 ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Sin movimientos registrados para este lote.</div>
        ) : (
          <div className="tl">
            {history.map((m) => {
              const out = m.change < 0
              const order = out ? orderByRef[m.reference ?? ''] : undefined
              return (
                <div key={m.id} className="tli">
                  <div className="dt">{fmtDate(m.created_at)}</div>
                  <div className="tt">
                    <span className={'pill ' + (out ? 'p-neu' : 'p-ok')} style={{ marginRight: 8 }}>{reasonLabel(m.reason)}</span>
                    <b className="mono">{m.change > 0 ? '+' : ''}{m.change} u</b>
                    {out ? (
                      <span> → {m.reference}{order ? ` · ${clientLabel(order)}` : ''}</span>
                    ) : (
                      <span> · caduca {fmtDate(lot.expiry_date ?? '')}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

function PorPedido({
  orders, movements, lotById, prodName,
}: {
  orders: OrderWithItems[]
  movements: InventoryMovement[]
  lotById: Record<string, Lot | undefined>
  prodName: Record<string, string>
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

        <div className="eyebrow">Lotes que surtieron este pedido (recall)</div>
        {salidas.length === 0 ? (
          <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
            <Icon name="fingerprint" />
            <span>Aún sin salidas de inventario registradas. Súrtelo en Almacén (o si es POS, ya quedó cobrado) para ver la traza por lote.</span>
          </div>
        ) : (
          <table className="tbl-cards">
            <thead><tr><th>Lote</th><th>Producto</th><th>Cantidad</th><th>Tipo</th></tr></thead>
            <tbody>
              {salidas.map((m) => {
                const lot = lotById[m.lot_id]
                return (
                  <tr key={m.id}>
                    <td data-label="Lote"><span className="lc">{lot?.lot_code ?? m.lot_id}</span></td>
                    <td data-label="Producto">{lot ? prodName[lot.product_id] ?? 'Producto' : '—'}</td>
                    <td data-label="Cantidad" className="mono">{-m.change} u</td>
                    <td data-label="Tipo"><span className="pill p-neu">{reasonLabel(m.reason)}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Renglones del pedido (contexto) */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0' }}><div className="eyebrow">Renglones del pedido</div></div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Importe</th></tr></thead>
            <tbody>
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td data-label="Producto">{prodName[it.product_id ?? ''] ?? 'Producto'}</td>
                  <td data-label="Cant." className="mono">{it.qty} u</td>
                  <td data-label="Importe" className="mono">{it.unit_price == null ? 'cotización' : money(it.unit_price * it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
