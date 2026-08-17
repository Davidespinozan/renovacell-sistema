// Confirmación de acciones DESTRUCTIVAS con red de seguridad (lección de sala-studio):
// para lo irreversible (borrar un cliente con historial), un window.confirm se aprieta
// por accidente. Aquí, además del "Cancelar/Confirmar", se puede exigir TECLEAR una
// palabra ("ELIMINAR") — así un clic rápido nunca borra algo por error.
import React, { useState } from 'react'
import { Icon } from './icons'

export function ConfirmModal({ title, message, confirmLabel = 'Confirmar', requireType, onConfirm, onClose }: {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  requireType?: string          // palabra que hay que teclear para habilitar el botón
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const ok = !requireType || typed.trim().toUpperCase() === requireType.toUpperCase()

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="mhead">
          <div><h3>{title}</h3></div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>{message}</div>
          {requireType && (
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>Escribe <b style={{ color: 'var(--danger)' }}>{requireType}</b> para confirmar</label>
              <input
                autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && ok) { onConfirm(); onClose() } }}
                placeholder={requireType}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 6 }}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!ok}
              style={{ background: 'var(--danger)', ...(ok ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }}
              onClick={() => { if (ok) { onConfirm(); onClose() } }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
