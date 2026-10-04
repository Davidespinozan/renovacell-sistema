// Franja global de escrituras que NO quedaron. Vive en el shell para que un rechazo
// del servidor se vea sin importar en qué pantalla ocurrió ni si la pantalla lo
// atendió. Se queda hasta que el operador la descarta: no es un aviso que se va solo.
import React, { useSyncExternalStore } from 'react'
import { AlertTriangle, HelpCircle, X } from 'lucide-react'
import { descartarFallo, getFallosSnapshot, subscribeFallos } from '../data/store/escritura'

export function FallosEscritura() {
  const fallos = useSyncExternalStore(subscribeFallos, getFallosSnapshot, getFallosSnapshot)
  if (fallos.length === 0) return null
  return (
    <div role="alert" aria-live="assertive" style={{ display: 'grid', gap: 8, margin: '0 0 14px' }}>
      {fallos.map((f) => (
        <div key={f.id} style={{
          display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 12,
          background: f.ambiguous ? 'var(--warn-bg)' : 'var(--danger-bg)',
          border: `1px solid ${f.ambiguous ? 'var(--warn)' : 'var(--danger)'}`, fontSize: 13.5,
        }}>
          <span style={{ color: f.ambiguous ? 'var(--warn)' : 'var(--danger)', marginTop: 1 }}>
            {f.ambiguous ? <HelpCircle size={16} /> : <AlertTriangle size={16} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{f.ambiguous ? 'Sin confirmar' : 'No se guardó'}: {f.que}</b>
            <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{f.error}</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={() => descartarFallo(f.id)} aria-label="Descartar aviso">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
