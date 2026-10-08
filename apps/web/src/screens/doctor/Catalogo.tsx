// Catálogo del Portal del Doctor + flujo "armar pedido".
// Catálogo (products_safe) -> agregar al pedido -> revisar -> crear (contra pedido).
// CC-7 · Con backend, el carrito de esta pantalla ES el carrito canónico del servidor (el mismo del
// Chat): cada +/− es un comando idempotente, el primer artículo dispara el handoff comercial en el
// servidor y la compra se confirma con revisión + confirmación canónicas (CC-6). Sin backend (demo)
// se conserva el carrito local.
// Sin costo/margen (forma products_safe). Todos los productos tienen precio.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct, isPortalProduct } from '../../data/hooks/useProducts'
import { catalogEntries, isSellableVariant, type CatalogEntry } from '../../data/ops/productVariants'
import { useOrders } from '../../data/hooks/useOrders'
import { usePricing } from '../../data/hooks/usePricing'
import { useVolumePrices } from '../../data/hooks/useVolumePrices'
import { effectiveUnitPrice, volumePromoLabel, volumeSavings } from '../../data/ops/volumePricing'
import { useStock } from '../../data/hooks/useStock'
import { stockInfoFor, type StockInfo } from '../../data/ops/stock'
import { takeReorderSeed } from '../../data/store/reorderStore'
import { clientOf } from '../../data/mock/profiles'
import { DOCTOR_ID } from '../../data/mock/orders'
import { hasSupabase, currentUserId } from '../../lib/supabase'
import type { ShippingAddress } from '../../data/ops/shippingAddress'
import type { ProductSafe } from '../../data/types'
import type { PedidoCreado } from '../../data/store/ordersStore'
import { reloadOrders } from '../../data/store/ordersStore'
import { useCarritoCanonico } from '../../data/hooks/useCarritoCanonico'
import { CheckoutCanonico, type MotorLocal } from '../checkout/CheckoutCanonico'
import type { ConfigServidor, ResultadoPedido } from '../checkout/checkoutMotor'


type LineFilter = 'all' | 'cosm' | 'prof'
type Cart = Record<string, number>

interface CartLine {
  product: ProductSafe
  qty: number
}

