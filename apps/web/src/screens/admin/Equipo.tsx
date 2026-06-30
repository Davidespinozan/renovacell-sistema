// ADMIN · Equipo / Usuarios. Administración es la autoridad: da de alta usuarios,
// asigna su rol base y prende/apaga capabilities (responsabilidades). El menú de
// cada usuario se compone solo (rol base + capabilities). Mock; el login lee las
// capabilities de aquí, así que un cambio se refleja al entrar.
import React, { useState } from 'react'
import { UserPlus, X, Ban, RotateCcw } from 'lucide-react'
import { initials, avatarColor } from '../../lib/format'
import { useTeam } from '../../data/hooks/useTeam'
import { suggestCompanyEmail } from '../../data/store/teamStore'
import { getRole, ROLES, CAPABILITIES, type RoleKey } from '../../app/roles'

const STAFF_ROLES = ROLES.filter((r) => r.isStaff)

function Avatar({ name }: { name: string }) {
  return <div className="avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
}

export function Equipo() {
  const { data: users, addUser, toggleCapability, setActive } = useTeam()
  const [open, setOpen] = useState(false)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Administración · Equipo</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}><UserPlus size={14} /> Nuevo usuario</button>
      </div>

      {users.map((u) => (
        <div key={u.id} className="card" style={{ opacity: u.active ? 1 : 0.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={u.name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{u.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{u.email}</div>
            </div>
            <span className="pill p-neu">{getRole(u.role).label}</span>
            {!u.active && <span className="pill p-dang">Suspendido</span>}
          </div>

          <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, marginBottom: 8 }}>Responsabilidades</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {CAPABILITIES.map((c) => {
                const on = u.capabilities.includes(c.key)
                return (
                  <button key={c.key} type="button" className={'fchip' + (on ? ' on' : '')} onClick={() => toggleCapability(u.id, c.key)}>
                    {on ? '✓ ' : '+ '}{c.label}
                  </button>
                )
              })}
              <button
                type="button"
                className="btn ghost sm"
                style={{ marginLeft: 'auto', color: u.active ? 'var(--danger)' : 'var(--green-deep)' }}
                onClick={() => setActive(u.id, !u.active)}
              >
                {u.active ? <><Ban size={14} /> Suspender</> : <><RotateCcw size={14} /> Reactivar</>}
              </button>
            </div>
          </div>
        </div>
      ))}

      {open && <NewUser onClose={() => setOpen(false)} onSave={(i) => addUser(i)} />}
    </div>
  )
}

function NewUser({ onClose, onSave }: { onClose: () => void; onSave: (i: { name: string; role: RoleKey; email: string }) => { ok: boolean; error?: string } }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleKey>('warehouse')
  const [err, setErr] = useState<string | null>(null)
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const valid = name.trim() !== '' && emailOk

  const save = () => {
    const res = onSave({ name: name.trim(), role, email: email.trim() })
    if (res.ok) onClose()
    else setErr(res.error ?? 'No se pudo crear el usuario.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Nuevo usuario</h3><div className="ms">Administración da de alta, define el rol y asigna el correo de acceso.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" />

          <label style={label}>Correo de acceso</label>
          <input style={input} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null) }} placeholder="correo@empresa.com o el suyo" />
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: 8 }}
            disabled={!name.trim()}
            onClick={() => { setEmail(suggestCompanyEmail(name)); setErr(null) }}
          >
            Sugerir correo de empresa (@renovacell.mx)
          </button>

          <label style={label}>Rol base</label>
          <select style={input} value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>

          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>Tú eliges el correo: el propio del trabajador o uno con el dominio de la empresa. Tras crearlo, asígnale responsabilidades (Diseño, Comercial…) desde su tarjeta.</span>
          </div>
          {err && (
            <div className="sysnote" style={{ marginTop: 10, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}>
              <span>{err}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
              <UserPlus size={15} /> Crear usuario
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
