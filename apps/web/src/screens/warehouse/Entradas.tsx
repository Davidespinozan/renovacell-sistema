// RECIBIR MERCANCÍA (Almacén). La superficie física de recepción: aquí se ve qué compras a
// proveedores están PENDIENTES DE RECIBIR y se recibe la mercancía que llegó (cantidad real,
// lote, caducidad). Es el único momento en que la compra se vuelve inventario (recibir_lote
// 'orden', atómico con lote/kardex/acumulado). Abajo, el historial inmutable de movimientos.
// Las ENTRADAS EXCEPCIONALES (sin compra: inventario encontrado, muestra, corrección autorizada)
// son otra cosa: solo Dirección, con motivo, en su propia sección. La carga inicial de inventario
// va por "Importar / Migración" (idempotente por lote), no por aquí.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useInventory } from '../../data/hooks/useInventory'
import { useProducts } from '../../data/hooks/useProducts'
import { useCompras, type PurchaseOrder } from '../../data/hooks/useCompras'
import type { Lot, ProductSafe } from '../../data/types'
import { useRole } from '../../auth/RoleContext'
import { useOpId } from '../../data/hooks/useOpId'
import { hasSupabase } from '../../lib/supabase'
import { pendingQty, isOpen } from '../../data/store/comprasStore'
import { RecibirMercanciaModal, STATUS_LABEL, STATUS_PILL, TIPO_LABEL } from './RecibirMercanciaModal'

// W1 · D-04: una entrada SIN compra requiere Dirección y motivo. "Carga inicial" NO va aquí (Importar / Migración).
const MOTIVOS_EXCEPCIONALES = ['Inventario encontrado', 'Muestra', 'Corrección autorizada', 'Otro']

// Motivos del movimiento en palabras claras (el dato técnico vive en el store).
const reasonLabel = (r: string | null): string => ({
  entrada: 'Entró a almacén',
  carga_inicial: 'Carga inicial',
  devolucion: 'Regresó por devolución',
  correccion_recepcion: 'Corrección de recepción',
  surtido: 'Salió en un pedido',
  venta: 'Salió en una venta',
  merma: 'Baja (caducó / dañado)',
  cancelacion: 'Regresó por cancelación',
  ajuste: 'Ajuste de conteo',
}[r ?? ''] ?? (r ?? '—'))

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
  borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px',
}

