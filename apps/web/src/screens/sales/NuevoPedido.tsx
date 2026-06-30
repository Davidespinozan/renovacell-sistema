// Levantar pedido A NOMBRE de un doctor (Ventas sobre su cartera, o Dirección).
// Crea un pedido contra pedido idéntico a uno del Portal → cae solo en Almacén →
// Preparar pedidos. Respeta el stock (mismo tope que el catálogo del doctor).
import React, { useMemo, useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useLots } from '../../data/hooks/useLots'
import { useOrders } from '../../data/hooks/useOrders'
import { stockByProduct, stockInfoFor } from '../../data/ops/stock'

export function NuevoPedido({ doctor, placedBy, onClose }: {
  doctor: { id: string; name: string }
  placedBy: string
  onClose: () => void
}) {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { createOrder } = useOrders()
  const stockMap = useMemo(() => stockByProduct(lots), [lots])
  const sellable = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p)), [products])

  const [cart, setCart] = useState<Record<string, number>>({})
  const [invoice, setInvoice] = useState(false)
  const [folio, setFolio] = useState<string | null>(null)

  const add = (id: string) => setCart((c) => {
    const info = stockInfoFor(stockMap, id)
    const max = info.tracked ? info.qty : 0
    const next = (c[id] ?? 0) + 1
    return next > max ? c : { ...c, [id]: next }
  })
  const dec = (id: string) => setCart((c) => {
    const q = (c[id] ?? 0) - 1
    if (q <= 0) { const { [id]: _d, ...rest } = c; return rest }
    return { ...c, [id]: q }
  })

  const lines = Object.entries(cart).map(([id, qty]) => ({ p: sellable.find((x) => x.id === id), qty })).filter((l) => l.p)
  const total = lines.reduce((s, l) => s + (l.p!.price ?? 0) * l.qty, 0)

  const crear = () => {
    if (lines.length === 0) return
    const order = createOrder({
      lines: lines.map((l) => ({ product_id: l.p!.id, qty: l.qty, unit_price: l.p!.price })),
      total,
      invoice_requested: invoice,
      doctor_id: doctor.id,
      placedBy,
    })
    setFolio(order.external_ref ?? '—')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {folio ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Plus size={26} /></div>
              <h3>Pedido creado</h3>
              <p>El pedido <b>{folio}</b> para <b>{doctor.name}</b> quedó como <b>contra pedido</b> y ya aparece en Almacén → Preparar pedidos.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div><h3>Levantar pedido</h3><div className="ms">A nombre de {doctor.name}</div></div>
              <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
            </div>
            <div className="mbody">
              <div style={{ display: 'grid', gap: 8, maxHeight: '46vh', overflow: 'auto' }}>
                {sellable.map((p) => {
                  const qty = cart[p.id] ?? 0
                  const stock = stockInfoFor(stockMap, p.id)
                  const out = !stock.tracked || stock.qty <= 0
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11, opacity: out ? 0.55 : 1 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{money(p.price)}{out ? ' · Agotado' : stock.status === 'low' ? ` · Quedan ${stock.qty}` : ''}</div>
                      </div>
                      {qty > 0 && <button className="btn ghost sm" type="button" onClick={() => dec(p.id)}><Minus size={14} /></button>}
                      {qty > 0 && <span className="mono" style={{ minWidth: 18, textAlign: 'center' }}>{qty}</span>}
                      <button className="btn sm" type="button" disabled={out} style={out ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => add(p.id)}><Plus size={14} /></button>
                    </div>
                  )
                })}
              </div>

              <div className="cototal" style={{ marginTop: 14 }}><span>Total</span><b>{money(total)}</b></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} /> Solicitar factura (CFDI)
              </label>

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" disabled={lines.length === 0} style={lines.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={crear}>Crear pedido</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
