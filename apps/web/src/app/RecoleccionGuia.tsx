// PAQ-B · Recolección de una guía de paquetería (solo logística): la guía se genera SIN recolección; aquí se puede pedir
// que la paquetería pase por el paquete, ver la confirmación o cancelarla. Si prefieren llevarlo a sucursal, no se toca.
import React, { useState } from 'react'
import { Icon } from './icons'
import { fmtDate } from '../lib/format'
import { agendarRecoleccion, ahoraLocalOrigen, cancelarRecoleccion, errorRecoleccion, type RecoleccionAgendada, type RecoleccionSolicitada } from '../data/shipping/recoleccion'

const campo: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)' }
const etq: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 3 }

export function RecoleccionGuia({ orderId, agendada, onCambio, agendar = agendarRecoleccion, cancelar = cancelarRecoleccion, ahora = () => Date.now() }: {
  orderId: string
  agendada: RecoleccionAgendada | null
  onCambio: () => void
  agendar?: typeof agendarRecoleccion
  cancelar?: typeof cancelarRecoleccion
  ahora?: () => number
}) {
  const { hoy, ahoraMin } = ahoraLocalOrigen(ahora())
  const [abierto, setAbierto] = useState(false)
  const [f, setF] = useState<RecoleccionSolicitada>({ date: hoy, ready: '', close: '', location: 'Recepción', instructions: '' })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecha, setHecha] = useState<string | null>(null)
  const motivo = errorRecoleccion(f, hoy, ahoraMin)

  const pedir = async () => {
    if (motivo || ocupado) return
    setOcupado(true); setError(null)
    const r = await agendar(orderId, f)
    setOcupado(false)
    if (r.ok) { setHecha(r.confirmation); setAbierto(false); onCambio() }
    else setError(r.error)
  }
  const quitar = async () => {
    if (ocupado) return
    if (!window.confirm('¿Cancelar la recolección agendada con la paquetería?')) return
    setOcupado(true); setError(null)
    const r = await cancelar(orderId, 'Cancelada por el remitente')
    setOcupado(false)
    if (r.ok) { setHecha(null); onCambio() } else setError(r.error ?? 'No se pudo cancelar.')
  }

  const conf = agendada?.confirmation ?? hecha
  if (conf) {
    return (
      <div style={{ marginTop: 8, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-testid="recoleccion-agendada">
        <span className="pill p-ok"><Icon name="truck" style={{ width: 12, height: 12 }} /> Recolección agendada</span>
        <span>Confirmación <b className="mono">{conf}</b>{agendada?.date ? <> · {fmtDate(agendada.date + 'T12:00:00Z')} de {agendada.ready} a {agendada.close} · {agendada.location}</> : null}</span>
        <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto', color: 'var(--danger)' }} disabled={ocupado} onClick={quitar} data-testid="recoleccion-cancelar">{ocupado ? 'Cancelando…' : 'Cancelar recolección'}</button>
        {error && <div role="alert" style={{ flexBasis: '100%', color: 'var(--danger)' }}>{error}</div>}
      </div>
    )
  }
  if (!abierto) {
    return (
      <div style={{ marginTop: 8 }}>
        <button className="btn ghost sm" type="button" onClick={() => { setAbierto(true); setError(null) }} data-testid="recoleccion-abrir"><Icon name="truck" style={{ width: 13, height: 13 }} /> Agendar recolección</button>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 8, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12 }} data-testid="recoleccion-form">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
        <label><span style={etq}>Fecha</span><input style={campo} type="date" min={hoy} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Fecha de recolección" /></label>
        <label><span style={etq}>Listo desde</span><input style={campo} type="time" value={f.ready} onChange={(e) => setF({ ...f, ready: e.target.value })} aria-label="Listo desde" /></label>
        <label><span style={etq}>Pueden pasar hasta</span><input style={campo} type="time" value={f.close} onChange={(e) => setF({ ...f, close: e.target.value })} aria-label="Pueden pasar hasta" /></label>
        <label><span style={etq}>Dónde se recoge</span><input style={campo} maxLength={80} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} aria-label="Dónde se recoge" /></label>
      </div>
      <label style={{ display: 'block', marginTop: 8 }}><span style={etq}>Instrucciones para el mensajero (opcional)</span><input style={campo} maxLength={80} value={f.instructions ?? ''} onChange={(e) => setF({ ...f, instructions: e.target.value })} aria-label="Instrucciones" placeholder="Tocar el timbre, preguntar por Almacén…" /></label>
      {(f.ready || f.close) && motivo && <div style={{ fontSize: 12, color: 'var(--warn, #b45309)', marginTop: 6 }} data-testid="recoleccion-motivo">{motivo}</div>}
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button className="btn ghost sm" type="button" onClick={() => setAbierto(false)} disabled={ocupado}>Cerrar</button>
        <button className="btn sm" type="button" onClick={pedir} disabled={!!motivo || ocupado} style={motivo || ocupado ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} data-testid="recoleccion-pedir">{ocupado ? 'Agendando…' : 'Agendar con la paquetería'}</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>La paquetería puede rechazar un horario que no atiende; en ese caso verás su motivo y podrás ajustar.</div>
    </div>
  )
}
