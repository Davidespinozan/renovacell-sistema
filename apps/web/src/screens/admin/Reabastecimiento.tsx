// COMPRAS A PROVEEDORES (Dirección / Facturación). La historia normal del inventario:
//  1) Stock bajo → Dirección registra una COMPRA A PROVEEDOR (o producción interna).
//  2) La compra queda PENDIENTE DE RECIBIR: todavía NO hay inventario.
//  3) Almacén RECIBE LA MERCANCÍA (cantidad real, lote, caducidad) → lote/kardex → inventario disponible.
//  4) La compra queda parcial o completa. Pagarla es un hecho de dinero aparte.
// La orden nace por el comando idempotente `crear_orden_compra` (un doble clic no duplica).
import { GuiaInventario } from '../../app/GuiaInventario'
import React, { useMemo, useState } from 'react'
import { ShoppingCart, PackageCheck, AlertTriangle, X, Factory, Check, DollarSign } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useCompras, type PurchaseOrder, type ReplenKind } from '../../data/hooks/useCompras'
import { stockByProduct, nivelDe, sugeridoDeCompra, errorDeNivel, REORDER_THRESHOLD, IDEAL_POR_DEFECTO, type NivelStock } from '../../data/ops/stock'
import { useNivelesStock, guardarNivel } from '../../data/store/nivelesStockStore'
import { costOf } from '../../data/mock/costs'
import { hasSupabase } from '../../lib/supabase'
import { useRole } from '../../auth/RoleContext'
import { useOpId } from '../../data/hooks/useOpId'
import { pendingQty, isOpen, PUEDE_MARCAR_PAGADO } from '../../data/store/comprasStore'
import { RecibirMercanciaModal, STATUS_LABEL, STATUS_PILL, TIPO_LABEL } from '../warehouse/RecibirMercanciaModal'
import type { ProductSafe } from '../../data/types'
import { aInterno, aVista, cantidadVista, esMediaCaja, factor, precioVista } from '../../lib/cajas'
import { RegistrarCompraModal } from './RegistrarCompraModal'   // COMPRA CON FACTURA (26 nov 2026)
import { reloadCompras } from '../../data/store/comprasStore'

// NIVELES POR PRODUCTO (27 nov 2026, dueño: «Dirección no puede ajustar el inventario sugerido, y si el stock es
// suficiente le impide comprar más; eso está mal»). Antes: «Bajo» con 20 o menos y sugerir hasta 60, iguales para todo
// el catálogo; y el botón de comprar solo aparecía en los «Bajos» y desaparecía si ya había una compra en camino.
// Ahora cada producto puede tener su mínimo y su ideal (los fija Dirección), y SIEMPRE se puede comprar.

