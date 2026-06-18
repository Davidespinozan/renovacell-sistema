// Barra DEV de previsualización ("Ver como"). Permite previsualizar la landing
// pública, el login y la app como cualquier rol. Es herramienta de desarrollo
// (con login real, el rol vendría del perfil); por ahora siempre visible.
import React from 'react'
import { availableRoles } from './roles'
import { useRole } from '../auth/RoleContext'

export function DevBar() {
  const { mode, role, setMode, setRole } = useRole()

  return (
    <div className="devbar">
      <span className="devbar-tag">DEV · Ver como</span>
      <button type="button" className={'devchip' + (mode === 'landing' ? ' on' : '')} onClick={() => setMode('landing')}>Landing</button>
      <button type="button" className={'devchip' + (mode === 'login' ? ' on' : '')} onClick={() => setMode('login')}>Login</button>
      <span className="devbar-sep" />
      {availableRoles().map((r) => (
        <button
          key={r.key}
          type="button"
          className={'devchip' + (mode === 'app' && role === r.key ? ' on' : '')}
          onClick={() => setRole(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