export function Catalogo() {
  const { data: products, loading } = useProducts()
  const { createOrder, payOrder } = useOrders()
  const { priceFor } = usePricing()
  const { data: volRules } = useVolumePrices()
  // Precio de LISTA del doctor (su tarifa/base). El descuento por VOLUMEN se previsualiza
  // aparte con `effOf(qty)`; el servidor (precio_de) es la autoridad del cobro final.
  const priceOf = (p: ProductSafe): number | null => priceFor(p.id, p.price)
  // Precio unitario EFECTIVO previsto para una cantidad = LEAST(lista, volumen aplicable).
  const effOf = (p: ProductSafe, qty: number): number | null => effectiveUnitPrice(priceOf(p), volRules, p.id, qty)

  const [filter, setFilter] = useState<LineFilter>('all')
  const canon = useCarritoCanonico(hasSupabase)            // CC-7 · carrito canónico (servidor)
  const [cartLocal, setCartLocal] = useState<Cart>({})      // solo modo demo (sin backend)
  const cart: Cart = hasSupabase ? canon.qty : cartLocal
  const setQty = (id: string, n: number) => {
    if (hasSupabase) { void canon.fijar(id, n); return }
    setCartLocal((c) => { if (n <= 0) { const { [id]: _d, ...rest } = c; return rest } return { ...c, [id]: n } })
  }
  const [checkout, setCheckout] = useState(false)
  const [reorderNote, setReorderNote] = useState<string | null>(null)

  const stockMap = useStock()

  // "Volver a pedir": si venimos de Historial/Mis pedidos con una siembra, rearmar
  // el carrito una sola vez —cuando ya cargó el catálogo—, capando cada renglón al
  // stock disponible y descartando productos dados de baja o sin precio publicado.
  const seedRef = useRef(takeReorderSeed())
  useEffect(() => {
    const seed = seedRef.current
    if (!seed || products.length === 0 || (hasSupabase && !canon.listo)) return
    seedRef.current = null
    const next: Cart = {}
    let dropped = 0
    let capped = 0
    seed.forEach(({ product_id, qty }) => {
      const prod = products.find((p) => p.id === product_id)
      if (!prod || !isActiveProduct(prod) || prod.price == null) { dropped += 1; return }
      const info = stockInfoFor(stockMap, product_id)
      const max = info.tracked ? info.qty : 0
      const q = Math.min(qty, max)
      if (q <= 0) { dropped += 1; return }
      if (q < qty) capped += 1
      next[product_id] = q
    })
    if (Object.keys(next).length > 0) {
      // Rearmar = reemplazar el carrito (canónico: vaciar y fijar cada renglón, serializado).
      if (hasSupabase) void (async () => { await canon.vaciar(); for (const [pid, q] of Object.entries(next)) await canon.fijar(pid, q) })()
      else setCartLocal(next)
    }
    if (dropped > 0 || capped > 0) {
      const parts: string[] = []
      if (dropped > 0) parts.push(`${dropped} producto(s) ya no están disponibles`)
      if (capped > 0) parts.push(`${capped} se ajustaron al stock actual`)
      setReorderNote(`Rearmamos tu pedido anterior · ${parts.join(' y ')}.`)
    } else if (Object.keys(next).length > 0) {
      setReorderNote('Rearmamos tu pedido anterior. Revísalo y confírmalo.')
    }
  }, [products, stockMap, canon.listo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Agrupa producto→variantes: una tarjeta por familia (padre con hijas) + productos standalone.
  // Las variantes NUNCA se listan sueltas; se eligen dentro del modal de la familia.
  const entries = useMemo(
    () => catalogEntries(
      products,
      (p) => isPortalProduct(p) && (filter === 'all' ? true : p.line === filter),
      (v) => isPortalProduct(v), // variantes visibles (incl. sin precio → "No disponible")
    ),
    [products, filter],
  )
  const [openFamily, setOpenFamily] = useState<ProductSafe | null>(null)

  const lines: CartLine[] = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
        .filter((l): l is CartLine => Boolean(l.product)),
    [cart, products],
  )

  // Total con descuento por volumen previsualizado (el servidor recalcula al crear el pedido).
  const total = lines.reduce((sum, l) => sum + (effOf(l.product, l.qty) ?? 0) * l.qty, 0)
  const savings = lines.reduce((sum, l) => sum + volumeSavings(priceOf(l.product), volRules, l.product.id, l.qty), 0)

  // No se puede pedir más de lo disponible en inventario. Ni un producto sin
  // precio publicado (price null = "a consultar"): evita un pedido con renglón a $0.
  const add = (id: string) => {
    const prod = products.find((p) => p.id === id)
    if (!prod || priceOf(prod) == null) return
    const info = stockInfoFor(stockMap, id)
    const max = info.tracked ? info.qty : 0
    const next = (cart[id] ?? 0) + 1
    if (next > max) return
    setQty(id, next)
  }
  const dec = (id: string) => setQty(id, (cart[id] ?? 0) - 1)
  const clear = () => { if (hasSupabase) void canon.vaciar(); else setCartLocal({}) }

  // Domicilio base del doctor (si lo tiene registrado). Si no, el checkout pide la
  // dirección de entrega — el pedido siempre viaja con una dirección.
  const myId = hasSupabase ? currentUserId() : DOCTOR_ID
  const ci = clientOf(myId)
  const baseAddr: ShippingAddress | null = ci.address && ci.address !== '—'
    ? { line1: ci.address, city: ci.city !== '—' ? ci.city : '', phone: ci.phone }
    : null

  // MC-1 · el checkout es el CANÓNICO compartido (screens/checkout): revisión del servidor (importes, precio por
  // volumen, disponibilidad, dirección) → confirmación idempotente → pedido W1 en la misma transacción que
  // convierte el carrito. Con factura, el receptor es el PERFIL FISCAL elegido (lo valida y congela el servidor).
  const servidor: ConfigServidor | null = hasSupabase ? {
    obtenerCartId: async () => { await canon.esperar(); return canon.cart?.cart_id ?? null },
    nombreDe: (id: string) => products.find((p) => p.id === id)?.name ?? 'producto',
    onPedido: () => { void canon.recargar(); reloadOrders() },
  } : null
  // Solo modo demo (sin backend): pedido local con el precio efectivo previsto (volumen incluido).
  const local: MotorLocal = {
    lineas: lines.map((l) => { const u = effOf(l.product, l.qty); return { product_id: l.product.id, nombre: l.product.name, qty: l.qty, unitario: u, subtotal: u == null ? null : u * l.qty } }),
    total,
    confirmar: (invoice, choice, receiver) => createOrder({
      lines: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: effOf(l.product, l.qty) })),
      total,
      invoice_requested: invoice,
      shipping: choice.address ?? null,
      location_id: choice.locationId ?? null,
      receiver: invoice ? receiver : null,
    }).then((r: PedidoCreado): ResultadoPedido => (r.ok ? { ok: true, order: r.order } : { ok: false, error: r.error })),
  }

  if (loading) return <div className="card">Cargando catálogo…</div>

  return (
    <div className="grid pos-wrap">
      {/* IZQUIERDA: catálogo */}
      <div className="grid" style={{ gap: 16 }}>
        <div className="eyebrow">Portal del Doctor · Catálogo</div>
        {reorderNote && (
          <div className="sysnote" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="cart" />
            <span style={{ flex: 1 }}>{reorderNote}</span>
            <button className="mclose" type="button" aria-label="Cerrar" onClick={() => setReorderNote(null)}><Icon name="x" /></button>
          </div>
        )}
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {([['all', 'Todos'], ['cosm', 'Home Care'], ['prof', 'Professional']] as const).map(([k, lbl]) => (
            <button key={k} type="button" className={filter === k ? 'active' : undefined} onClick={() => setFilter(k)}>
              {lbl}
            </button>
          ))}
        </div>

        <div className="pgrid">
          {entries.length === 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--ink-3)' }}>
              No hay productos disponibles en este momento.
            </div>
          ) : entries.map((e) => e.kind === 'family' ? (
            <FamilyCard key={e.product.id} entry={e} cart={cart} onOpen={() => setOpenFamily(e.product)} />
          ) : (
            <ProductCard key={e.product.id} p={e.product} price={priceOf(e.product)} qty={cart[e.product.id] ?? 0} stock={stockInfoFor(stockMap, e.product.id)} promo={volumePromoLabel(priceOf(e.product), volRules, e.product.id)} effPrice={effOf(e.product, cart[e.product.id] ?? 0)} onAdd={() => add(e.product.id)} onDec={() => dec(e.product.id)} />
          ))}
        </div>
      </div>

      {openFamily && (
        <VariantModal
          parent={openFamily}
          variants={products.filter((v) => v.parent_product_id === openFamily.id && isPortalProduct(v))}
          cart={cart} priceOf={priceOf} stockMap={stockMap}
          onAdd={add} onDec={dec} onClose={() => setOpenFamily(null)}
        />
      )}

      {/* DERECHA: pedido en curso */}
      {hasSupabase && canon.error && <div role="alert" className="sysnote" style={{ gridColumn: '1 / -1' }}>{canon.error}</div>}
      <CartPanel lines={lines} total={total} savings={savings} priceOf={priceOf} onInc={add} onDec={dec} onClear={clear} onReview={() => setCheckout(true)} />

      {checkout && (
        <CheckoutCanonico
          base={baseAddr}
          servidor={servidor}
          local={local}
          previas={lines.map((l) => ({ product_id: l.product.id, nombre: l.product.name, qty: l.qty }))}
          onPay={(orderId, r) => payOrder(orderId, { method: r.method, ref: r.id, actor: 'Portal del Doctor' })}
          onDone={hasSupabase ? undefined : clear}   // canónico: el servidor ya convirtió el carrito (onPedido recarga)
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

function ProductCard({ p, price, qty, stock, promo, effPrice, onAdd, onDec }: { p: ProductSafe; price: number | null; qty: number; stock: StockInfo; promo?: string | null; effPrice?: number | null; onAdd: () => void; onDec: () => void }) {
  const isProf = p.line === 'prof'
  const sellable = stock.tracked && stock.qty > 0
  const atMax = qty >= stock.qty
  const discounted = effPrice != null && price != null && effPrice < price // volumen aplicado a esta cantidad
  return (
    <div className="pcard">
      <div className={'ptile ' + (isProf ? 'prof' : 'cosm')} style={p.image_url ? { padding: 0, overflow: 'hidden' } : undefined}>
        <span className="pbadge"><span className={'ltag ' + (isProf ? 'prof' : 'cosm')}>{isProf ? 'Professional' : 'Home Care'}</span></span>
        {p.image_url
          ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', padding: 10, opacity: sellable ? 1 : 0.55 }} />
          : <Icon name="leaf" />}
      </div>
      <div className="pb">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h5 style={{ margin: 0 }}>{p.name}</h5>
          <StockTag stock={stock} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>{p.category}</div>
        <div className="pr">
          {discounted ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
              <span>{money(effPrice)}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'line-through' }}>{money(price)}</span>
            </span>
          ) : money(price)}
        </div>
        {promo && !discounted && <div style={{ fontSize: 11.5, color: 'var(--green-deep)', fontWeight: 600, marginTop: 2 }}>{promo}</div>}
        {discounted && <div style={{ fontSize: 11.5, color: 'var(--green-deep)', fontWeight: 600, marginTop: 2 }}>Precio por volumen aplicado</div>}
        {price == null ? (
          // Precio "a consultar": antes mostraba un "Agregar" habilitado que no hacía
          // nada (add() sale temprano). Ahora es un estado claro y no engañoso.
          <button className="addb" type="button" disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} title="Este producto se cotiza aparte">
            Precio a consultar
          </button>
        ) : !sellable ? (
          <button className="addb" type="button" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            {stock.tracked ? 'Agotado' : 'No disponible'}
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

// Tarjeta de FAMILIA: una sola imagen (del padre) + resumen de variantes. Abre el selector.
function FamilyCard({ entry, cart, onOpen }: { entry: CatalogEntry; cart: Cart; onOpen: () => void }) {
  const p = entry.product
  const disponibles = entry.variants.filter(isSellableVariant).length
  const enCarrito = entry.variants.reduce((s, v) => s + (cart[v.id] ?? 0), 0)
  const isProf = p.line === 'prof'
  return (
    <div className="pcard">
      <div className={'ptile ' + (isProf ? 'prof' : 'cosm')} style={p.image_url ? { padding: 0, overflow: 'hidden' } : undefined}>
        <span className="pbadge"><span className={'ltag ' + (isProf ? 'prof' : 'cosm')}>{isProf ? 'Professional' : 'Home Care'}</span></span>
        {p.image_url
          ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', padding: 10 }} />
          : <Icon name="leaf" />}
      </div>
      <div className="pb">
        <h5 style={{ margin: 0 }}>{p.name}</h5>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>
          {entry.variants.length} variante(s){disponibles !== entry.variants.length ? ` · ${disponibles} con precio` : ''}
        </div>
        <div className="pr" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Varias presentaciones</div>
        <button className="addb" type="button" onClick={onOpen}>
          <Icon name="grid" /> Ver variantes{enCarrito > 0 ? ` (${enCarrito})` : ''}
        </button>
      </div>
    </div>
  )
}

// Selector de variantes de una familia. Al agregar, SIEMPRE usa el id de la VARIANTE.
function VariantModal({ parent, variants, cart, priceOf, stockMap, onAdd, onDec, onClose }: {
  parent: ProductSafe
  variants: ProductSafe[]
  cart: Cart
  priceOf: (p: ProductSafe) => number | null
  stockMap: ReturnType<typeof useStock>
  onAdd: (id: string) => void
  onDec: (id: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const shown = q.trim() ? variants.filter((v) => v.name.toLowerCase().includes(q.trim().toLowerCase())) : variants
  // Etiqueta de la variante: el nombre sin el prefijo del padre cuando aplica.
  const variantLabel = (v: ProductSafe) => {
    const n = v.name.trim()
    const pre = parent.name.trim()
    return n.toLowerCase().startsWith(pre.toLowerCase()) && n.length > pre.length ? n.slice(pre.length).trim() : n
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {parent.image_url && <img src={parent.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'contain', background: '#fff', border: '1px solid var(--line)' }} />}
            <div><h3 style={{ margin: 0 }}>{parent.name}</h3><div className="ms">{variants.length} variante(s) · elige presentación</div></div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          {variants.length > 8 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar variante…"
              style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', marginBottom: 10 }} />
          )}
          <div style={{ display: 'grid', gap: 8, maxHeight: '52vh', overflow: 'auto' }}>
            {shown.map((v) => {
              const price = priceOf(v)
              const stock = stockInfoFor(stockMap, v.id)
              const disponible = isSellableVariant(v) && price != null
              const qty = cart[v.id] ?? 0
              const atMax = stock.tracked && qty >= stock.qty
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11, opacity: disponible ? 1 : 0.6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{variantLabel(v)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{disponible ? money(price) : 'No disponible'}</div>
                  </div>
                  {!disponible ? (
                    <span className="pill p-neu" style={{ whiteSpace: 'nowrap' }}>No disponible</span>
                  ) : qty === 0 ? (
                    <button className="btn sm" type="button" disabled={stock.tracked && stock.qty <= 0} onClick={() => onAdd(v.id)}><Icon name="plus" /> Agregar</button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button className="btn ghost sm" type="button" onClick={() => onDec(v.id)}><Icon name="minus" /></button>
                      <span className="mono" style={{ minWidth: 18, textAlign: 'center' }}>{qty}</span>
                      <button className="btn sm" type="button" disabled={atMax} style={atMax ? { opacity: 0.4, cursor: 'not-allowed' } : undefined} onClick={() => onAdd(v.id)}><Icon name="plus" /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" type="button" onClick={onClose}>Listo</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CartPanel({
  lines, total, savings = 0, priceOf, onInc, onDec, onClear, onReview,
}: {
  lines: CartLine[]
  total: number
  savings?: number
  priceOf: (p: ProductSafe) => number | null
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
        <LineRow key={l.product.id} l={l} price={priceOf(l.product)} onInc={() => onInc(l.product.id)} onDec={() => onDec(l.product.id)} />
      ))}

      {!empty && (
        <>
          {savings > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12.5, color: 'var(--green-deep)', fontWeight: 600 }}>
              <span>Ahorro por volumen</span><span>−{money(savings)}</span>
            </div>
          )}
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

function LineRow({ l, price, onInc, onDec }: { l: CartLine; price: number | null; onInc: () => void; onDec: () => void }) {
  return (
    <div className="titem">
      <div>
        <div>{l.product.name}</div>
        <div className="tl">{money(price)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn ghost sm" type="button" onClick={onDec}><Icon name="minus" /></button>
        <span className="mono">{l.qty}</span>
        <button className="btn ghost sm" type="button" onClick={onInc}><Icon name="plus" /></button>
      </div>
    </div>
  )
}
