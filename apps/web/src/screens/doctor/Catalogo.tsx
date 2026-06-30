// Catálogo del Portal del Doctor + flujo "armar pedido".
// Catálogo (products_safe) -> agregar al pedido -> revisar -> crear (contra pedido).
// Sin costo/margen (forma products_safe). Todos los productos tienen precio.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { useProducts } from '../../data/hooks/useProducts'
import { useOrders } from '../../data/hooks/useOrders'
import type { ProductSafe } from '../../data/types'

type LineFilter = 'all' | 'cosm' | 'prof'
type Cart = Record<string, number>

interface CartLine {
  product: ProductSafe
  qty: number
}

export function Catalogo() {
  const { data: products, loading } = useProducts()
  const { createOrder } = useOrders()

  const [filter, setFilter] = useState<LineFilter>('all')
  const [cart, setCart] = useState<Cart>({})
  const [checkout, setCheckout] = useState(false)

  const shown = useMemo(
    () => products.filter((p) => (filter === 'all' ? true : p.line === filter)),
    [products, filter],
  )

  const lines: CartLine[] = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
        .filter((l): l is CartLine => Boolean(l.product)),
    [cart, products],
  )

  const total = lines.reduce((sum, l) => sum + (l.product.price ?? 0) * l.qty, 0)

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const dec = (id: string) =>
    setCart((c) => {
      const q = (c[id] ?? 0) - 1
      if (q <= 0) {
        const { [id]: _drop, ...rest } = c
        return rest
      }
      return { ...c, [id]: q }
    })
  const clear = () => setCart({})

  const onConfirm = (invoice: boolean) =>
    createOrder({
      lines: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: l.product.price })),
      total,
      invoice_requested: invoice,
    })

  if (loading) return <div className="card">Cargando catálogo…</div>

  return (
    <div className="grid pos-wrap">
      {/* IZQUIERDA: catálogo */}
      <div className="grid" style={{ gap: 16 }}>
        <div className="eyebrow">Portal del Doctor · Catálogo</div>
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {([['all', 'Todos'], ['cosm', 'Home Care'], ['prof', 'Professional']] as const).map(([k, lbl]) => (
            <button key={k} type="button" className={filter === k ? 'active' : undefined} onClick={() => setFilter(k)}>
              {lbl}
            </button>
          ))}
        </div>

        <div className="pgrid">
          {shown.map((p) => (
            <ProductCard key={p.id} p={p} qty={cart[p.id] ?? 0} onAdd={() => add(p.id)} onDec={() => dec(p.id)} />
          ))}
        </div>
      </div>

      {/* DERECHA: pedido en curso */}
      <CartPanel lines={lines} total={total} onInc={add} onDec={dec} onClear={clear} onReview={() => setCheckout(true)} />

      {checkout && (
        <CheckoutModal
          lines={lines}
          total={total}
          onConfirm={onConfirm}
          onDone={clear}
          onClose={() => setCheckout(false)}
        />
      )}
    </div>
  )
}

function ProductCard({ p, qty, onAdd, onDec }: { p: ProductSafe; qty: number; onAdd: () => void; onDec: () => void }) {
  const isProf = p.line === 'prof'
  return (
    <div className="pcard">
      <div className={'ptile ' + (isProf ? 'prof' : 'cosm')} style={p.image_url ? { padding: 0, overflow: 'hidden' } : undefined}>
        <span className="pbadge"><span className={'ltag ' + (isProf ? 'prof' : 'cosm')}>{isProf ? 'Professional' : 'Home Care'}</span></span>
        {p.image_url
          ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon name="leaf" />}
      </div>
      <div className="pb">
        <h5>{p.name}</h5>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{p.category}</div>
        <div className="pr">{money(p.price)}</div>
        {qty === 0 ? (
          <button className="addb" type="button" onClick={onAdd}>
            <Icon name="plus" /> Agregar
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
            <button className="btn ghost sm" type="button" onClick={onDec}><Icon name="minus" /></button>
            <span className="mono" style={{ fontSize: 15 }}>{qty}</span>
            <button className="btn sm" type="button" onClick={onAdd}><Icon name="plus" /></button>
          </div>
        )}
      </div>
    </div>
  )
}

function CartPanel({
  lines, total, onInc, onDec, onClear, onReview,
}: {
  lines: CartLine[]
  total: number
  onInc: (id: string) => void
  onDec: (id: string) => void
  onClear: () => void
  onReview: () => void
}) {
  const empty = lines.length === 0
  return (
    <div className="card ticket" style={{ position: 'sticky', top: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
        <Icon name="cart" style={{ width: 18, height: 18, color: 'var(--green-deep)' }} />
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>Tu pedido</h3>
        {!empty && (
          <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={onClear}>
            Vaciar
          </button>
        )}
      </div>

      {empty && <div className="empty">Agrega productos del catálogo para armar tu pedido.</div>}

      {lines.map((l) => (
        <LineRow key={l.product.id} l={l} onInc={() => onInc(l.product.id)} onDec={() => onDec(l.product.id)} />
      ))}

      {!empty && (
        <>
          <div className="tket-total" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}>
            <span>Total</span>
            <b>{money(total)}</b>
          </div>
          <button className="btn" type="button" style={{ width: '100%', marginTop: 14 }} onClick={onReview}>
            <Icon name="check" /> Revisar y crear pedido
          </button>
        </>
      )}
    </div>
  )
}

function LineRow({ l, onInc, onDec }: { l: CartLine; onInc: () => void; onDec: () => void }) {
  return (
    <div className="titem">
      <div>
        <div>{l.product.name}</div>
        <div className="tl">{money(l.product.price)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn ghost sm" type="button" onClick={onDec}><Icon name="minus" /></button>
        <span className="mono">{l.qty}</span>
        <button className="btn ghost sm" type="button" onClick={onInc}><Icon name="plus" /></button>
      </div>
    </div>
  )
}

function CheckoutModal({
  lines, total, onConfirm, onDone, onClose,
}: {
  lines: CartLine[]
  total: number
  onConfirm: (invoice: boolean) => { external_ref: string | null }
  onDone: () => void
  onClose: () => void
}) {
  const [invoice, setInvoice] = useState(false)
  const [folio, setFolio] = useState<string | null>(null)

  const confirm = () => {
    const order = onConfirm(invoice)
    setFolio(order.external_ref ?? '—')
    onDone() // limpia el carrito
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {folio ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pedido creado</h3>
              <p>
                Tu pedido <b>{folio}</b> quedó registrado como <b>pago contra pedido</b>.
              </p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Entendido</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Revisar pedido</h3>
              </div>
              <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
            </div>
            <div className="mbody">
              {lines.map((l) => (
                <div key={l.product.id} className="coitem">
                  <span>{l.product.name} <span style={{ color: 'var(--ink-3)' }}>×{l.qty}</span></span>
                  <span className="mono">{money((l.product.price ?? 0) * l.qty)}</span>
                </div>
              ))}

              <div className="cototal">
                <span>Total</span>
                <b>{money(total)}</b>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} /> Solicitar factura (CFDI)
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" onClick={confirm}><Icon name="check" /> Crear pedido</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
