// Caja (Punto de Venta): venta en persona. Selecciona productos, arma la venta,
// cobra (efectivo/tarjeta) y completa. Al cobrar: crea orden POS pagada/entregada
// y descuenta inventario por lote (FEFO de Almacén, reutilizada).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { useProducts } from '../../data/hooks/useProducts'
import { venderPOS } from '../../data/ops/pos'
import type { OrderWithItems } from '../../data/hooks/useOrders'
import type { ProductSafe } from '../../data/types'

type PayMethod = 'efectivo' | 'tarjeta'
interface Line { product: ProductSafe; qty: number }

export function Caja() {
  const { data: products } = useProducts()
  const sellable = useMemo(() => products.filter((p) => p.price != null), [products])

  const [cart, setCart] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<PayMethod>('efectivo')
  const [done, setDone] = useState<OrderWithItems | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const lines: Line[] = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: sellable.find((p) => p.id === id), qty }))
        .filter((l): l is Line => Boolean(l.product)),
    [cart, sellable],
  )
  const total = lines.reduce((s, l) => s + (l.product.price ?? 0) * l.qty, 0)

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const dec = (id: string) =>
    setCart((c) => {
      const q = (c[id] ?? 0) - 1
      if (q <= 0) { const { [id]: _d, ...rest } = c; return rest }
      return { ...c, [id]: q }
    })

  const cobrar = () => {
    const res = venderPOS(
      lines.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: l.product.price ?? 0 })),
      total,
      method,
    )
    if (res.ok && res.order) {
      setDone(res.order)
      setCart({})
    } else {
      setErr('Sin stock suficiente para uno o más productos. Registra una entrada en Almacén.')
      window.setTimeout(() => setErr(null), 3000)
    }
  }

  return (
    <div className="grid pos-wrap">
      {/* Catálogo POS (solo productos con precio) */}
      <div className="grid" style={{ gap: 16 }}>
        <div className="eyebrow">Punto de Venta · Caja</div>
        <div className="posgrid">
          {sellable.map((p) => {
            const qty = cart[p.id] ?? 0
            return (
              <div key={p.id} className="poscard" onClick={() => add(p.id)}>
                <span className={'ltag ' + (p.line === 'prof' ? 'prof' : 'cosm')}>{p.line === 'prof' ? 'Professional' : 'Home Care'}</span>
                <h5>{p.name}</h5>
                <div className="lt">{p.category}</div>
                <div className="pr">{money(p.price)}</div>
                {qty > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" type="button" onClick={() => dec(p.id)}><Icon name="minus" /></button>
                    <span className="mono">{qty}</span>
                    <button className="btn sm" type="button" onClick={() => add(p.id)}><Icon name="plus" /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Ticket */}
      <div className="card ticket" style={{ position: 'sticky', top: 90 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <Icon name="store" style={{ width: 18, height: 18, color: 'var(--green-deep)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Venta</h3>
          {lines.length > 0 && <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setCart({})}>Vaciar</button>}
        </div>

        {lines.length === 0 ? (
          <div className="empty">Toca un producto para agregarlo a la venta.</div>
        ) : (
          <>
            {lines.map((l) => (
              <div key={l.product.id} className="titem">
                <div>
                  <div>{l.product.name}</div>
                  <div className="tl">{money(l.product.price)} × {l.qty}</div>
                </div>
                <span className="mono">{money((l.product.price ?? 0) * l.qty)}</span>
              </div>
            ))}

            <div className="tket-total" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}>
              <span>Total</span><b>{money(total)}</b>
            </div>

            <div style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700, margin: '14px 0 6px' }}>Pago</div>
            <div className="seg">
              <button type="button" className={method === 'efectivo' ? 'active' : undefined} onClick={() => setMethod('efectivo')}>Efectivo</button>
              <button type="button" className={method === 'tarjeta' ? 'active' : undefined} onClick={() => setMethod('tarjeta')}>Tarjeta</button>
            </div>

            <button className="btn" type="button" style={{ width: '100%', marginTop: 14 }} onClick={cobrar}>
              <Icon name="check" /> Cobrar {money(total)}
            </button>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>Pago inmediato · descuenta inventario por lote (FEFO).</div>
          </>
        )}

        {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><Icon name="x" /><span>{err}</span></div>}
      </div>

      {done && (
        <div className="overlay" onClick={() => setDone(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mbody">
              <div className="success">
                <div className="ck"><Icon name="check" /></div>
                <h3>Venta registrada</h3>
                <p>
                  <b>{done.external_ref}</b> · {money(done.total)} · {done.payment_method === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}.
                  Inventario descontado por lote. Ya suma en el Tablero.
                </p>
                <button className="btn" type="button" style={{ marginTop: 16 }} onClick={() => setDone(null)}>Nueva venta</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
