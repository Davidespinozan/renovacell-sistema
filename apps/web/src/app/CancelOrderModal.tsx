// Cancelación de pedido (W1 · D-03). Llama al comando del servidor `cancelar_pedido`
// con un op_id ESTABLE por intención (reintentar tras respuesta ambigua no duplica) y
// muestra el resultado REAL: reembolso pendiente de revisión y/o reingreso por confirmar.
// El staff debe escribir motivo; el doctor cancela su pedido sin pagar sin motivo.
import React, { useState } from 'react'
import { Icon } from './icons'
import { useOpId } from '../data/hooks/useOpId'
import { cancelarPedido, type CancelResult } from '../data/store/ordersStore'

const PRESETS = ['Cliente desistió', 'Pedido duplicado', 'Sin existencia', 'Error de captura']

export function CancelOrderModal({ orderId, folio, requireReason, actor, onClose, onDone }: {
  orderId: string
  folio: string
  requireReason: boolean
  actor: string
  onClose: () => void
  onDone?: (r: CancelResult) => void
}) {
  const { opId } = useOpId()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<CancelResult | null>(null)
  const valid = !requireReason || reason.trim().length >= 3

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    const r = await cancelarPedido(orderId, { opId, reason: requireReason ? reason : null, actor })
    setBusy(false)
    if (!r.ok) { setErr(r.error ?? 'No se pudo cancelar el pedido.'); return }
    setDone(r)
    onDone?.(r)
  }

  const fld: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff', marginTop: 6 }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="mhead">
          <div><h3>Cancelar pedido</h3><div className="ms">{folio}</div></div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          {done ? (
            <div className="grid" style={{ gap: 10 }}>
              <div className="sysnote"><Icon name="check" /><span>{done.status === 'applied' ? 'Pedido cancelado.' : 'Este pedido ya estaba cancelado (no se hizo nada adicional).'}</span></div>
              {done.reingresoPendiente && (
                <div className="sysnote"><Icon name="box" /><span>El producto ya estaba empacado: <b>Almacén debe confirmar el reacomodo</b> en «Devoluciones y reingresos». El inventario no reaparece hasta esa confirmación.</span></div>
              )}
              {done.refundReview === 'pendiente_revision' && (
                <div className="sysnote" style={{ background: 'var(--warn-bg, #FFF7E6)' }}><Icon name="receipt" /><span><b>Reembolso pendiente de revisión.</b> El sistema no registra que el dinero se devolvió; Dirección debe revisarlo.</span></div>
              )}
              <div style={{ textAlign: 'right' }}><button className="btn" type="button" onClick={onClose}>Listo</button></div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                ¿Cancelar <b>{folio}</b>? Si ya hay pago, quedará marcado para revisión de reembolso; si ya estaba empacado, Almacén confirmará el reingreso físico.
              </div>
              {requireReason && (
                <>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }}>Motivo (obligatorio)</label>
                  <input style={fld} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="¿Por qué se cancela?" />
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {PRESETS.map((p) => <button key={p} type="button" className={'fchip' + (reason === p ? ' on' : '')} onClick={() => setReason(p)}>{p}</button>)}
                  </div>
                </>
              )}
              {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><Icon name="x" /><span>{err}</span></div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Volver</button>
                <button className="btn" type="button" disabled={!valid || busy} onClick={submit}
                  style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : { background: 'var(--danger)' }}>
                  {busy ? 'Cancelando…' : err ? 'Reintentar' : 'Cancelar pedido'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
