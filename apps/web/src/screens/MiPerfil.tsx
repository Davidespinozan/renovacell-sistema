// MI PERFIL — edición básica del propio usuario (no es red social): foto, nombre
// visible y contraseña. Mock: la foto/nombre viven en la sesión; la contraseña
// se confirma en falso. Con Supabase = update de auth + profiles.
import React, { useState } from 'react'
import { X, Camera, Check } from 'lucide-react'
import { initials, avatarColor } from '../lib/format'
import { useRole } from '../auth/RoleContext'

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateProfile } = useRole()
  const [name, setName] = useState(user?.name ?? '')
  const [avatar, setAvatar] = useState(user?.avatarUrl ?? '')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  const onFile = (f: File | undefined) => {
    if (!f) return
    const r = new FileReader()
    r.onload = () => setAvatar(String(r.result))
    r.readAsDataURL(f)
  }

  const pwError = pw && pw !== pw2 ? 'Las contraseñas no coinciden.' : null

  const save = () => {
    if (pwError) return
    updateProfile({ name: name.trim() || user?.name, avatarUrl: avatar || undefined })
    setToast(pw ? 'Perfil y contraseña actualizados.' : 'Perfil actualizado.')
    window.setTimeout(() => { setToast(null); onClose() }, 1100)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Mi perfil</h3><div className="ms">Edita lo básico de tu cuenta.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          {/* Foto */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {avatar
              ? <img src={avatar} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line)' }} />
              : <div className="avatar" style={{ width: 64, height: 64, fontSize: 22, background: avatarColor(name || 'U') }}>{initials(name || 'U')}</div>}
            <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
              <Camera size={14} /> {avatar ? 'Cambiar foto' : 'Subir foto'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>

          <label style={label}>Nombre visible</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Cambiar contraseña</div>
            <input style={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Nueva contraseña" />
            <input style={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirmar contraseña" />
            {pwError && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{pwError}</div>}
          </div>

          {toast && <div className="sysnote" style={{ marginTop: 14 }}><Check size={16} /> <span>{toast}</span></div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={Boolean(pwError)} style={pwError ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
              <Check size={15} /> Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