export function Entradas() {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { data: movements } = useInventory()
  const { data: compras } = useCompras()
  const { role } = useRole()
  const isAdmin = role === 'admin'
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const avisar = (ok: boolean, text: string) => { setToast({ ok, text }); if (ok) window.setTimeout(() => setToast(null), 4000) }

  const pendientes = useMemo(() => compras.filter(isOpen), [compras])
  const cerradas = useMemo(() => compras.filter((o) => !isOpen(o)).slice(0, 8), [compras])

  const lotById = useMemo(() => {
    const m: Record<string, Lot | undefined> = {}
    lots.forEach((l) => (m[l.id] = l))
    return m
  }, [lots])
  const prodById = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Recibir mercancía">
        Cuando llega producto de una <b>compra a proveedor</b>, recíbelo aquí: capturas la cantidad que llegó, el lote
        y la caducidad, y el inventario se actualiza en ese momento. Si llegó menos, la compra queda parcial; si
        llegó todo, queda completa.
      </PageHead>

      {toast && !toast.ok && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }}><span>{toast.text}</span></div>}

      {/* 1) Compras pendientes de recibir → recepción física */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Icon name="download" />
          <div className="eyebrow" style={{ margin: 0 }}>Compras pendientes de recibir · {pendientes.length}</div>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Tipo · proveedor</th><th>Pedido</th><th>Recibido</th><th>Pendiente</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pendientes.map((o) => (
                <tr key={o.id} data-testid="compra-pendiente">
                  <td data-label="Producto">{o.product_name}</td>
                  <td data-label="Tipo · proveedor">{TIPO_LABEL[o.kind]}{o.supplier && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{o.supplier}</div>}</td>
                  <td data-label="Pedido" className="mono">{o.qty} u</td>
                  <td data-label="Recibido" className="mono">{o.received_qty ?? 0} u</td>
                  <td data-label="Pendiente" className="mono" style={{ color: 'var(--warn)', fontWeight: 700 }}>{pendingQty(o)} u</td>
                  <td data-label="Estado"><span className={'pill ' + STATUS_PILL[o.status]}>{STATUS_LABEL[o.status]}</span></td>
                  <td data-label=""><button className="btn sm" type="button" onClick={() => setReceiving(o)} data-testid="btn-recibir"><Icon name="check" /> Recibir mercancía</button></td>
                </tr>
              ))}
              {pendientes.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-3)' }}>No hay compras pendientes de recibir. Cuando Dirección registre una compra a proveedor aparecerá aquí.</td></tr>}
            </tbody>
          </table>
        </div>
        {cerradas.length > 0 && (
          <div style={{ padding: '4px 16px 14px', fontSize: 12, color: 'var(--ink-3)' }}>
            Últimas cerradas: {cerradas.map((o) => `${o.product_name} (${STATUS_LABEL[o.status].toLowerCase()})`).join(' · ')}
          </div>
        )}
      </div>

      {/* 2) Entradas excepcionales: solo Dirección, con motivo; NO es el flujo normal de almacén */}
      {isAdmin
        ? <EntradasExcepcionales products={products} onAviso={avisar} />
        : (
          <div className="sysnote">
            <Icon name="shield" />
            <span>Las <b>entradas excepcionales</b> (producto que entra sin una compra: inventario encontrado, muestra, corrección) las registra <b>Dirección</b> con motivo. Lo normal en almacén es <b>recibir mercancía</b> de una compra, arriba.</span>
          </div>
        )}

      {/* 3) Historial inmutable */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="eyebrow">Historial de movimientos</div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '-8px 0 4px' }}>No se puede editar ni borrar: cada entrada y salida queda registrada (trazabilidad).</p>
          </div>
          <ExportButton
            name="movimientos-inventario"
            style={{ marginLeft: 'auto' }}
            rows={movements.map((m) => {
              const lot = lotById[m.lot_id]
              const prod = lot ? prodById[lot.product_id] : undefined
              return { fecha: m.created_at, lote: lot?.lot_code ?? m.lot_id, producto: prod?.name ?? '', motivo: reasonLabel(m.reason), referencia: m.reference ?? '', cambio: m.change }
            })}
            columns={[
              { key: 'fecha', label: 'Fecha', format: (v) => (v ? fmtDate(v as string) : '') },
              { key: 'lote', label: 'Lote' },
              { key: 'producto', label: 'Producto' },
              { key: 'motivo', label: 'Qué pasó' },
              { key: 'referencia', label: 'Referencia' },
              { key: 'cambio', label: 'Cambio' },
            ]}
          />
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Fecha</th><th>Lote</th><th>Qué pasó</th><th>Referencia</th><th>Cambio</th></tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const lot = lotById[m.lot_id]
                const prod = lot ? prodById[lot.product_id] : undefined
                const pos = m.change >= 0
                return (
                  <tr key={m.id}>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.created_at)}</td>
                    <td data-label="Lote">
                      <span className="lc">{lot?.lot_code ?? m.lot_id}</span>
                      {prod && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{prod.name}</div>}
                    </td>
                    <td data-label="Qué pasó"><span className={'pill ' + (m.reason === 'entrada' ? 'p-ok' : 'p-neu')}>{reasonLabel(m.reason)}</span></td>
                    <td data-label="Referencia" className="mono" style={{ fontSize: 11.5 }}>{m.reference || '—'}</td>
                    <td data-label="Cambio" className="mono" style={{ color: pos ? 'var(--green-deep)' : 'var(--danger)' }}>{pos ? '+' : ''}{m.change} {Math.abs(m.change) === 1 ? 'pza' : 'pzas'}</td>
                  </tr>
                )
              })}
              {movements.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Todavía no hay movimientos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {receiving && (
        <RecibirMercanciaModal po={receiving} isAdmin={isAdmin} onClose={() => setReceiving(null)} onDone={(msg) => { setReceiving(null); avisar(true, msg) }} />
      )}
      {toast?.ok && <div className="toast show"><Icon name="check" /> {toast.text}</div>}
    </div>
  )
}

