// COMPRAS / REABASTECIMIENTO (Logística + Dirección). Stock por producto con
// sugerencia de reorden cuando está bajo, y órdenes de compra a proveedor.
// El alta de inventario al recibir se hace en Almacén → Entradas (lote+caducidad).
import React, { useMemo, useState } from 'react'
import { ShoppingCart, PackageCheck, AlertTriangle, X } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useCompras, type PurchaseOrder } from '../../data/hooks/useCompras'

const LOW = 20      // umbral de stock bajo
const TARGET = 60   // stock objetivo tras reorden

export function Reabastecimiento() {
  const { data: lots, addEntry } = useLots()
  const { data: products } = useProducts()
  const { data: pos, createPurchase, markReceived } = useCompras()
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)

  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>()
    lots.forEach((l) => m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.quantity))
    return m
  }, [lots])

  // Sugerencias: productos con stock <= umbral (con lotes registrados).
  const sugerencias = useMemo(
    () => products
      .map((p) => ({ p, stock: stockByProduct.get(p.id) ?? 0, hasLots: stockByProduct.has(p.id) }))
      .filter((x) => (x.hasLots || x.p.price != null) && x.stock <= LOW)
      .sort((a, b) => a.stock - b.stock),
    [products, stockByProduct],
  )

  const pendientePO = (productId: string) => pos.some((o) => o.product_id === productId && o.status === 'solicitada')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Logística · Compras y reabastecimiento</div>

      {/* Sugerencias de reorden */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: 'var(--warn)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>Sugerencias de reorden (stock ≤ {LOW} u)</div>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Sugerido</th><th></th></tr></thead>
            <tbody>
              {sugerencias.map(({ p, stock }) => {
                const sugerido = Math.max(TARGET - stock, 10)
                const agotado = stock <= 0
                return (
                  <tr key={p.id}>
                    <td data-label="Producto">{p.name}</td>
                    <td data-label="Stock" className="mono">{stock} u</td>
                    <td data-label="Estado"><span className={'pill ' + (agotado ? 'p-dang' : 'p-warn')}>{agotado ? 'Agotado' : 'Bajo'}</span></td>
                    <td data-label="Sugerido" className="mono">+{sugerido} u</td>
                    <td data-label="">
                      {pendientePO(p.id)
                        ? <span className="pill p-blue">Ya solicitada</span>
                        : <button className="btn sm" type="button" onClick={() => createPurchase({ product_id: p.id, product_name: p.name, qty: sugerido })}><ShoppingCart size={14} /> Solicitar compra</button>}
                    </td>
                  </tr>
                )
              })}
              {sugerencias.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Stock saludable · sin reorden sugerido. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Órdenes de compra */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px' }}><div className="eyebrow" style={{ margin: 0 }}>Órdenes de compra</div></div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pos.map((o) => (
                <tr key={o.id}>
                  <td data-label="Producto">{o.product_name}</td>
                  <td data-label="Cantidad" className="mono">{o.qty} u</td>
                  <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                  <td data-label="Estado"><span className={'pill ' + (o.status === 'recibida' ? 'p-ok' : 'p-warn')}>{o.status === 'recibida' ? 'Recibida' : 'Solicitada'}</span></td>
                  <td data-label="">
                    {o.status === 'solicitada'
                      ? <button className="btn ghost sm" type="button" onClick={() => setReceiving(o)}><PackageCheck size={14} /> Recibir y dar de alta</button>
                      : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Lote dado de alta</span>}
                  </td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Aún no hay órdenes de compra.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {receiving && (
        <RecibirModal
          po={receiving}
          onClose={() => setReceiving(null)}
          onConfirm={(input) => {
            addEntry({ product_id: receiving.product_id, lot_code: input.lot_code, expiry_date: input.expiry_date, quantity: input.quantity, location: null })
            markReceived(receiving.id)
            setReceiving(null)
          }}
        />
      )}
    </div>
  )
}

function RecibirModal({ po, onClose, onConfirm }: {
  po: PurchaseOrder
  onClose: () => void
  onConfirm: (input: { lot_code: string; expiry_date: string | null; quantity: number }) => void
}) {
  const [lotCode, setLotCode] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty, setQty] = useState(String(po.qty))
  const n = Math.max(0, parseInt(qty, 10) || 0)
  const valid = lotCode.trim() !== '' && n > 0

  const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none' }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>Recibir compra</h3>
            <div className="ms">{po.product_name} · {po.qty} u solicitadas</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="grid" style={{ gap: 12 }}>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Código de lote</span>
              <input style={fld} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="p. ej. LT-2026-014" autoFocus />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Caducidad</span>
              <input type="date" style={fld} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Cantidad recibida</span>
              <input type="number" min={1} style={fld} value={qty} onChange={(e) => setQty(e.target.value)} />
            </label>
            <button className="btn" type="button" disabled={!valid} onClick={() => onConfirm({ lot_code: lotCode.trim(), expiry_date: expiry || null, quantity: n })}>
              <PackageCheck size={15} /> Dar de alta lote
            </button>
            <div className="sysnote">
              <span>Se crea el lote con su caducidad y queda registrado el movimiento de entrada (trazabilidad).</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
