// COMPRAS A PROVEEDORES (Dirección / Facturación). La historia normal del inventario:
//  1) Stock bajo → Dirección registra una COMPRA A PROVEEDOR (o producción interna).
//  2) La compra queda PENDIENTE DE RECIBIR: todavía NO hay inventario.
//  3) Almacén RECIBE LA MERCANCÍA (cantidad real, lote, caducidad) → lote/kardex → inventario disponible.
//  4) La compra queda parcial o completa. Pagarla es un hecho de dinero aparte.
// La orden nace por el comando idempotente `crear_orden_compra` (un doble clic no duplica).
import React, { useMemo, useState } from 'react'
import { ShoppingCart, PackageCheck, AlertTriangle, X, Factory, Check, DollarSign } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useCompras, type PurchaseOrder, type ReplenKind } from '../../data/hooks/useCompras'
import { stockByProduct, REORDER_THRESHOLD } from '../../data/ops/stock'
import { costOf } from '../../data/mock/costs'
import { hasSupabase } from '../../lib/supabase'
import { useRole } from '../../auth/RoleContext'
import { useOpId } from '../../data/hooks/useOpId'
import { pendingQty, isOpen, PUEDE_MARCAR_PAGADO } from '../../data/store/comprasStore'
import { RecibirMercanciaModal, STATUS_LABEL, STATUS_PILL, TIPO_LABEL } from '../warehouse/RecibirMercanciaModal'
import type { ProductSafe } from '../../data/types'

const LOW = REORDER_THRESHOLD // umbral de reorden único (ver ops/stock)
const TARGET = 60   // stock objetivo tras reabastecer