// Entrada sin compra (recibir_lote 'sin_orden'): el servidor exige Dirección y motivo; aquí se presenta
// aparte y cerrada por defecto para que nadie la confunda con la recepción normal de una compra.
function EntradasExcepcionales({ products, onAviso }: { products: ProductSafe[]; onAviso: (ok: boolean, text: string) => void }) {
  const { recibirLote } = useLots()
  const [abierto, setAbierto] = useState(false)
  const [productId, setProductId] = useState('')
  const [lotCode, setLotCode] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS_EXCEPCIONALES[0])
  const [motivoOtro, setMotivoOtro] = useState('')
  const [busy, setBusy] = useState(false)
  const { opId, renew } = useOpId()
  const motivoFinal = motivo === 'Otro' ? motivoOtro.trim() : motivo
  const valid = productId && lotCode.trim() && Number(qty) > 0 && (!hasSupabase || (!!expiry && motivoFinal.length >= 3))

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const c = cost.trim() === '' ? null : Number(cost)
    const r = await recibirLote({
      product_id: productId, lot_code: lotCode.trim(), expiry_date: expiry || null, quantity: Number(qty), location: null,
      unit_cost: c != null && c > 0 ? c : null, // vacío → la RPC usa el costo de referencia
      reason: hasSupabase ? motivoFinal : 'entrada', kind: 'sin_orden', op_id: opId,
    })
    setBusy(false)
    if (!r.ok) { onAviso(false, r.error ?? 'No se pudo registrar la entrada excepcional.'); return }
    onAviso(true, `Entrada excepcional registrada: ${lotCode.trim()} (+${qty} pzas)`)
    renew()
    setLotCode(''); setExpiry(''); setQty(''); setCost('')
  }

  return (
    <div className="card" data-testid="entradas-excepcionales">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Icon name="shield" />
        <div>
          <div className="eyebrow" style={{ margin: 0 }}>Entradas excepcionales (solo Dirección)</div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '4px 0 0' }}>Producto que entra <b>sin una compra</b>: inventario encontrado, muestra o corrección autorizada. Siempre con motivo. No es la recepción normal de almacén; la carga inicial va por Importar / Migración.</p>
        </div>
        <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} data-testid="btn-excepcional">
          {abierto ? 'Ocultar' : 'Registrar entrada excepcional'}
        </button>
      </div>
      {abierto && (
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Producto</label>
          <select style={inputStyle} value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Producto">
            <option value="">Selecciona…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="form-grid-2" style={{ marginTop: 14 }}>
            <div>
              <label style={labelStyle}>Lote</label>
              <input style={inputStyle} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Ej. MGP-90-C" />
            </div>
            <div>
              <label style={labelStyle}>Cantidad</label>
              <input style={inputStyle} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="form-grid-2" style={{ marginTop: 14 }}>
            <div>
              <label style={labelStyle}>Caducidad{hasSupabase ? ' (obligatoria)' : ''}</label>
              <input style={inputStyle} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Costo de adquisición (opcional)</label>
              <input style={inputStyle} type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Vacío = costo de referencia" />
            </div>
          </div>
          {hasSupabase && (
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Motivo (obligatorio)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {MOTIVOS_EXCEPCIONALES.map((m) => <button key={m} type="button" className={'fchip' + (motivo === m ? ' on' : '')} onClick={() => setMotivo(m)}>{m}</button>)}
              </div>
              {motivo === 'Otro' && <input style={{ ...inputStyle, marginTop: 8 }} value={motivoOtro} onChange={(e) => setMotivoOtro(e.target.value)} placeholder="Describe el motivo" />}
            </div>
          )}
          <button className="btn" type="button" style={{ marginTop: 18, width: '100%', opacity: valid && !busy ? 1 : 0.5, cursor: valid && !busy ? 'pointer' : 'not-allowed' }} onClick={submit} disabled={!valid || busy}>
            <Icon name="download" /> {busy ? 'Registrando…' : 'Registrar entrada excepcional'}
          </button>
        </div>
      )}
    </div>
  )
}
