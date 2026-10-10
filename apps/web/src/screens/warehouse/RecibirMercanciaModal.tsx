// UX-2 · RECIBIR MERCANCÍA contra una compra a proveedor / producción interna. Es el ÚNICO lugar
// donde la compra se vuelve inventario: el comando W1 `recibir_lote` ('orden') da de alta el lote
// (código + caducidad + cantidad real), el movimiento de entrada y el acumulado de la orden en UNA
// transacción. Parcial y acumulado; nunca supera lo pendiente; el op_id estable evita duplicar al
// reintentar. Excedente y cierre incompleto: solo Dirección, con motivo. Lo usan Almacén (pantalla
// "Recibir mercancía") y Dirección ("Compras a proveedores") sin duplicar código.
import React, { useState } from 'react'
import { PackageCheck, X } from 'lucide-react'
import { useLots } from '../../data/hooks/useLots'
import { useOpId } from '../../data/hooks/useOpId'
import { hasSupabase } from '../../lib/supabase'
import { cerrarOrdenCompra, pendingQty, isOpen, markReceivedLocal, type PurchaseOrder } from '../../data/store/comprasStore'

export const STATUS_LABEL: Record<PurchaseOrder['status'], string> = { pendiente: 'Pendiente de recibir', parcial: 'Recibida parcial', recibida: 'Recibida completa', cerrada_incompleta: 'Cerrada incompleta' }
export const STATUS_PILL: Record<PurchaseOrder['status'], string> = { pendiente: 'p-warn', parcial: 'p-blue', recibida: 'p-ok', cerrada_incompleta: 'p-neu' }
export const TIPO_LABEL: Record<PurchaseOrder['kind'], string> = { compra: 'Compra a proveedor', produccion: 'Producción interna' }

const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 6 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

export function RecibirMercanciaModal({ po, isAdmin, onClose, onDone }: {
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
  const { opId } = useOpId()   // una intención = un op_id (reintentar NO duplica)
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
      onDone(`Orden cerrada incompleta (faltaron ${pend} u). Si se necesitan, genera una compra nueva.`)
      return
    }
    const r = await recibirLote({
      product_id: po.product_id, lot_code: lotCode.trim(), expiry_date: expiry, quantity: n, location: null,
      unit_cost: po.unit_cost, replenishment_id: po.id, kind: mode === 'excedente' ? 'excedente' : 'orden',
      reason: mode === 'excedente' ? reason : undefined, evidence: evidence.trim() || null, op_id: opId,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'No se pudo recibir la mercancía.'); return }
    if (!hasSupabase && mode === 'recibir') markReceivedLocal(po.id, n)
    onDone(mode === 'excedente'
      ? 'Excedente registrado como entrada separada (no suma a la compra).'
      : r.replenishment_status === 'parcial' ? `Recepción parcial registrada. Pendiente de recibir: ${r.pending_qty ?? pend - n} u.` : 'Mercancía recibida. Compra completa: ya está en inventario.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="recibir-modal">
        <div className="mhead">
          <div>
            <h3>{mode === 'cerrar' ? 'Cerrar compra incompleta' : mode === 'excedente' ? 'Registrar excedente' : 'Recibir mercancía'}</h3>
            <div className="ms">{po.product_name} · {TIPO_LABEL[po.kind]}{po.supplier ? ` · ${po.supplier}` : ''} · recibido {po.received_qty ?? 0}/{po.qty} u{abierta ? ` · pendiente ${pend} u` : ''}</div>
          </div>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>
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
              <input style={fld} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="p. ej. LT-2026-014" autoFocus aria-label="Código de lote" />
              <label style={lbl}>Caducidad (obligatoria)</label>
              <input type="date" style={fld} value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Caducidad" />
              <label style={lbl}>{mode === 'excedente' ? 'Cantidad excedente' : `Cantidad que llegó (máx. ${pend})`}</label>
              <input type="number" min={1} max={mode === 'recibir' ? pend : undefined} style={fld} value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Cantidad recibida" />
              {mode === 'recibir' && n > pend && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>Supera lo pendiente ({pend} u). El excedente lo registra Dirección aparte.</div>}
              {mode === 'recibir' && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>Costo unitario: el de la compra (<b className="mono">${po.unit_cost.toLocaleString('es-MX')}</b>); se hereda al lote.</div>}
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
            <span>{mode === 'cerrar' ? 'La compra queda cerrada y NO se reabre; el faltante se pide con una compra nueva.'
              : 'Al confirmar, el lote entra al inventario con su movimiento de entrada (o se suma al mismo lote si código y caducidad coinciden). La compra queda parcial o completa según lo recibido.'}</span>
          </div>
          {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 12 }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={submit} data-testid="recibir-confirmar">
              <PackageCheck size={15} /> {busy ? 'Registrando…' : err ? 'Reintentar' : mode === 'cerrar' ? 'Cerrar compra' : mode === 'excedente' ? 'Registrar excedente' : 'Confirmar recepción'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
