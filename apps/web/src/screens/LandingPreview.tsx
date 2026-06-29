// Landing PÚBLICA (anónima) servida en iframe desde /landing/index.html. Botón
// flotante "Acceder al sistema" para entrar al login (en producción será el CTA
// de la propia landing).
import React from 'react'
import { LogIn } from 'lucide-react'
import { useRole } from '../auth/RoleContext'

export function LandingPreview() {
  const { setMode } = useRole()
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--hueso)' }}>
      <iframe
        src="/landing/index.html"
        title="Landing pública Renovacell"
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
      <button
        type="button"
        className="btn"
        onClick={() => setMode('login')}
        style={{ position: 'fixed', top: 16, right: 16, zIndex: 20, boxShadow: 'var(--sh-lg)' }}
      >
        <LogIn size={16} /> Acceder al sistema
      </button>
    </div>
  )
}
