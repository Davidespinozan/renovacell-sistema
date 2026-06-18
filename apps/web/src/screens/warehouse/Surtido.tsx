// Surtido (FEFO): toma un pedido pendiente del store compartido y lo surte
// asignando lotes por caducidad ascendente. Al confirmar, descuenta lotes,
// registra movimientos y mueve el pedido a Empacado (se ve en el Portal).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate, money } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { planSurtido, canFulfill, surtirPedido, type ItemPlan } from '../../data/ops/surtir'
import { isSurtible } from '../../data/ops/seguimiento'
import { statusView } from '../doctor/orderStatus'
import type { ProductSafe } from '../../data/types'

export function Surtido() {
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const [active, setActive] = useState<OrderWithItems | null>(null)

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const pending = orders.filter(isSurtible)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Almacén · Surtido (FEFO)</div>
      <div className="footnote">
        <span className="d" />
        El sistema sugiere lotes por FEFO: sale primero el que caduca antes. Al confirmar se descuenta del lote y se registra el movimiento.
      </div>

      {pending.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No hay pedidos pendientes de surtir.
        </div>
      ) : (
        pending.map((o) => {
          const sv = statusView(o.status)
          return (
            <div key={o.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
                <span className={'pill ' + sv.pill}><span className="d" /> {sv.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(o.created_at)}</span>
              </div>
              {o.items.map((it) => (
                <div key={it.id} className="coitem">
                  <span>
                    {byId[it.product_id ?? '']?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{it.qty}</span>
                    {it.unit_price == null && <span className="pill p-blue" style={{ marginLeft: 8 }}>Cotización</span>}
                  </span>
                  <span className="mono">{it.unit_price == null ? 'a consultar' : money(it.unit_price * it.qty)}</span>
                </div>
              ))}
              <button className="btn" type="button" style={{ marginTop: 12 }} onClick={() => setActive(o)}>
                <Icon name="layers" /> Surtir (FEFO)
              </button>
            </div>
          )
        })
      )}

      {active && <SurtirModal order={active} productsById={byId} onClose={() => setActive(null)} />}
    </div>
  )
}

function SurtirModal({
  order, productsById, onClose,
}: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  onClose: () => void
}) {
  const { data: lots } = useLots()
  const [done, setDone] = useState(false)

  const plans = useMemo(() => planSurtido(order, lots), [order, lots])
  const ok = canFulfill(plans)

  const confirm = () => {
    const res = surtirPedido(order)
    if (res.ok) setDone(true)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pedido surtido</h3>
              <p>
                <b>{order.external_ref}</b> quedó <b>Empacado</b>. Se descontaron los lotes por FEFO y se
                registraron los movimientos. El doctor ya lo ve en su seguimiento.
              </p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Surtir {order.external_ref}</h3>
                <div className="ms">Lotes sugeridos por FEFO (sale primero el que caduca antes).</div>
              </div>
              <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
            </div>
            <div className="mbody">
              {plans.map((p) => (
                <ItemPlanRow key={p.item.id} plan={p} name={productsById[p.item.product_id ?? '']?.name ?? 'Producto'} />
              ))}

              {!ok && (
                <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}>
                  <Icon name="x" />
                  <span>No hay stock suficiente para surtir todos los renglones de compra. Registra una entrada o ajusta el pedido.</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" onClick={confirm} disabled={!ok} style={!ok ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                  <Icon name="check" /> Confirmar lotes (FEFO)
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ItemPlanRow({ plan, name }: { plan: ItemPlan; name: string }) {
  if (plan.quote) {
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{name} <span style={{ color: 'var(--ink-3)' }}>×{plan.item.qty}</span></div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4 }}>
          <span className="pill p-blue">Cotización</span> No se surte (solicitud de cotización, sin precio).
        </div>
      </div>
    )
  }
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{name} <span style={{ color: 'var(--ink-3)' }}>×{plan.item.qty}</span></span>
        {plan.shortfall > 0 && <span className="pill p-dang" style={{ marginLeft: 'auto' }}>Faltan {plan.shortfall} u</span>}
      </div>
      <div className="tbl-scroll">
        <table className="tbl-cards">
          <thead>
            <tr><th>Lote sugerido</th><th>Caducidad</th><th>Cant.</th></tr>
          </thead>
          <tbody>
            {plan.allocations.map((a, i) => (
              <tr key={a.lot.id}>
                <td data-label="Lote sugerido">
                  <span className="lc">{a.lot.lot_code}</span>
                  {i === 0 && <span className="fefo" style={{ marginLeft: 8 }}><Icon name="check" /> FEFO</span>}
                </td>
                <td data-label="Caducidad">{fmtDate(a.lot.expiry_date ?? '')}</td>
                <td data-label="Cant." className="mono">{a.qty} u</td>
              </tr>
            ))}
            {plan.allocations.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--danger)' }}>Sin stock disponible</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