export function Reabastecimiento() {
  const { data: lots } = useLots()
  const { data: products } = useProducts()
  const { data: pos, createReplenishment, markPaid } = useCompras()
  const { role } = useRole()
  const isAdmin = role === 'admin'
  // Misma autoridad que el servidor (comando + RLS): Dirección y Facturación crean compras y registran el pago.
  const puedeComprar = PUEDE_MARCAR_PAGADO(role)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [replen, setReplen] = useState<{ product: ProductSafe; suggested: number } | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const toast = (ok: boolean, text: string) => { setFlash({ ok, text }); if (ok) setTimeout(() => setFlash(null), 5000) }

  const stock = useMemo(() => stockByProduct(lots), [lots])
  const stockOf = (id: string) => stock[id]?.qty ?? 0

  // Todo el inventario, de menor a mayor existencia: lo que urge queda arriba solo.
  const filas = useMemo(
    () => products
      .map((p) => ({ p, qty: stockOf(p.id), tracked: Boolean(stock[p.id]) }))
      .filter((x) => x.tracked || x.p.price != null)
      .sort((a, b) => a.qty - b.qty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, stock],
  )
  const bajos = useMemo(() => filas.filter((x) => x.qty <= LOW), [filas])
  const [soloBajos, setSoloBajos] = useState(false)
  const visibles = soloBajos ? bajos : filas

  const enCurso = (productId: string) => pos.some((o) => o.product_id === productId && isOpen(o))
  const abiertas = pos.filter(isOpen).length

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Compras a proveedores">
        Aquí registras <b>qué le compras a un proveedor</b> (o qué produces): producto, cantidad y costo. La compra
        queda <b>pendiente de recibir</b> y <b>no suma inventario</b>: el inventario entra cuando Almacén <b>recibe la
        mercancía</b> con su lote y caducidad.
      </PageHead>

      {flash && (
        <div className="sysnote" style={{ display: 'flex', alignItems: 'center', gap: 10, background: flash.ok ? 'var(--ok-bg)' : 'var(--danger-bg)', borderColor: 'transparent', color: flash.ok ? 'var(--green-deep)' : 'var(--danger)' }} role="status">
          {flash.ok ? <Check size={16} /> : <X size={16} />}<span style={{ flex: 1 }}>{flash.text}</span>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={() => setFlash(null)}><X size={14} /></button>
        </div>
      )}

      {/* 1) Stock bajo → Dirección compra */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} style={{ color: bajos.length ? 'var(--warn)' : 'var(--ink-3)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>
            Inventario · {filas.length} productos · {bajos.length} con stock bajo (≤ {LOW} u)
          </div>
          <button className={'btn sm' + (soloBajos ? '' : ' ghost')} type="button"
            style={{ marginLeft: 12 }} onClick={() => setSoloBajos((v) => !v)}>
            {soloBajos ? 'Ver todos' : 'Solo los bajos'}
          </button>
          <ExportButton
            name={soloBajos ? 'stock-bajo' : 'inventario'}
            style={{ marginLeft: 'auto' }}
            rows={visibles.map(({ p, qty }) => ({ producto: p.name, stock: qty, estado: qty <= 0 ? 'Agotado' : qty <= LOW ? 'Bajo' : 'Suficiente', sugerido: qty <= LOW ? Math.max(TARGET - qty, 10) : 0 }))}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'stock', label: 'Stock (u)' },
              { key: 'estado', label: 'Estado' },
              { key: 'sugerido', label: 'Sugerido (+u)' },
            ]}
          />
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Sugerido</th><th></th></tr></thead>
            <tbody>
              {visibles.map(({ p, qty }) => {
                const sugerido = Math.max(TARGET - qty, 10)
                const agotado = qty <= 0
                const bajo = qty <= LOW
                return (
                  <tr key={p.id}>
                    <td data-label="Producto">{p.name}</td>
                    <td data-label="Stock" className="mono">{qty} u</td>
                    <td data-label="Estado">
                      <span className={'pill ' + (agotado ? 'p-dang' : bajo ? 'p-warn' : 'p-ok')}>
                        {agotado ? 'Agotado' : bajo ? 'Bajo' : 'Suficiente'}
                      </span>
                    </td>
                    <td data-label="Sugerido" className="mono" style={bajo ? undefined : { color: 'var(--ink-3)' }}>
                      {bajo ? `+${sugerido} u` : '—'}
                    </td>
                    <td data-label="">
                      {enCurso(p.id)
                        ? <span className="pill p-blue">Compra pendiente de recibir</span>
                        : puedeComprar
                          ? <button className={'btn sm' + (bajo ? '' : ' ghost')} type="button"
                              onClick={() => setReplen({ product: p, suggested: sugerido })} data-testid="btn-comprar">
                              <ShoppingCart size={14} /> Comprar a proveedor
                            </button>
                          : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Lo compra Dirección</span>}
                    </td>
                  </tr>
                )
              })}
              {visibles.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>
                  {soloBajos ? 'Inventario saludable · nada por comprar.' : 'Todavía no hay productos con inventario.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2+3) Compras → pendientes de recibir → Almacén recibe */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="eyebrow" style={{ margin: 0 }}>Compras a proveedores · {abiertas} pendiente{abiertas === 1 ? '' : 's'} de recibir</div>
          <ExportButton
            name="compras-proveedores"
            style={{ marginLeft: 'auto' }}
            rows={pos.map((o) => ({ ...o, pendiente: pendingQty(o) }))}
            columns={[
              { key: 'product_name', label: 'Producto' },
              { key: 'kind', label: 'Tipo', format: (v) => TIPO_LABEL[v as ReplenKind] },
              { key: 'supplier', label: 'Proveedor' },
              { key: 'qty', label: 'Pedido (u)' },
              { key: 'received_qty', label: 'Recibido (u)' },
              { key: 'pendiente', label: 'Pendiente (u)' },
              { key: 'unit_cost', label: 'Costo unitario' },
              { key: 'created_at', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
              { key: 'status', label: 'Estado', format: (v) => STATUS_LABEL[v as PurchaseOrder['status']] },
            ]}
          />
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Tipo · proveedor</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Costo unit.</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pos.map((o) => (
                <tr key={o.id} data-testid="fila-compra">
                  <td data-label="Producto">{o.product_name}</td>
                  <td data-label="Tipo · proveedor">
                    <span className={'pill ' + (o.kind === 'compra' ? 'p-blue' : 'p-neu')}>{o.kind === 'compra' ? 'Compra' : 'Producción'}</span>
                    {o.supplier && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{o.supplier}</div>}
                  </td>
                  <td data-label="Pedido" className="mono">{o.qty} u</td>
                  <td data-label="Recibido" className="mono">{o.received_qty ?? 0} u</td>
                  <td data-label="Pendiente" className="mono" style={pendingQty(o) > 0 && isOpen(o) ? { color: 'var(--warn)', fontWeight: 700 } : { color: 'var(--ink-3)' }}>{isOpen(o) ? `${pendingQty(o)} u` : '—'}</td>
                  <td data-label="Costo unit." className="mono">${o.unit_cost.toLocaleString('es-MX')}</td>
                  <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                  <td data-label="Estado"><span className={'pill ' + STATUS_PILL[o.status]} title={o.close_reason ?? undefined}>{STATUS_LABEL[o.status]}</span></td>
                  <td data-label="">
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {isOpen(o)
                        ? <button className="btn sm" type="button" onClick={() => setReceiving(o)}><PackageCheck size={14} /> Recibir mercancía</button>
                        : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{o.status === 'recibida' ? 'En inventario' : 'Cerrada (no se reabre)'}</span>}
                      {!isOpen(o) && isAdmin && hasSupabase && (
                        <button className="btn ghost sm" type="button" title="Producto de más que llegó con esta compra: entrada separada autorizada por Dirección" onClick={() => setReceiving(o)}>Registrar excedente</button>
                      )}
                      {o.kind === 'compra' && !o.paid && puedeComprar && (
                        <button className="btn ghost sm" type="button" title="Registrar el pago al proveedor (independiente de la recepción)" data-testid="btn-pagado"
                          onClick={async () => { const r = await markPaid(o.id); toast(r.ok, r.ok ? 'Compra marcada como pagada.' : r.error ?? 'No se marcó como pagada.') }}><DollarSign size={13} /> Marcar pagado</button>
                      )}
                      {o.kind === 'compra' && o.paid && <span className="pill p-ok" style={{ fontSize: 10.5 }}>Pagada</span>}
                    </span>
                  </td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={9} style={{ color: 'var(--ink-3)' }}>Aún no hay compras a proveedores.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {replen && (
        <ComprarModal
          product={replen.product}
          suggested={replen.suggested}
          onClose={() => setReplen(null)}
          onConfirm={async (input, opId) => {
            const r = await createReplenishment({ product_id: replen.product.id, product_name: replen.product.name, qty: input.qty, unit_cost: input.unitCost, kind: input.kind, supplier: input.supplier }, opId)
            // El modal solo se cierra si la compra quedó registrada (o ya lo estaba: reintento).
            if (!r.ok) { toast(false, `La compra NO se registró. ${r.error}`); return false }
            setReplen(null)
            toast(true, input.kind === 'compra'
              ? 'Compra registrada: queda pendiente de recibir. El inventario NO cambia hasta que Almacén reciba la mercancía.'
              : 'Producción registrada: queda pendiente de recibir. Entrará al inventario al recibirla como lote.')
            return true
          }}
        />
      )}

      {receiving && (
        <RecibirMercanciaModal
          po={receiving}
          isAdmin={isAdmin}
          onClose={() => setReceiving(null)}
          onDone={(msg) => { setReceiving(null); toast(true, msg) }}
        />
      )}
    </div>
  )
}

const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 6 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

// P2-1 · Una intención de compra = UN op_id (useOpId): doble clic, timeout o reintento devuelven
// la MISMA orden. Solo tras un alta confirmada se renueva el op_id para la siguiente compra.
function ComprarModal({ product, suggested, onClose, onConfirm }: {
  product: ProductSafe
  suggested: number
  onClose: () => void
  onConfirm: (input: { qty: number; unitCost: number; kind: ReplenKind; supplier: string | null }, opId: string) => Promise<boolean>
}) {
  const [kind, setKind] = useState<ReplenKind>('compra')
  const [supplier, setSupplier] = useState('')
  const [qty, setQty] = useState(String(suggested))
  const [cost, setCost] = useState(String(costOf(product.id) || ''))
  const [busy, setBusy] = useState(false)
  const { opId, renew } = useOpId()
  const n = Math.max(0, parseInt(qty, 10) || 0)
  const c = Math.max(0, Number(cost) || 0)
  const valid = n > 0 && c > 0 && (kind === 'produccion' || supplier.trim() !== '')
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const ok = await onConfirm({ qty: n, unitCost: c, kind, supplier: supplier.trim() || null }, opId)
    setBusy(false)
    if (ok) renew()
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="comprar-modal">
        <div className="mhead">
          <div><h3>Comprar a proveedor</h3><div className="ms">{product.name}</div></div>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...lbl, marginTop: 0 }}>¿Cómo se consigue?</label>
          <div className="seg" style={{ marginTop: 8 }}>
            <button type="button" className={kind === 'compra' ? 'active' : undefined} onClick={() => setKind('compra')}><ShoppingCart size={14} /> Compra a proveedor</button>
            <button type="button" className={kind === 'produccion' ? 'active' : undefined} onClick={() => setKind('produccion')}><Factory size={14} /> Producción interna</button>
          </div>

          {kind === 'compra' && (
            <>
              <label style={lbl}>Proveedor</label>
              <input style={fld} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Nombre del proveedor / fabricante" autoFocus aria-label="Proveedor" />
            </>
          )}

          <div className="form-grid-2">
            <div>
              <label style={lbl}>Cantidad</label>
              <input style={fld} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Cantidad" />
            </div>
            <div>
              <label style={lbl}>{kind === 'compra' ? 'Costo unitario (proveedor)' : 'Costo unitario (producir)'}</label>
              <input style={fld} type="number" min={1} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" aria-label="Costo unitario" />
            </div>
          </div>
          {c > 0 && n > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>Total: <b className="mono">${(c * n).toLocaleString('es-MX')}</b> · este costo se hereda al lote al recibirlo (costo de ventas real).</div>}

          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>Queda <b>pendiente de recibir</b>: el inventario <b>no cambia</b> hasta que Almacén reciba la mercancía con su lote y caducidad.{kind === 'compra' ? ' La compra entra a cuentas por pagar hasta que la liquides.' : ''}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={submit} data-testid="comprar-confirmar">
              {busy ? 'Registrando…' : kind === 'compra' ? 'Registrar compra' : 'Registrar producción'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
