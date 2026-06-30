// INVENTARIO / REABASTECIMIENTO. Proceso claro y con responsable:
//  1) El sistema muestra el STOCK BAJO (aquí + campana de Dirección).
//  2) DIRECCIÓN reabastece: Compra a proveedor o Producción interna (mixto).
//  3) ALMACÉN recibe y da de alta el lote (código + caducidad + cantidad).
import React, { useMemo, useState } from 'react'
import { ShoppingCart, PackageCheck, AlertTriangle, X, Factory } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useCompras, type PurchaseOrder, type ReplenKind } from '../../data/hooks/useCompras'
import { stockByProduct } from '../../data/ops/stock'
import type { ProductSafe } from '../../data/types'

const LOW = 20      // umbral de stock bajo (reorden)
const TARGET = 60   // stock objetivo tras reabastecer

export function Reabastecimiento() {
  const { data: lots, addEntry } = useLots()
  const { data: products } = useProducts()
  const { data: pos, createReplenishment, markReceived } = useCompras()
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [replen, setReplen] = useState<{ product: ProductSafe; suggested: number } | null>(null)

  const stock = useMemo(() => stockByProduct(lots), [lots])
  const stockOf = (id: string) => stock[id]?.qty ?? 0

  // Sugerencias: productos con stock ≤ umbral (con lotes o con precio definido).
  const sugerencias = useMemo(
    () => products
      .map((p) => ({ p, qty: stockOf(p.id), tracked: Boolean(stock[p.id]) }))
      .filter((x) => (x.tracked || x.p.price != null) && x.qty <= LOW)
      .sort((a, b) => a.qty - b.qty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, stock],
  )

  const enCurso = (productId: string) => pos.some((o) => o.product_id === productId && o.status === 'pendiente')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Inventario">
        El sistema te avisa cuando hay <b>stock bajo</b> (aquí y en la campana). Tú, Dirección, reabastreces
        con una <b>compra a proveedor</b> o una <b>producción interna</b>. Almacén lo recibe y da de alta el lote.
      </PageHead>

      {/* 1+2) Stock bajo → Dirección reabastece */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: 'var(--warn)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>Hay que reabastecer · stock ≤ {LOW} u</div>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Sugerido</th><th></th></tr></thead>
            <tbody>
              {sugerencias.map(({ p, qty }) => {
                const sugerido = Math.max(TARGET - qty, 10)
                const agotado = qty <= 0
                return (
                  <tr key={p.id}>
                    <td data-label="Producto">{p.name}</td>
                    <td data-label="Stock" className="mono">{qty} u</td>
                    <td data-label="Estado"><span className={'pill ' + (agotado ? 'p-dang' : 'p-warn')}>{agotado ? 'Agotado' : 'Bajo'}</span></td>
                    <td data-label="Sugerido" className="mono">+{sugerido} u</td>
                    <td data-label="">
                      {enCurso(p.id)
                        ? <span className="pill p-blue">En curso</span>
                        : <button className="btn sm" type="button" onClick={() => setReplen({ product: p, suggested: sugerido })}><ShoppingCart size={14} /> Reabastecer</button>}
                    </td>
                  </tr>
                )
              })}
              {sugerencias.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Inventario saludable · nada por reabastecer. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3) Reabastecimientos en curso → Almacén recibe */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px' }}><div className="eyebrow" style={{ margin: 0 }}>Reabastecimientos · Almacén los recibe</div></div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Tipo</th><th>Cantidad</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pos.map((o) => (
                <tr key={o.id}>
                  <td data-label="Producto">{o.product_name}</td>
                  <td data-label="Tipo">
                    <span className={'pill ' + (o.kind === 'compra' ? 'p-blue' : 'p-neu')}>
                      {o.kind === 'compra' ? 'Compra' : 'Producción'}
                    </span>
                    {o.supplier && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{o.supplier}</div>}
                  </td>
                  <td data-label="Cantidad" className="mono">{o.qty} u</td>
                  <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                  <td data-label="Estado"><span className={'pill ' + (o.status === 'recibida' ? 'p-ok' : 'p-warn')}>{o.status === 'recibida' ? 'Recibida' : 'Pendiente'}</span></td>
                  <td data-label="">
                    {o.status === 'pendiente'
                      ? <button className="btn ghost sm" type="button" onClick={() => setReceiving(o)}><PackageCheck size={14} /> Recibir y dar de alta</button>
                      : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Lote dado de alta</span>}
                  </td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>Aún no hay reabastecimientos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {replen && (
        <ReplenishModal
          product={replen.product}
          suggested={replen.suggested}
          onClose={() => setReplen(null)}
          onConfirm={(input) => {
            createReplenishment({ product_id: replen.product.id, product_name: replen.product.name, qty: input.qty, kind: input.kind, supplier: input.supplier })
            setReplen(null)
          }}
        />
      )}

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

const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 6 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

function ReplenishModal({ product, suggested, onClose, onConfirm }: {
  product: ProductSafe
  suggested: number
  onClose: () => void
  onConfirm: (input: { qty: number; kind: ReplenKind; supplier: string | null }) => void
}) {
  const [kind, setKind] = useState<ReplenKind>('compra')
  const [supplier, setSupplier] = useState('')
  const [qty, setQty] = useState(String(suggested))
  const n = Math.max(0, parseInt(qty, 10) || 0)
  const valid = n > 0 && (kind === 'produccion' || supplier.trim() !== '')

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Reabastecer</h3><div className="ms">{product.name}</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...lbl, marginTop: 0 }}>¿Cómo se reabastece?</label>
          <div className="seg" style={{ marginTop: 8 }}>
            <button type="button" className={kind === 'compra' ? 'active' : undefined} onClick={() => setKind('compra')}><ShoppingCart size={14} /> Compra a proveedor</button>
            <button type="button" className={kind === 'produccion' ? 'active' : undefined} onClick={() => setKind('produccion')}><Factory size={14} /> Producción interna</button>
          </div>

          {kind === 'compra' && (
            <>
              <label style={lbl}>Proveedor</label>
              <input style={fld} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nombre del proveedor / fabricante" autoFocus />
            </>
          )}

          <label style={lbl}>Cantidad</label>
          <input style={fld} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />

          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>Queda <b>pendiente de recibir</b>. Almacén lo dará de alta como lote (con caducidad) cuando llegue.</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onConfirm({ qty: n, kind, supplier: supplier.trim() || null })}>
              {kind === 'compra' ? 'Registrar compra' : 'Registrar producción'}
            </button>
          </div>
        </div>
      </div>
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

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>Recibir y dar de alta</h3>
            <div className="ms">{po.product_name} · {po.kind === 'compra' ? `compra${po.supplier ? ` · ${po.supplier}` : ''}` : 'producción'} · {po.qty} u</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...lbl, marginTop: 0 }}>Código de lote</label>
          <input style={fld} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="p. ej. LT-2026-014" autoFocus />
          <label style={lbl}>Caducidad</label>
          <input type="date" style={fld} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          <label style={lbl}>Cantidad recibida</label>
          <input type="number" min={1} style={fld} value={qty} onChange={(e) => setQty(e.target.value)} />

          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>Se crea el lote con su caducidad y queda el movimiento de entrada (trazabilidad).</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onConfirm({ lot_code: lotCode.trim(), expiry_date: expiry || null, quantity: n })}>
              <PackageCheck size={15} /> Dar de alta lote
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
