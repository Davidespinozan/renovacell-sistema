// Placeholder de pantalla aún no construida. Se reemplaza por la pantalla real
// conforme las vayamos haciendo. Usa los estilos del demo (card/eyebrow/sysnote).
import React from 'react'
import { Icon } from '../app/icons'
import { getRole, getScreen, type RoleKey } from '../app/roles'

export function Placeholder({ role, screen }: { role: RoleKey; screen: string }) {
  const r = getRole(role)
  const s = getScreen(r, screen)

  return (
    <div className="grid">
      <div className="eyebrow">{r.group}</div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <span
            style={{
              width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center',
              background: 'var(--grad-green)', color: '#fff', boxShadow: 'var(--glow)', flex: 'none',
            }}
          >
            <Icon name={s.icon} style={{ width: 22, height: 22 }} />
          </span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>
              Pantalla de {r.label}
            </div>
          </div>
        </div>

        {r.ready ? (
          <div className="sysnote">
            <Icon name="shield" />
            <span>
              Pantalla en construcción. El shell (layout, navegación por rol y “ver como”)
              ya está listo; esta vista se implementará con datos mock conectados por hooks.
            </span>
          </div>
        ) : (
          <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
            <Icon name="clock" />
            <span>
              <b>Pendiente de spec.</b> {r.label} casi no aparece en el demo; la construimos
              cuando nos pases su especificación.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
