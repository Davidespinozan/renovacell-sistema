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
import { DeliveryLocationPicker, type DeliveryChoice } from '../../app/DeliveryLocationPicker'
import { AddressPicker } from '../../app/AddressPicker'
import { clientOf } from '../../data/mock/profiles'
import type { ShippingAddress } from '../../data/ops/shippingAddress'

// Levantar pedido "a nombre de" un DOCTOR (portal/legacy) o un CUSTOMER comercial (sin Auth).
// Exactamente uno de doctor|customer. Customer-only ⇒ doctor_id NULL + customer_id + snapshot.
export function NuevoPedido({ doctor, customer, placedBy, onClose }: {
  doctor?: { id: string; name: string }
  customer?: { id: string; name: string; phone?: string | null }
  placedBy: string
  onClose: () => void
}) {
  const isCustomer = !!customer
  const target = customer ?? doctor!
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { createOrder } = useOrders()
  const stockMap = useMemo(() => stockByProduct(lots), [lots])
  const sellable = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p) && p.sellable !== false), [products])

  // Domicilio base SOLO aplica al flujo doctor (perfil legacy). Customer captura dirección one-off.
  const ci = !isCustomer && doctor ? clientOf(doctor.id) : null
  const baseAddr: ShippingAddress | null = ci && ci.address && ci.address !== '—'
    ? { line1: ci.address, city: ci.city !== '—' ? ci.city : '', phone: ci.phone }
    : null

  const [cart, setCart] = useState<Record<string, number>>({})
  const [invoice, setInvoice] = useState(false)
  const [choice, setChoice] = useState<DeliveryChoice | null>(null)   // flujo doctor
  const [custAddr, setCustAddr] = useState<ShippingAddress | null>(null) // flujo customer (one-off)
  const [folio, setFolio] = useState<string | null>(null)
  const shipping = isCustomer ? custAddr : (choice?.address ?? null)

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
    if (lines.length === 0 || !shipping) return
    const order = createOrder({
      lines: lines.map((l) => ({ product_id: l.p!.id, qty: l.qty, unit_price: l.p!.price })),
      total,
      invoice_requested: invoice,
      placedBy,
      shipping,
      ...(isCustomer
        ? { customer_id: customer!.id, customer: { name: customer!.name, phone: customer!.phone ?? null } }
        : { doctor_id: doctor!.id, location_id: choice?.locationId ?? null }),
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
              <p>El pedido <b>{folio}</b> para <b>{target.name}</b> quedó como <b>contra pedido</b> y ya aparece en Almacén → Preparar pedidos.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div><h3>Levantar pedido</h3><div className="ms">A nombre de {target.name}{isCustomer ? ' · cliente comercial' : ''}</div></div>
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

              <div className="eyebrow" style={{ marginTop: 14 }}>Dirección de entrega</div>
              {isCustomer
                ? <AddressPicker base={null} value={custAddr} onChange={setCustAddr} />
                : <DeliveryLocationPicker doctorId={doctor!.id} legacyBase={baseAddr} allowManage={false} onChange={setChoice} />}

              <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} /> Solicitar factura (CFDI)
              </label>
              {isCustomer && invoice && (
                <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 6 }}>
                  Este cliente comercial no tiene datos fiscales en el portal; el timbrado CFDI se bloqueará hasta capturarlos.
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" disabled={lines.length === 0 || !shipping} style={(lines.length === 0 || !shipping) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={crear}>Crear pedido</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
