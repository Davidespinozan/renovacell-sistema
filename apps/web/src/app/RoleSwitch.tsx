// Switch de rol (DEV): el "ver como" del demo. Permite previsualizar cada vista.
// Desaparecerá cuando haya login real (el rol vendrá del perfil de Supabase).
import React from 'react'
import { Icon } from './icons'
import { ROLES } from './roles'
import { useRole } from '../auth/RoleContext'

export function RoleSwitch() {
  const { role, setRole } = useRole()
  return (
    <div className="switch">
      <span className="switch-lbl">Ver como</span>
      <div className="seg">
        {ROLES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={r.key === role ? 'active' : undefined}
            onClick={() => setRole(r.key)}
            title={r.group}
          >
            <Icon name={r.icon} />
            <span>{r.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
