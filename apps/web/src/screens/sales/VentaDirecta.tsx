// VENTA DIRECTA del vendedor: vende a un cliente desde SU consignación (lo que
// trae consigo), pago y entrega en el acto. Descuenta de su saldo, no del central.
import React, { useMemo, useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { money } from '../../lib/format'
import { useProducts } from '../../data/hooks/useProducts'
import { useConsigna, remaining } from '../../data/hooks/useConsigna'

export function VentaDirecta({ doctor, vendor, onClose }: {
  doctor: { id: string; name: string }
  vendor: string
  onClose: () => void
}) {
  const { data: products } = useProducts()
  const { data: consigna, sellFromConsigna } = useConsigna()
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products])
  const balance = (consigna[vendor] ?? []).filter((it) => remaining(it) > 0)

  const [cart, setCart] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<'efectivo' | 'tarjeta'>('efectivo')
  const [done, setDone] = useState<string | null>(null)

  const rem = (id: string) => { const it = balance.find((x) => x.product_id === id); return it ? remaining(it) : 0 }
  const add = (id: string) => setCart((c) => ({ ...c, [id]: Math.min((c[id] ?? 0) + 1, rem(id)) }))
  const dec = (id: string) => setCart((c) => { const q = (c[id] ?? 0) - 1; if (q <= 0) { const { [id]: _d, ...r } = c; return r } return { ...c, [id]: q } })

  const lines = Object.entries(cart).map(([id, qty]) => ({ id, qty, p: byId[id] })).filter((l) => l.p)
  const total = lines.reduce((s, l) => s + (l.p!.price ?? 0) * l.qty, 0)

  const cobrar = () => {
    if (lines.length === 0) return
    const order = sellFromConsigna(vendor, lines.map((l) => ({ product_id: l.id, qty: l.qty, unit_price: l.p!.price ?? 0 })), total, method, doctor.id)
    if (order) setDone(order.external_ref ?? '—')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Plus size={26} /></div>
              <h3>Venta registrada</h3>
              <p>Vendiste a <b>{doctor.name}</b> desde tu consignación · {money(total)} · {method}. Folio <b>{done}</b>.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div><h3>Venta directa</h3><div className="ms">A {doctor.name} · desde tu consignación</div></div>
              <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
            </div>
            <div className="mbody">
              {balance.length === 0 ? (
                <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
                  <span>No traes producto en consignación. Pídele a Almacén que te asigne inventario, o usa “Levantar pedido” (contra pedido).</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gap: 8, maxHeight: '44vh', overflow: 'auto' }}>
                    {balance.map((it) => {
                      const p = byId[it.product_id]; if (!p) return null
                      const qty = cart[it.product_id] ?? 0
                      return (
                        <div key={it.product_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{money(p.price)} · traes {remaining(it)}</div>
                          </div>
                          {qty > 0 && <button className="btn ghost sm" type="button" onClick={() => dec(it.product_id)}><Minus size={14} /></button>}
                          {qty > 0 && <span className="mono" style={{ minWidth: 18, textAlign: 'center' }}>{qty}</span>}
                          <button className="btn sm" type="button" disabled={qty >= remaining(it)} style={qty >= remaining(it) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => add(it.product_id)}><Plus size={14} /></button>
                        </div>
                      )
                    })}
                  </div>

                  <div className="cototal" style={{ marginTop: 14 }}><span>Total</span><b>{money(total)}</b></div>
                  <div style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700, margin: '12px 0 6px' }}>Pago</div>
                  <div className="seg">
                    <button type="button" className={method === 'efectivo' ? 'active' : undefined} onClick={() => setMethod('efectivo')}>Efectivo</button>
                    <button type="button" className={method === 'tarjeta' ? 'active' : undefined} onClick={() => setMethod('tarjeta')}>Tarjeta</button>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                    <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                    <button className="btn" type="button" disabled={lines.length === 0} style={lines.length === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={cobrar}>Cobrar {money(total)}</button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
