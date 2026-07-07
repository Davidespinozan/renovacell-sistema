// ADMIN · Equipo / Usuarios. Administración es la autoridad: da de alta usuarios
// (con contraseña), edita nombre/rol, prende/apaga capabilities, suspende, elimina
// y restablece contraseñas. Con backend, las acciones que tocan la cuenta de auth
// pasan por la Edge Function `staff-admin` (service role, solo admin).
import React, { useState } from 'react'
import { UserPlus, X, Ban, RotateCcw, Pencil, Trash2, KeyRound, Check } from 'lucide-react'
import { initials, avatarColor } from '../../lib/format'
import { useTeam, type TeamUser } from '../../data/hooks/useTeam'
import { suggestCompanyEmail } from '../../data/store/teamStore'
import { getRole, ROLES, CAPABILITIES, type RoleKey } from '../../app/roles'

const STAFF_ROLES = ROLES.filter((r) => r.isStaff)
const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
const randomPass = () => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789'
  const buf = new Uint32Array(10)
  ;(globalThis.crypto ?? { getRandomValues: (x: Uint32Array) => x }).getRandomValues(buf)
  return 'Rc' + [...buf].map((n) => a[n % a.length]).join('').slice(0, 8)
}

function Avatar({ name }: { name: string }) {
  return <div className="avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
}

export function Equipo() {
  const { data: users, addUser, updateUser, removeUser, setPassword, toggleCapability, setActive } = useTeam()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TeamUser | null>(null)
  const [pwFor, setPwFor] = useState<TeamUser | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3200) }

  const onDelete = async (u: TeamUser) => {
    if (!window.confirm(`¿Eliminar a ${u.name}? Perderá el acceso al sistema. Esta acción no se puede deshacer.`)) return
    const r = await removeUser(u.id)
    flash(r.ok ? `Usuario eliminado: ${u.name}` : `No se pudo eliminar: ${r.error}`)
  }

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

          {/* Acciones sobre la cuenta */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn ghost sm" type="button" onClick={() => setEditing(u)}><Pencil size={14} /> Editar</button>
            <button className="btn ghost sm" type="button" onClick={() => setPwFor(u)}><KeyRound size={14} /> Contraseña</button>
            <button className="btn ghost sm" type="button" style={{ color: u.active ? 'var(--danger)' : 'var(--green-deep)' }} onClick={() => setActive(u.id, !u.active)}>
              {u.active ? <><Ban size={14} /> Suspender</> : <><RotateCcw size={14} /> Reactivar</>}
            </button>
            <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => onDelete(u)}><Trash2 size={14} /> Eliminar</button>
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
            </div>
          </div>
        </div>
      ))}

      {open && <NewUser onClose={() => setOpen(false)} onSave={addUser} onDone={(m) => flash(m)} />}
      {editing && <EditUser user={editing} onClose={() => setEditing(null)} onSave={updateUser} onDone={(m) => flash(m)} />}
      {pwFor && <PasswordModal user={pwFor} onClose={() => setPwFor(null)} onSave={setPassword} onDone={(m) => flash(m)} />}
      {toast && <div className="toast show"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function NewUser({ onClose, onSave, onDone }: {
  onClose: () => void
  onSave: (i: { name: string; role: RoleKey; email: string; password: string }) => Promise<{ ok: boolean; error?: string }>
  onDone: (m: string) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<RoleKey>('warehouse')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const valid = name.trim() !== '' && emailOk && password.length >= 6

  const save = async () => {
    if (!valid || busy) return
    setBusy(true); setErr(null)
    const res = await onSave({ name: name.trim(), role, email: email.trim(), password })
    setBusy(false)
    if (res.ok) { onDone(`Usuario creado: ${name.trim()} · contraseña: ${password}`); onClose() }
    else setErr(res.error ?? 'No se pudo crear el usuario.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Nuevo usuario</h3><div className="ms">Define correo, rol y una contraseña inicial (comunícasela al trabajador).</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" />

          <label style={label}>Correo de acceso</label>
          <input style={input} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null) }} placeholder="correo@empresa.com o el suyo" />
          <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} disabled={!name.trim()} onClick={() => { setEmail(suggestCompanyEmail(name)); setErr(null) }}>
            Sugerir correo de empresa (@renovacell.mx)
          </button>

          <label style={label}>Contraseña inicial</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...input, marginTop: 0 }} value={password} onChange={(e) => { setPassword(e.target.value); setErr(null) }} placeholder="mínimo 6 caracteres" />
            <button type="button" className="btn ghost sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setPassword(randomPass())}>Generar</button>
          </div>

          <label style={label}>Rol base</label>
          <select style={input} value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>

          <div className="sysnote" style={{ marginTop: 14 }}>
            <span>Tras crearlo, asígnale responsabilidades (Diseño, Comercial…) desde su tarjeta. La contraseña se la das tú al trabajador; él puede cambiarla después.</span>
          </div>
          {err && <div className="sysnote" style={{ marginTop: 10, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid || busy} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
              <UserPlus size={15} /> {busy ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditUser({ user, onClose, onSave, onDone }: {
  user: TeamUser
  onClose: () => void
  onSave: (id: string, patch: { name?: string; role?: RoleKey }) => Promise<{ ok: boolean; error?: string }>
  onDone: (m: string) => void
}) {
  const [name, setName] = useState(user.name)
  const [role, setRole] = useState<RoleKey>(user.role)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true); setErr(null)
    const res = await onSave(user.id, { name: name.trim(), role })
    setBusy(false)
    if (res.ok) { onDone(`Usuario actualizado: ${name.trim()}`); onClose() }
    else setErr(res.error ?? 'No se pudo actualizar.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Editar usuario</h3><div className="ms">{user.email}</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellido" autoFocus />
          <label style={label}>Rol base</label>
          <select style={input} value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          {err && <div className="sysnote" style={{ marginTop: 10, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!name.trim() || busy} style={!name.trim() || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PasswordModal({ user, onClose, onSave, onDone }: {
  user: TeamUser
  onClose: () => void
  onSave: (id: string, password: string) => Promise<{ ok: boolean; error?: string }>
  onDone: (m: string) => void
}) {
  const [password, setPass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (password.length < 6 || busy) return
    setBusy(true); setErr(null)
    const res = await onSave(user.id, password)
    setBusy(false)
    if (res.ok) { onDone(`Contraseña de ${user.name} actualizada: ${password}`); onClose() }
    else setErr(res.error ?? 'No se pudo cambiar la contraseña.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Restablecer contraseña</h3><div className="ms">{user.name} · {user.email}</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nueva contraseña</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ ...input, marginTop: 0 }} value={password} onChange={(e) => { setPass(e.target.value); setErr(null) }} placeholder="mínimo 6 caracteres" autoFocus />
            <button type="button" className="btn ghost sm" style={{ whiteSpace: 'nowrap' }} onClick={() => setPass(randomPass())}>Generar</button>
          </div>
          <div className="sysnote" style={{ marginTop: 14 }}><span>Comunícale la nueva contraseña al trabajador. Él la puede cambiar después desde “¿Olvidaste tu contraseña?”.</span></div>
          {err && <div className="sysnote" style={{ marginTop: 10, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={password.length < 6 || busy} style={password.length < 6 || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
              <KeyRound size={15} /> {busy ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
