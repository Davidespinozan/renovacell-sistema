// Frontera W1/W3 · Guía de paquetería activa en un pedido EMPACADO. Mientras exista, el
// servidor impide cancelar el pedido. Dirección puede registrar que la anuló MANUALMENTE
// en el portal de la paquetería (referencia obligatoria). Una guía en estado DESCONOCIDO
// no se anula aquí: requiere reconciliación (W3) y sigue bloqueando la cancelación.
import React, { useEffect, useState } from 'react'
import { Icon } from '../../app/icons'
import { hasSupabase, supabase } from '../../lib/supabase'
import { runW1Command } from '../../data/ops/w1Command'
import { useOpId } from '../../data/hooks/useOpId'

interface Attempt { id: string; status: string; tracking_number: string | null; provider: string | null }

export function GuiaManualVoid({ orderId }: { orderId: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)
  const [ref, setRef] = useState('')
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { opId, renew } = useOpId()

  const load = async () => {
    if (!hasSupabase) { setAttempts([]); return }
    const { data } = await supabase.from('shipping_attempts').select('id, status, tracking_number, provider').eq('order_id', orderId) as unknown as { data: Attempt[] | null }
    setAttempts((data ?? []).filter((a) => ['pending', 'succeeded', 'unknown_requires_reconciliation'].includes(a.status)))
  }
  useEffect(() => { void load() }, [orderId])

  if (!attempts || attempts.length === 0) return null
  const a = attempts[0]

  const anular = async () => {
    if (!ref.trim() || busy) return
    setBusy(true); setErr(null)
    const r = await runW1Command('anular_guia_manual', { p_op_id: opId, p_attempt_id: a.id, p_reference: ref.trim(), p_evidence: evidence.trim() || undefined }, opId)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    renew(); setRef(''); setEvidence('')
    await load()
  }

  const box: React.CSSProperties = { marginTop: 14, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--hueso, #f8f9f6)' }
  const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 5 }
  if (a.status === 'unknown_requires_reconciliation') {
    return <div className="sysnote" style={box}><Icon name="truck" /><span>La guía de este pedido quedó en <b>estado desconocido</b> con la paquetería. Requiere reconciliación antes de poder cancelar el pedido.</span></div>
  }
  if (a.status === 'pending') {
    return <div className="sysnote" style={box}><Icon name="truck" /><span>Hay una guía <b>en proceso</b> para este pedido. Espera a que termine antes de cancelar.</span></div>
  }
  return (
    <div style={box}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <Icon name="truck" /> Guía activa {a.provider ? `(${a.provider.toUpperCase()}) ` : ''}<b className="mono">{a.tracking_number ?? '—'}</b>. Para cancelar el pedido primero anúlala en el portal de la paquetería y registra aquí la referencia.
      </div>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Referencia de la anulación (obligatoria)</label>
      <input style={fld} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Folio / confirmación del portal" />
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', display: 'block', marginTop: 8 }}>Evidencia (opcional)</label>
      <input style={fld} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Nota o nombre de la captura" />
      {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{err}</span></div>}
      <div style={{ textAlign: 'right', marginTop: 10 }}>
        <button className="btn sm" type="button" disabled={!ref.trim() || busy} onClick={anular} style={!ref.trim() || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {busy ? 'Registrando…' : 'Registrar guía anulada manualmente'}
        </button>
      </div>
    </div>
  )
}