export function Reabastecimiento() {
  const { data: lots } = useLots()
  const { data: products } = useProducts()
  const { data: pos, createReplenishment, markPaid } = useCompras()
  const { role } = useRole()
  const isAdmin = role === 'admin'
  // Misma autoridad que el servidor (comando + RLS): Dirección y Facturación crean compras y registran el pago.
  const puedeComprar = PUEDE_MARCAR_PAGADO(role)
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [replen, setReplen] = useState<{ product: ProductSafe; suggested: number; existencia: number; nivel: NivelStock; enCamino: number } | null>(null)
  const niveles = useNivelesStock()
  const [ajustando, setAjustando] = useState<ProductSafe | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [conFactura, setConFactura] = useState(false)
  const toast = (ok: boolean, text: string) => { setFlash({ ok, text }); if (ok) setTimeout(() => setFlash(null), 5000) }

  const stock = useMemo(() => stockByProduct(lots), [lots])
  const stockOf = (id: string) => stock[id]?.qty ?? 0
  // CAJAS-MEDIOS: media caja se lee en cajas con medios (umbrales y guardado siguen en internas).
  const prodById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, ProductSafe | undefined>, [products])

  // Todo el inventario, de menor a mayor existencia: lo que urge queda arriba solo.
  const filas = useMemo(
    () => products
      .map((p) => ({ p, qty: stockOf(p.id), tracked: Boolean(stock[p.id]) }))
      .filter((x) => x.tracked || x.p.price != null)
      .sort((a, b) => a.qty - b.qty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, stock],
  )
  const bajos = useMemo(() => filas.filter((x) => x.qty <= nivelDe(niveles, x.p.id).minimo), [filas, niveles])
  const [soloBajos, setSoloBajos] = useState(false)
  // BUSCADOR (27 nov 2026, dueño: «en compras hay que poner un buscador porque es difícil buscar en la lista»): por nombre
  // o clave, sin distinguir mayúsculas ni acentos, y con varias palabras en cualquier orden.
  const [busca, setBusca] = useState('')
  const visibles = useMemo(() => {
    const base = soloBajos ? bajos : filas
    const plano = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const palabras = plano(busca).split(/\s+/).filter(Boolean)
    if (palabras.length === 0) return base
    return base.filter(({ p }) => { const t = plano(`${p.name} ${(p as { sku?: string | null }).sku ?? ''}`); return palabras.every((w) => t.includes(w)) })
  }, [soloBajos, bajos, filas, busca])

  // Lo que ya se compró y todavía no llega, por producto: se descuenta de lo que se sugiere comprar.
  const enCaminoDe = useMemo(() => {
    const m: Record<string, number> = {}
    pos.filter(isOpen).forEach((o) => { m[o.product_id] = (m[o.product_id] ?? 0) + pendingQty(o) })
    return m
  }, [pos])
  const abiertas = pos.filter(isOpen).length

  return (
    <div className="grid" style={{ gap: 16 }}>
      <GuiaInventario paso={1} />
      {/* CALIDAD VISUAL · una sola explicación según el rol (antes Almacén veía dos tarjetas de ayuda seguidas) */}
      {!isAdmin
        ? <div className="sysnote" data-testid="compras-solo-lectura">Aquí ves <b>qué viene en camino</b>. Las compras las registra Dirección; lo tuyo es <b>Recibir mercancía</b> cuando llegue.</div>
        : <PageHead title="Compras a proveedores">
            Registra <b>qué le compras a un proveedor</b>: producto, cantidad y costo. <b>No suma inventario</b> hasta que Almacén la recibe con lote y caducidad.
          </PageHead>}
      {puedeComprar && (
        <div><button className="btn" type="button" onClick={() => setConFactura(true)} data-testid="btn-compra-factura"><ShoppingCart size={14} /> Registrar compra (con o sin factura)</button></div>
      )}
      {conFactura && <RegistrarCompraModal productos={products} onClose={() => setConFactura(false)} onHecho={(t) => { setConFactura(false); toast(true, t); reloadCompras() }} />}

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
            Inventario · {filas.length} productos · {bajos.length} por debajo de su mínimo
          </div>
          <button className={'btn sm' + (soloBajos ? '' : ' ghost')} type="button"
            style={{ marginLeft: 12 }} onClick={() => setSoloBajos((v) => !v)}>
            {soloBajos ? 'Ver todos' : 'Solo los bajos'}
          </button>
          <ExportButton
            name={soloBajos ? 'stock-bajo' : 'inventario'}
            style={{ marginLeft: 'auto' }}
            rows={visibles.map(({ p, qty }) => { const n = nivelDe(niveles, p.id); const camino = enCaminoDe[p.id] ?? 0; return { producto: p.name, stock: qty, estado: qty <= 0 ? 'Agotado' : qty <= n.minimo ? 'Bajo' : 'Suficiente', minimo: n.minimo, ideal: n.ideal, en_camino: camino, sugerido: qty <= n.minimo ? sugeridoDeCompra(qty, n, camino) : 0 } })}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'stock', label: 'Stock (u)' },
              { key: 'estado', label: 'Estado' },
              { key: 'minimo', label: 'Mínimo (u)' },
              { key: 'ideal', label: 'Ideal (u)' },
              { key: 'en_camino', label: 'En camino (u)' },
              { key: 'sugerido', label: 'Sugerido (+u)' },
            ]}
          />
        </div>
        <div style={{ padding: '4px 16px 10px' }}>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar producto por nombre o clave…" aria-label="Buscar producto" data-testid="compras-buscar"
            style={{ width: '100%', maxWidth: 420, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', backgroundColor: 'var(--cp-surface)' }} />
          {busca.trim() !== '' && <span className="ms" style={{ marginLeft: 10, color: 'var(--ink-3)' }} data-testid="compras-buscar-cuenta">{visibles.length} de {(soloBajos ? bajos : filas).length}</span>}
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Mínimo · ideal</th><th>Sugerido</th><th></th></tr></thead>
            <tbody>
              {visibles.map(({ p, qty }) => {
                const nivel = nivelDe(niveles, p.id)
                const enCamino = enCaminoDe[p.id] ?? 0
                const sugerido = sugeridoDeCompra(qty, nivel, enCamino)
                const agotado = qty <= 0
                const bajo = qty <= nivel.minimo
                return (
                  <tr key={p.id} data-testid={`fila-stock-${p.id}`}>
                    <td data-label="Producto">{p.name}</td>
                    <td data-label="Stock" className="mono">{cantidadVista(p, qty, 'u')}</td>
                    <td data-label="Estado">
                      <span className={'pill ' + (agotado ? 'p-dang' : bajo ? 'p-warn' : 'p-ok')}>
                        {agotado ? 'Agotado' : bajo ? 'Bajo' : 'Suficiente'}
                      </span>
                    </td>
                    <td data-label="Mínimo · ideal" data-testid="celda-niveles">
                      <span style={{ display: 'inline-flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span className="mono" style={nivel.propio ? { fontWeight: 600 } : { color: 'var(--ink-3)' }} title={nivel.propio ? 'Nivel propio de este producto' : 'Nivel general: aplica a los productos sin nivel propio'}>
                          {cantidadVista(p, nivel.minimo)} · {cantidadVista(p, nivel.ideal)}
                        </span>
                        {isAdmin && <button className="rc-link" type="button" style={{ padding: 0 }} onClick={() => setAjustando(p)} data-testid="btn-niveles">Ajustar</button>}
                      </span>
                    </td>
                    <td data-label="Sugerido" className="mono" style={bajo && sugerido > 0 ? undefined : { color: 'var(--ink-3)' }} data-testid="celda-sugerido">
                      {bajo && sugerido > 0 ? `+${cantidadVista(p, sugerido, 'u')}` : '—'}
                    </td>
                    <td data-label="">
                      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {enCamino > 0 && <span className="pill p-blue" data-testid="pill-en-camino">En camino: {cantidadVista(p, enCamino, 'u')}</span>}
                        {/* SIEMPRE se puede comprar: con stock suficiente o con una compra en camino también (antes el botón
                            desaparecía en esos dos casos). Acción fantasma: el estado ya lo señala la píldora. */}
                        {puedeComprar
                          ? <button className="btn ghost sm" type="button"
                              onClick={() => setReplen({ product: p, suggested: bajo ? sugerido : 0, existencia: qty, nivel, enCamino })} data-testid="btn-comprar">
                              <ShoppingCart size={14} /> {enCamino > 0 ? 'Comprar más' : bajo ? 'Comprar a proveedor' : 'Comprar'}
                            </button>
                          : bajo && enCamino <= 0 ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Lo compra Dirección</span> : null}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {visibles.length === 0 && (
                <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>
                  {busca.trim() !== '' ? `Ningún producto coincide con «${busca.trim()}».` : soloBajos ? 'Ningún producto está por debajo de su mínimo.' : 'Todavía no hay productos con inventario.'}
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
                  <td data-label="Pedido" className="mono">{cantidadVista(prodById[o.product_id], o.qty, 'u')}</td>
                  <td data-label="Recibido" className="mono">{cantidadVista(prodById[o.product_id], o.received_qty ?? 0, 'u')}</td>
                  <td data-label="Pendiente" className="mono" style={pendingQty(o) > 0 && isOpen(o) ? { color: 'var(--warn)', fontWeight: 700 } : { color: 'var(--ink-3)' }}>{isOpen(o) ? cantidadVista(prodById[o.product_id], pendingQty(o), 'u') : '—'}</td>
                  <td data-label="Costo unit." className="mono">${precioVista(prodById[o.product_id], o.unit_cost).toLocaleString('es-MX')}{esMediaCaja(prodById[o.product_id]) ? ' /caja' : ''}</td>
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
          existencia={replen.existencia}
          nivel={replen.nivel}
          enCamino={replen.enCamino}
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

      {ajustando && (
        <NivelesModal
          product={ajustando}
          nivel={nivelDe(niveles, ajustando.id)}
          existencia={stockOf(ajustando.id)}
          onClose={() => setAjustando(null)}
          onHecho={(t) => { setAjustando(null); toast(true, t) }}
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
function ComprarModal({ product, suggested, existencia, nivel, enCamino, onClose, onConfirm }: {
  product: ProductSafe
  suggested: number
  existencia: number
  nivel: NivelStock
  enCamino: number
  onClose: () => void
  onConfirm: (input: { qty: number; unitCost: number; kind: ReplenKind; supplier: string | null }, opId: string) => Promise<boolean>
}) {
  const [kind, setKind] = useState<ReplenKind>('compra')
  const [supplier, setSupplier] = useState('')
  // CAJAS-MEDIOS: en media caja se escribe cantidad en cajas (acepta ½) y costo por caja; se mandan en internas.
  const mc = esMediaCaja(product)
  const [qty, setQty] = useState(suggested > 0 ? String(aVista(product, suggested)) : '')   // sin sugerencia: se escribe la cantidad
  const [cost, setCost] = useState(String(precioVista(product, costOf(product.id)) || ''))
  const [busy, setBusy] = useState(false)
  const { opId, renew } = useOpId()
  const n = mc ? aInterno(product, Number(qty) || 0) : Math.max(0, parseInt(qty, 10) || 0)
  const c = Math.max(0, Number(cost) || 0) / factor(product)
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
          <div className="sysnote" style={{ marginBottom: 14 }} data-testid="comprar-contexto">
            <span>
              Hay <b>{cantidadVista(product, existencia, 'u')}</b>{enCamino > 0 ? <> y vienen <b>{cantidadVista(product, enCamino, 'u')}</b> en camino</> : null}.
              {' '}Su mínimo es {cantidadVista(product, nivel.minimo)} y su ideal {cantidadVista(product, nivel.ideal)}.
              {existencia > nivel.minimo ? ' Tiene existencia suficiente; puedes comprar más si lo necesitas.' : suggested > 0 ? ` Para llegar al ideal faltan ${cantidadVista(product, suggested, 'u')}.` : ' Con lo que viene en camino ya llega al ideal.'}
            </span>
          </div>
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
              <label style={lbl}>{mc ? 'Cantidad (cajas)' : 'Cantidad'}</label>
              <input style={fld} type="number" min={mc ? 0.5 : 1} step={mc ? 0.5 : 1} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Cantidad" />
            </div>
            <div>
              <label style={lbl}>{(mc ? 'Costo por caja' : 'Costo unitario') + (kind === 'compra' ? ' (proveedor)' : ' (producir)')}</label>
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

// NIVELES DE UN PRODUCTO · Dirección decide cuándo se considera «Bajo» (mínimo) y hasta cuánto conviene reponer (ideal).
// En media caja se escribe en cajas, como el resto de la pantalla; se guarda en unidades internas.
function NivelesModal({ product, nivel, existencia, onClose, onHecho }: {
  product: ProductSafe; nivel: NivelStock; existencia: number; onClose: () => void; onHecho: (texto: string) => void
}) {
  const mc = esMediaCaja(product)
  const [minimo, setMinimo] = useState(String(aVista(product, nivel.minimo)))
  const [ideal, setIdeal] = useState(String(aVista(product, nivel.ideal)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const aNum = (v: string) => (v.trim() === '' ? NaN : mc ? aInterno(product, Number(v)) : Number(v))
  const m = aNum(minimo); const i = aNum(ideal)
  const invalido = errorDeNivel(m, i)
  const guardar = async (n: { minimo: number; ideal: number } | null) => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await guardarNivel(product.id, n)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onHecho(n ? `Niveles de ${product.name} guardados: avisa con ${cantidadVista(product, n.minimo)} o menos y sugiere reponer hasta ${cantidadVista(product, n.ideal)}.` : `${product.name} regresó al nivel general (${REORDER_THRESHOLD} y ${IDEAL_POR_DEFECTO}).`)
  }
  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="niveles-modal">
        <div className="mhead">
          <div><h3>Niveles de inventario</h3><div className="ms">{product.name} · hay {cantidadVista(product, existencia, 'u')}</div></div>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="sysnote">
            <span>Con estos dos números el sistema decide cuándo marcar este producto como <b>«Bajo»</b> y <b>cuánto sugerir comprar</b>. No impiden comprar: siempre puedes comprar la cantidad que quieras.</span>
          </div>
          <div className="form-grid-2">
            <div>
              <label style={lbl}>{mc ? 'Mínimo (cajas)' : 'Mínimo'}</label>
              <input style={fld} type="number" min={0} step={mc ? 0.5 : 1} value={minimo} onChange={(e) => { setMinimo(e.target.value); setErr(null) }} aria-label="Mínimo" autoFocus />
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>Avisa cuando queden estas piezas o menos.</div>
            </div>
            <div>
              <label style={lbl}>{mc ? 'Ideal (cajas)' : 'Ideal'}</label>
              <input style={fld} type="number" min={mc ? 0.5 : 1} step={mc ? 0.5 : 1} value={ideal} onChange={(e) => { setIdeal(e.target.value); setErr(null) }} aria-label="Ideal" />
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>Sugiere comprar hasta completar esta cantidad.</div>
            </div>
          </div>
          {(err || (invalido && minimo.trim() !== '' && ideal.trim() !== '')) && <div className="sysnote" role="alert" style={{ marginTop: 12, background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }} data-testid="niveles-error"><span>{err ?? invalido}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {nivel.propio && <button className="btn ghost" type="button" disabled={busy} onClick={() => void guardar(null)} data-testid="niveles-general" style={{ marginRight: 'auto' }}>Usar el nivel general ({REORDER_THRESHOLD} y {IDEAL_POR_DEFECTO})</button>}
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!!invalido || busy} style={invalido || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => void guardar({ minimo: m, ideal: i })} data-testid="niveles-guardar">{busy ? 'Guardando…' : 'Guardar niveles'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
