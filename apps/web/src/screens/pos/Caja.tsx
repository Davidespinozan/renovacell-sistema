// Caja (Punto de Venta): venta en persona. Selecciona productos, arma la venta,
// cobra (efectivo/tarjeta) y completa. Al cobrar: crea orden POS pagada/entregada
// y descuenta inventario por lote (FEFO de Almacén, reutilizada).
import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../app/icons'
import { money, fmtDate } from '../../lib/format'
import { montoEnLetras } from '../../lib/enLetras'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useLots } from '../../data/hooks/useLots'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useRole } from '../../auth/RoleContext'
import { stockByProduct, stockInfoFor } from '../../data/ops/stock'
import { venderPOS } from '../../data/ops/pos'
import type { OrderWithItems } from '../../data/hooks/useOrders'
import type { ProductSafe, Profile } from '../../data/types'

type PayMethod = 'efectivo' | 'tarjeta'
interface Line { product: ProductSafe; qty: number }
interface Client { id: string; name: string }

export function Caja() {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { data: doctors } = useDoctors()
  const { user } = useRole()
  // Solo productos activos y con precio (no se vende lo oculto).
  const sellable = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p)), [products])
  const stockMap = useMemo(() => stockByProduct(lots), [lots])
  const productName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const [buscar, setBuscar] = useState('')
  // Buscador: por nombre, categoría o SKU (útil en un evento con fila; también sirve para
  // teclear/escanear el código y encontrarlo sin scrollear 64 productos).
  const filtered = useMemo(() => {
    const s = buscar.trim().toLowerCase()
    if (!s) return sellable
    return sellable.filter((p) => `${p.name} ${p.category ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(s))
  }, [sellable, buscar])

  const [cart, setCart] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<PayMethod>('efectivo')
  const [client, setClient] = useState<Client | null>(null) // opcional: null = mostrador
  const [pickOpen, setPickOpen] = useState(false)
  const [done, setDone] = useState<OrderWithItems | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const [recibido, setRecibido] = useState('') // efectivo con el que paga el cliente
  const [lastPago, setLastPago] = useState<{ recibido: number; cambio: number } | null>(null) // para el recibo

  const lines: Line[] = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: sellable.find((p) => p.id === id), qty }))
        .filter((l): l is Line => Boolean(l.product)),
    [cart, sellable],
  )
  const total = lines.reduce((s, l) => s + (l.product.price ?? 0) * l.qty, 0)
  const recibidoN = Math.max(0, Number(recibido) || 0)
  const cambio = recibidoN - total
  // En efectivo, no se cobra hasta que el recibido alcance el total (evita cambio negativo).
  const efectivoOk = method !== 'efectivo' || recibido === '' ? true : recibidoN >= total

  // No vender más de lo disponible en inventario.
  const add = (id: string) => setCart((c) => {
    const info = stockInfoFor(stockMap, id)
    const max = info.tracked ? info.qty : 0
    const next = (c[id] ?? 0) + 1
    return next > max ? c : { ...c, [id]: next }
  })
  const dec = (id: string) =>
    setCart((c) => {
      const q = (c[id] ?? 0) - 1
      if (q <= 0) { const { [id]: _d, ...rest } = c; return rest }
      return { ...c, [id]: q }
    })

  const cobrar = async () => {
    if (cobrando) return
    setCobrando(true)
    const res = await venderPOS(
      lines.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: l.product.price ?? 0 })),
      total,
      method,
      { doctorId: client?.id ?? null, seller: user?.email ?? null },
    )
    setCobrando(false)
    if (res.ok && res.order) {
      setLastPago(method === 'efectivo' && recibido !== '' ? { recibido: recibidoN, cambio } : null)
      setDone(res.order)
      setCart({})
      setClient(null)
      setRecibido('')
    } else {
      // La RPC atómica falla ANTES de cobrar si el inventario no alcanza: no hay venta fantasma.
      setErr(res.error ?? 'No se pudo completar la venta. Verifica existencias en Almacén.')
      window.setTimeout(() => setErr(null), 4000)
    }
  }

  return (
    <div className="grid pos-wrap">
      {/* Catálogo POS (solo productos con precio) */}
      <div className="grid" style={{ gap: 16 }}>
        <div className="eyebrow">Punto de Venta · Caja</div>
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar producto por nombre, categoría o SKU…"
          style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff' }}
        />
        {filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Ningún producto coincide con “{buscar}”.</div>
        ) : (
        <div className="posgrid">
          {filtered.map((p) => {
            const qty = cart[p.id] ?? 0
            const stock = stockInfoFor(stockMap, p.id)
            const out = !stock.tracked || stock.qty <= 0
            return (
              <div key={p.id} className="poscard" style={out ? { opacity: 0.55 } : undefined} onClick={() => { if (!out) add(p.id) }}>
                {p.image_url && (
                  <img src={p.image_url} alt="" loading="lazy" className="posthumb" />
                )}
                <h5>{p.name}</h5>
                <div className="lt">{p.category}</div>
                <div className="pr">{money(p.price)}</div>
                {out ? <span className="pill p-dang" style={{ marginTop: 6 }}>Agotado</span>
                  : stock.status === 'low' ? <span className="pill p-warn" style={{ marginTop: 6 }}>Quedan {stock.qty}</span> : null}
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
        )}
      </div>

      {/* Ticket */}
      <div className="card ticket" style={{ position: 'sticky', top: 90 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <Icon name="store" style={{ width: 18, height: 18, color: 'var(--green-deep)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Venta</h3>
          {lines.length > 0 && <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setCart({})}>Vaciar</button>}
        </div>

        {/* Cliente OPCIONAL: por defecto mostrador; no obliga a entrar por un cliente */}
        <button type="button" onClick={() => setPickOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10 }}>
          <Icon name="usercheck" style={{ width: 15, height: 15, color: client ? 'var(--green-deep)' : 'var(--ink-3)' }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700 }}>Cliente</span>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client ? client.name : 'Mostrador · público general'}</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--brand, #007311)', fontWeight: 600, flex: 'none' }}>{client ? 'Cambiar' : 'Elegir'}</span>
        </button>

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

            {method === 'efectivo' && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)', minWidth: 56 }}>Recibí</span>
                  <input type="number" min={0} value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="¿con cuánto paga? (opcional)"
                    style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 15, outline: 'none', background: '#fff' }} />
                </div>
                {recibido !== '' && (
                  <div className="tket-total" style={{ marginTop: 8, color: cambio < 0 ? 'var(--danger)' : 'var(--green-deep)' }}>
                    <span>{cambio < 0 ? 'Falta' : 'Cambio'}</span><b>{money(Math.abs(cambio))}</b>
                  </div>
                )}
              </div>
            )}

            <button className="btn" type="button" style={{ width: '100%', marginTop: 14, ...(cobrando || !efectivoOk ? { opacity: 0.6, cursor: cobrando ? 'wait' : 'not-allowed' } : {}) }} onClick={cobrar} disabled={cobrando || !efectivoOk}>
              <Icon name="check" /> {cobrando ? 'Cobrando…' : `Cobrar ${money(total)}`}
            </button>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>Pago inmediato · descuenta del inventario de Almacén por lote (FEFO). Para vender lo que traes en consignación, usa Clientes → Venta directa.</div>
          </>
        )}

        {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><Icon name="x" /><span>{err}</span></div>}
      </div>

      {pickOpen && (
        <ClientPicker
          doctors={doctors}
          onPick={(c) => { setClient(c); setPickOpen(false) }}
          onClose={() => setPickOpen(false)}
        />
      )}

      {done && (
        <div className="overlay" onClick={() => setDone(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mbody">
              <div className="success">
                <div className="ck"><Icon name="check" /></div>
                <h3>Venta registrada</h3>
                <p>
                  <b>{done.external_ref}</b> · {money(done.total)} · {done.payment_method === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}
                  {' · '}{done.doctor_id ? (doctors.find((d) => d.id === done.doctor_id)?.full_name ?? 'Cliente') : 'Mostrador'}.
                  Inventario descontado por lote. Ya suma en el Tablero.
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn ghost" type="button" onClick={imprimirVenta}><Icon name="download" /> Imprimir recibo</button>
                  <button className="btn" type="button" onClick={() => setDone(null)}>Nueva venta</button>
                </div>
              </div>
            </div>
          </div>
          <VentaTicketPrint order={done} productName={productName} pago={lastPago} clientName={done.doctor_id ? (doctors.find((d) => d.id === done.doctor_id)?.full_name ?? 'Cliente') : 'Mostrador · público general'} />
        </div>
      )}
    </div>
  )
}

// Imprime SOLO el recibo (marca el body, imprime, limpia la clase en afterprint).
function imprimirVenta() {
  document.body.classList.add('printing-venta')
  const cleanup = () => { document.body.classList.remove('printing-venta'); window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

// Recibo de venta para el cliente (comprobante interno, NO es CFDI).
function VentaTicketView({ order, productName, clientName, pago }: { order: OrderWithItems; productName: Record<string, string>; clientName: string; pago?: { recibido: number; cambio: number } | null }) {
  const items = order.items.filter((it) => it.unit_price != null)
  return (
    <div className="corte-ticket">
      <div className="ct-head">
        <div className="ct-brand">RENOVACELL</div>
        <div className="ct-sub">Comprobante de venta</div>
      </div>
      <div className="ct-row"><span className="k">Folio</span><span className="v">{order.external_ref}</span></div>
      <div className="ct-row"><span className="k">Fecha</span><span className="v">{fmtDate(order.created_at)}</span></div>
      <div className="ct-row"><span className="k">Cliente</span><span className="v">{clientName}</span></div>
      <div className="ct-sep" />
      {items.map((it) => (
        <div key={it.id} className="ct-item">
          <span className="n">{productName[it.product_id ?? ''] ?? 'Producto'} <small>× {it.qty}</small></span>
          <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
        </div>
      ))}
      <div className="ct-sep" />
      <div className="ct-dif"><span>Total</span><span>{money(order.total)}</span></div>
      <div className="ct-letra">Son: {montoEnLetras(order.total ?? 0)}</div>
      <div className="ct-row" style={{ marginTop: 6 }}><span className="k">Pago</span><span className="v">{order.payment_method === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}</span></div>
      {pago && (<>
        <div className="ct-row"><span className="k">Recibí</span><span className="v">{money(pago.recibido)}</span></div>
        <div className="ct-row"><span className="k">Cambio</span><span className="v">{money(pago.cambio)}</span></div>
      </>)}
      <div className="ct-foot">No es un comprobante fiscal (CFDI){order.invoice_requested ? ' · CFDI solicitado aparte' : ''}</div>
    </div>
  )
}
function VentaTicketPrint(props: { order: OrderWithItems; productName: Record<string, string>; clientName: string; pago?: { recibido: number; cambio: number } | null }) {
  return createPortal(<div className="venta-print-root"><VentaTicketView {...props} /></div>, document.body)
}

// Selector de cliente para la Caja: buscar un doctor verificado, o dejar Mostrador.
function ClientPicker({ doctors, onPick, onClose }: {
  doctors: Profile[]
  onPick: (c: Client | null) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = doctors
    .filter((d) => d.verified)
    .filter((d) => (d.full_name ?? '').toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Cliente de la venta</h3><div className="ms">Opcional. Si es venta de mostrador, deja “Mostrador”.</div></div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar doctor por nombre…"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', marginBottom: 10 }} />
          <button type="button" onClick={() => onPick(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 12px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 6, fontWeight: 600 }}>
            <Icon name="store" style={{ width: 15, height: 15, color: 'var(--ink-3)' }} /> Mostrador · público general
          </button>
          <div style={{ display: 'grid', gap: 4, maxHeight: '44vh', overflow: 'auto' }}>
            {list.map((d) => (
              <button key={d.id} type="button" onClick={() => onPick({ id: d.id, name: d.full_name ?? 'Doctor' })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="usercheck" style={{ width: 15, height: 15, color: 'var(--green-deep)' }} /> {d.full_name ?? 'Doctor'}
              </button>
            ))}
            {list.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>Sin doctores verificados que coincidan.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
