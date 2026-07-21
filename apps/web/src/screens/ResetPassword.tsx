// Pantalla de NUEVA contraseña (#2). Se muestra cuando el usuario llega por el
// enlace de recuperación (Supabase ya estableció una sesión de recovery). Fija la
// contraseña con updateUser({password}) y regresa al login.
import React, { useState } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRole } from '../auth/RoleContext'
import { BrandLogo } from '../app/BrandLogo'

const input: React.CSSProperties = {
  width: '100%', padding: '11px 12px 11px 38px', border: '1px solid var(--line)',
  borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff',
}
const iconStyle: React.CSSProperties = { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(255,255,255,.55)' }

export function ResetPassword() {
  const { setMode } = useRole()
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (pass.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (pass !== pass2) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pass })
    if (error) { setError(error.message); setBusy(false); return }
    await supabase.auth.signOut()
    setDone(true)
    setBusy(false)
    // Limpia el hash del enlace de recuperación.
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname)
  }

  return (
    <div className="login-wrap">
      <aside className="login-brand">
        <div className="lb-top">
          <BrandLogo />
          <div><div className="bn">Renovacell</div><div className="bs">Sistema operativo</div></div>
        </div>
        <div className="lb-mid">
          <h2>Restablece tu contraseña</h2>
          <p>Define una nueva contraseña para tu cuenta y vuelve a iniciar sesión.</p>
        </div>
        <div className="lb-foot">Acceso seguro</div>
      </aside>

      <div className="login-panel">
        <div className="login-card">
          <div className="login-mini-brand">
            <BrandLogo />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>Renovacell</div>
              <div style={{ fontSize: 11, letterSpacing: '.04em', color: 'rgba(255,255,255,.6)' }}>Sistema operativo</div>
            </div>
          </div>

          {done ? (
            <>
              <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }}>
                <ShieldCheck size={16} /><span>Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.</span>
              </div>
              <button type="button" className="btn" style={{ width: '100%', marginTop: 16 }} onClick={() => setMode('login')}>Ir a iniciar sesión</button>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>Nueva contraseña</h1>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: '4px 0 20px' }}>Escribe tu nueva contraseña.</div>
              <form onSubmit={submit}>
                <label style={lbl}>Nueva contraseña</label>
                <div style={{ position: 'relative', margin: '6px 0 14px' }}>
                  <Lock size={16} style={iconStyle} />
                  <input style={input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" autoFocus />
                </div>
                <label style={lbl}>Confirmar contraseña</label>
                <div style={{ position: 'relative', margin: '6px 0 4px' }}>
                  <Lock size={16} style={iconStyle} />
                  <input style={input} type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="••••••••" />
                </div>
                {error && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
                <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 16, opacity: busy ? 0.7 : 1 }}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
