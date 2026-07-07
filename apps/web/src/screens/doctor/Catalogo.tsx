// Catálogo del Portal del Doctor + flujo "armar pedido".
// Catálogo (products_safe) -> agregar al pedido -> revisar -> crear (contra pedido).
// Sin costo/margen (forma products_safe). Todos los productos tienen precio.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useOrders } from '../../data/hooks/useOrders'
import { useStock } from '../../data/hooks/useStock'
import { stockInfoFor, type StockInfo } from '../../data/ops/stock'
import { PaymentModal } from './PaymentModal'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'

type LineFilter = 'all' | 'cosm' | 'prof'
type Cart = Record<string, number>

interface CartLine {
  product: ProductSafe
  qty: number
}

export function Catalogo() {
  const { data: products, loading } = useProducts()
  const { createOrder, payOrder } = useOrders()

  const [filter, setFilter] = useState<LineFilter>('all')
  const [cart, setCart] = useState<Cart>({})
  const [checkout, setCheckout] = useState(false)

  const stockMap = useStock()

  const shown = useMemo(
    () => products.filter(isActiveProduct).filter((p) => (filter === 'all' ? true : p.line === filter)),
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

  // No se puede pedir más de lo disponible en inventario. Ni un producto sin
  // precio publicado (price null = "a consultar"): evita un pedido con renglón a $0.
  const add = (id: string) => setCart((c) => {
    const prod = products.find((p) => p.id === id)
    if (!prod || prod.price == null) return c
    const info = stockInfoFor(stockMap, id)
    const max = info.tracked ? info.qty : 0
    const next = (c[id] ?? 0) + 1
    return next > max ? c : { ...c, [id]: next }
  })
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
          {shown.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--ink-3)' }}>
              No hay productos disponibles en este momento.
            </div>
          ) : shown.map((p) => (
            <ProductCard key={p.id} p={p} qty={cart[p.id] ?? 0} stock={stockInfoFor(stockMap, p.id)} onAdd={() => add(p.id)} onDec={() => dec(p.id)} />
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
          onPay={(orderId, r) => payOrder(orderId, { method: r.method, ref: r.id, actor: 'Portal del Doctor' })}
          onDone={clear}
          onClose={() => setCheckout(false)}
        />
      )}
    </div>
  )
}

function StockTag({ stock }: { stock: StockInfo }) {
  if (stock.status === 'ok') return null
  if (stock.status === 'low') return <span className="pill p-warn" style={{ marginLeft: 'auto' }}>Quedan {stock.qty}</span>
  return <span className="pill p-dang" style={{ marginLeft: 'auto' }}>Agotado</span>
}

function ProductCard({ p, qty, stock, onAdd, onDec }: { p: ProductSafe; qty: number; stock: StockInfo; onAdd: () => void; onDec: () => void }) {
  const isProf = p.line === 'prof'
  const sellable = stock.tracked && stock.qty > 0
  const atMax = qty >= stock.qty
  return (
    <div className="pcard">
      <div className={'ptile ' + (isProf ? 'prof' : 'cosm')} style={p.image_url ? { padding: 0, overflow: 'hidden' } : undefined}>
        <span className="pbadge"><span className={'ltag ' + (isProf ? 'prof' : 'cosm')}>{isProf ? 'Professional' : 'Home Care'}</span></span>
        {p.image_url
          ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: sellable ? 1 : 0.55 }} />
          : <Icon name="leaf" />}
      </div>
      <div className="pb">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h5 style={{ margin: 0 }}>{p.name}</h5>
          <StockTag stock={stock} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{p.category}</div>
        <div className="pr">{money(p.price)}</div>
        {!sellable ? (
          <button className="addb" type="button" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            {stock.tracked ? 'Agotado' : 'Sin existencias'}
          </button>
        ) : qty === 0 ? (
          <button className="addb" type="button" onClick={onAdd}>
            <Icon name="plus" /> Agregar
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
            <button className="btn ghost sm" type="button" onClick={onDec}><Icon name="minus" /></button>
            <span className="mono" style={{ fontSize: 15 }}>{qty}</span>
            <button className="btn sm" type="button" onClick={onAdd} disabled={atMax} style={atMax ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}><Icon name="plus" /></button>
          </div>
        )}
        {qty > 0 && atMax && <div style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: 5 }}>Máximo disponible</div>}
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
  lines, total, onConfirm, onPay, onDone, onClose,
}: {
  lines: CartLine[]
  total: number
  onConfirm: (invoice: boolean) => OrderWithItems
  onPay: (orderId: string, r: { method: string; id: string }) => void
  onDone: () => void
  onClose: () => void
}) {
  const [invoice, setInvoice] = useState(false)
  const [order, setOrder] = useState<OrderWithItems | null>(null)
  const [payNow, setPayNow] = useState(false)

  const confirm = () => {
    const created = onConfirm(invoice)
    setOrder(created)
    onDone() // limpia el carrito
  }

  // Paso de pago en línea (al elegir "Pagar ahora").
  if (order && payNow) {
    return (
      <PaymentModal
        folio={order.external_ref ?? order.id}
        amount={order.total ?? total}
        orderId={order.id}
        onPaid={(r) => onPay(order.id, { method: r.method, id: r.id })}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {order ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pedido creado</h3>
              <p>
                Tu pedido <b>{order.external_ref}</b> quedó registrado. Págalo ahora para que
                entre a preparación, o más tarde desde <b>Mis pedidos</b>.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Pagar después</button>
                <button className="btn" type="button" onClick={() => setPayNow(true)}>
                  <Icon name="receipt" /> Pagar ahora
                </button>
              </div>
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
