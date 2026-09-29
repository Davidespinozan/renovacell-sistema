// INVENTARIO / REABASTECIMIENTO. Proceso claro y con responsable:
//  1) El sistema muestra el STOCK BAJO (aquí + campana de Dirección).
//  2) DIRECCIÓN reabastece: Compra a proveedor o Producción interna (mixto).
//  3) ALMACÉN recibe y da de alta el lote (código + caducidad + cantidad).
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
import { cerrarOrdenCompra, pendingQty, isOpen, markReceivedLocal } from '../../data/store/comprasStore'
import type { ProductSafe } from '../../data/types'

const LOW = REORDER_THRESHOLD // umbral de reorden único (ver ops/stock)
const TARGET = 60   // stock objetivo tras reabastecer

export function Reabastecimiento() {
  const { data: lots, recibirLote } = useLots()
  const { data: products } = useProducts()
  const { data: pos, createReplenishment, markPaid } = useCompras()
  const { role } = useRole()
  const isAdmin = role === 'admin'
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [replen, setReplen] = useState<{ product: ProductSafe; suggested: number } | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const toast = (ok: boolean, text: string) => { setFlash({ ok, text }); if (ok) setTimeout(() => setFlash(null), 4000) }

  const stock = useMemo(() => stockByProduct(lots), [lots])
  const stockOf = (id: string) => stock[id]?.qty ?? 0

  // La pantalla se llama "Inventario", así que muestra TODO el inventario,
  // ordenado de menor a mayor existencia: lo que urge queda arriba solo. Antes
  // listaba únicamente lo que estaba bajo, y quien entraba veía tres renglones
  // de un catálogo de decenas y creía que faltaban productos.
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

  const enCurso = (productId: string) => pos.some((o) => o.product_id === productId && o.status === 'pendiente')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Inventario">
        El sistema te avisa cuando hay <b>stock bajo</b> (aquí y en la campana). Tú, Dirección, reabastreces
        con una <b>compra a proveedor</b> o una <b>producción interna</b>. Almacén lo recibe y da de alta el lote.
      </PageHead>

      {flash && (
        <div className="sysnote" style={{ display: 'flex', alignItems: 'center', gap: 10, background: flash.ok ? 'var(--ok-bg)' : 'var(--danger-bg)', borderColor: 'transparent', color: flash.ok ? 'var(--green-deep)' : 'var(--danger)' }}>
          {flash.ok ? <Check size={16} /> : <X size={16} />}<span style={{ flex: 1 }}>{flash.text}</span>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={() => setFlash(null)}><X size={14} /></button>
        </div>
      )}

      {/* 1+2) Stock bajo → Dirección reabastece */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: bajos.length ? 'var(--warn)' : 'var(--ink-3)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>
            {filas.length} productos · {bajos.length} por reabastecer (≤ {LOW} u)
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
                        ? <span className="pill p-blue">En curso</span>
                        : <button className={'btn sm' + (bajo ? '' : ' ghost')} type="button"
                            onClick={() => setReplen({ product: p, suggested: sugerido })}>
                            <ShoppingCart size={14} /> Reabastecer
                          </button>}
                    </td>
                  </tr>
                )
              })}
              {visibles.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>
                  {soloBajos ? 'Inventario saludable · nada por reabastecer.' : 'Todavía no hay productos con inventario.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3) Reabastecimientos en curso → Almacén recibe */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Reabastecimientos · Almacén los recibe</div>
          <ExportButton
            name="reabastecimientos"
            style={{ marginLeft: 'auto' }}
            rows={pos}
            columns={[
              { key: 'product_name', label: 'Producto' },
              { key: 'kind', label: 'Tipo', format: (v) => (v === 'compra' ? 'Compra' : 'Producción') },
              { key: 'supplier', label: 'Proveedor' },
              { key: 'qty', label: 'Cantidad' },
              { key: 'created_at', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
              { key: 'status', label: 'Estado' },
            ]}
          />
        </div>
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
                  <td data-label="Cantidad" className="mono">{o.received_qty ?? 0}/{o.qty} u</td>
                  <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                  <td data-label="Estado"><span className={'pill ' + STATUS_PILL[o.status]} title={o.close_reason ?? undefined}>{STATUS_LABEL[o.status]}</span></td>
                  <td data-label="">
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {isOpen(o)
                        ? <button className="btn sm" type="button" onClick={() => setReceiving(o)}><PackageCheck size={14} /> Recibir mercancía</button>
                        : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{o.status === 'recibida' ? 'Recibida completa' : 'Cerrada (no se reabre)'}</span>}
                      {!isOpen(o) && isAdmin && hasSupabase && (
                        <button className="btn ghost sm" type="button" title="Producto de más que llegó con esta orden: entrada separada autorizada por Dirección" onClick={() => setReceiving(o)}>Registrar excedente</button>
                      )}
                      {o.kind === 'compra' && !o.paid && (
                        <button className="btn ghost sm" type="button" title="Registrar el pago al proveedor (independiente de la recepción)"
                          onClick={() => { markPaid(o.id); toast(true, 'Compra marcada como pagada.') }}><DollarSign size={13} /> Marcar pagado</button>
                      )}
                      {o.kind === 'compra' && o.paid && <span className="pill p-ok" style={{ fontSize: 10.5 }}>Pagada</span>}
                    </span>
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
            createReplenishment({ product_id: replen.product.id, product_name: replen.product.name, qty: input.qty, unit_cost: input.unitCost, kind: input.kind, supplier: input.supplier })
            setReplen(null)
            toast(true, input.kind === 'compra'
              ? 'Compra registrada. El inventario se actualizará cuando recibas la mercancía (Recibir y dar de alta).'
              : 'Producción registrada. Se dará de alta como lote al recibirla.')
          }}
        />
      )}

      {receiving && (
        <RecibirModal
          po={receiving}
          isAdmin={isAdmin}
          onClose={() => setReceiving(null)}
          onDone={(msg) => { setReceiving(null); toast(true, msg) }}
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
  onConfirm: (input: { qty: number; unitCost: number; kind: ReplenKind; supplier: string | null }) => void
}) {
  const [kind, setKind] = useState<ReplenKind>('compra')
  const [supplier, setSupplier] = useState('')
  const [qty, setQty] = useState(String(suggested))
  const [cost, setCost] = useState(String(costOf(product.id) || ''))
  const n = Math.max(0, parseInt(qty, 10) || 0)
  const c = Math.max(0, Number(cost) || 0)
  const valid = n > 0 && c > 0 && (kind === 'produccion' || supplier.trim() !== '')

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

          <div className="form-grid-2">
            <div>
              <label style={lbl}>Cantidad</label>
              <input style={fld} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <label style={lbl}>{kind === 'compra' ? 'Costo unitario (proveedor)' : 'Costo unitario (producir)'}</label>
              <input style={fld} type="number" min={1} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
            </div>
          </div>
          {c > 0 && n > 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>Total: <b className="mono">${(c * n).toLocaleString('es-MX')}</b> · este costo se hereda al lote (para el costo de ventas real).</div>}

          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>Queda <b>pendiente de recibir</b>. Almacén lo dará de alta como lote (con caducidad) cuando llegue.{kind === 'compra' ? ' La compra entra a cuentas por pagar hasta que la liquides.' : ''}</span>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onConfirm({ qty: n, unitCost: c, kind, supplier: supplier.trim() || null })}>
              {kind === 'compra' ? 'Registrar compra' : 'Registrar producción'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<PurchaseOrder['status'], string> = { pendiente: 'Pendiente', parcial: 'Parcial', recibida: 'Recibida', cerrada_incompleta: 'Cerrada incompleta' }
const STATUS_PILL: Record<PurchaseOrder['status'], string> = { pendiente: 'p-warn', parcial: 'p-blue', recibida: 'p-ok', cerrada_incompleta: 'p-neu' }

// Recepción W1 (D-04): parcial y acumulada contra la orden; nunca supera lo pendiente.
// Excedente = entrada SEPARADA (solo Dirección, motivo). Cerrar incompleta = Dirección.
// op_id estable por intención: reintentar tras una respuesta ambigua no duplica stock.
function RecibirModal({ po, isAdmin, onClose, onDone }: {
  po: PurchaseOrder
  isAdmin: boolean
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const { recibirLote } = useLots()
  const pend = pendingQty(po)
  const abierta = isOpen(po)
  const [mode, setMode] = useState<'recibir' | 'excedente' | 'cerrar'>(abierta ? 'recibir' : 'excedente')
  const [lotCode, setLotCode] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty, setQty] = useState(String(abierta ? pend : 1))
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { opId } = useOpId()
  const n = Math.max(0, parseInt(qty, 10) || 0)
  const needsReason = mode !== 'recibir'
  const valid = mode === 'cerrar'
    ? reason.trim().length >= 3
    : lotCode.trim() !== '' && !!expiry && n > 0 && (mode !== 'recibir' || n <= pend) && (!needsReason || reason.trim().length >= 3)

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    if (mode === 'cerrar') {
      const r = await cerrarOrdenCompra(opId, po.id, reason)
      setBusy(false)
      if (!r.ok) { setErr(r.error ?? 'No se pudo cerrar la orden.'); return }
      onDone(`Orden cerrada incompleta (faltaron ${pend} u). Si se necesitan, genera una orden nueva.`)
      return
    }
    const r = await recibirLote({
      product_id: po.product_id, lot_code: lotCode.trim(), expiry_date: expiry, quantity: n, location: null,
      unit_cost: po.unit_cost, replenishment_id: po.id, kind: mode === 'excedente' ? 'excedente' : 'orden',
      reason: mode === 'excedente' ? reason : undefined, evidence: evidence.trim() || null, op_id: opId,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'No se pudo recibir la mercancía.'); return }
    if (!hasSupabase && mode === 'recibir') markReceivedLocalFor(po.id, n)
    onDone(mode === 'excedente'
      ? 'Excedente registrado como entrada separada (no suma a la orden).'
      : r.replenishment_status === 'parcial' ? `Recepción parcial registrada. Pendiente: ${r.pending_qty ?? pend - n} u.` : 'Mercancía recibida. Orden completa.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>{mode === 'cerrar' ? 'Cerrar orden incompleta' : mode === 'excedente' ? 'Registrar excedente' : 'Recibir y dar de alta'}</h3>
            <div className="ms">{po.product_name} · {po.kind === 'compra' ? `compra${po.supplier ? ` · ${po.supplier}` : ''}` : 'producción'} · recibido {po.received_qty ?? 0}/{po.qty} u{abierta ? ` · pendiente ${pend} u` : ''}</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          {isAdmin && hasSupabase && (
            <div className="seg" style={{ marginBottom: 12 }}>
              {abierta && <button type="button" className={mode === 'recibir' ? 'active' : undefined} onClick={() => setMode('recibir')}>Recibir</button>}
              <button type="button" className={mode === 'excedente' ? 'active' : undefined} onClick={() => setMode('excedente')}>Excedente</button>
              {abierta && <button type="button" className={mode === 'cerrar' ? 'active' : undefined} onClick={() => setMode('cerrar')}>Cerrar incompleta</button>}
            </div>
          )}
          {mode !== 'cerrar' && (
            <>
              <label style={{ ...lbl, marginTop: 0 }}>Código de lote</label>
              <input style={fld} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="p. ej. LT-2026-014" autoFocus />
              <label style={lbl}>Caducidad (obligatoria)</label>
              <input type="date" style={fld} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              <label style={lbl}>{mode === 'excedente' ? 'Cantidad excedente' : `Cantidad recibida (máx. ${pend})`}</label>
              <input type="number" min={1} max={mode === 'recibir' ? pend : undefined} style={fld} value={qty} onChange={(e) => setQty(e.target.value)} />
              {mode === 'recibir' && n > pend && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>Supera lo pendiente ({pend} u). El excedente lo registra Dirección aparte.</div>}
            </>
          )}
          {needsReason && (
            <>
              <label style={lbl}>Motivo (obligatorio)</label>
              <input style={fld} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'cerrar' ? 'p. ej. el proveedor no surtirá el resto' : 'p. ej. el proveedor mandó 3 de más'} />
            </>
          )}
          {mode === 'excedente' && (
            <>
              <label style={lbl}>Evidencia (opcional)</label>
              <input style={fld} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Remisión / factura / nota" />
            </>
          )}
          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>{mode === 'cerrar' ? 'La orden queda cerrada y NO se reabre; el faltante se pide con una orden nueva.'
              : 'Se da de alta el lote (o se suma al mismo lote si el código y la caducidad coinciden) con su movimiento de entrada.'}</span>
          </div>
          {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={submit}>
              <PackageCheck size={15} /> {busy ? 'Registrando…' : err ? 'Reintentar' : mode === 'cerrar' ? 'Cerrar orden' : mode === 'excedente' ? 'Registrar excedente' : 'Dar de alta lote'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Modo demo: refleja la recepción en el cache local de compras.
function markReceivedLocalFor(id: string, qty: number) { markReceivedLocal(id, qty) }
