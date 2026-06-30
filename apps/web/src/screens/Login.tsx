// Pantalla de Login (UI real, mock por dentro). Dos paneles: marca (verde
// profundo) + formulario. Al entrar setea rol/usuario/capabilities (useAuth).
import React, { useState } from 'react'
import { Mail, Lock, LogIn } from 'lucide-react'
import { useAuth } from '../auth/useAuth'

const input: React.CSSProperties = {
  width: '100%', padding: '11px 12px 11px 38px', border: '1px solid var(--line)',
  borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff',
}
const iconStyle: React.CSSProperties = { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(255,255,255,.55)' }

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'login' | 'recover'>('login')
  const [sent, setSent] = useState(false)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const res = signIn(email, password)
    if (!res.ok) setError(res.error ?? 'No se pudo iniciar sesión.')
  }

  const recover = (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return
    setSent(true) // mock: con backend enviará el correo de restablecimiento
  }

  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
    color: 'var(--green-soft)', fontSize: 12.5, fontWeight: 600,
  }

  return (
    <div className="login-wrap">
      {/* Panel de marca (desktop) */}
      <aside className="login-brand">
        <div className="lb-top">
          <img src="/brand/logo.png" alt="Renovacell" />
          <div>
            <div className="bn">Renovacell</div>
            <div className="bs">Sistema operativo</div>
          </div>
        </div>
        <div className="lb-mid">
          <h2>Sistema operativo Renovacell</h2>
          <p>Acceso para el equipo y médicos verificados. Inicia sesión para entrar a tu espacio.</p>
        </div>
        <div className="lb-foot">Acceso seguro</div>
      </aside>

      {/* Panel del formulario */}
      <div className="login-panel">
        <div className="login-card">
          <div className="login-mini-brand">
            <img src="/brand/logo.png" alt="Renovacell" />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>Renovacell</div>
              <div style={{ fontSize: 11, letterSpacing: '.04em', color: 'rgba(255,255,255,.6)' }}>Sistema operativo</div>
            </div>
          </div>

          {view === 'login' ? (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>Iniciar sesión</h1>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: '4px 0 20px' }}>Entra con tu correo y contraseña.</div>

              <form onSubmit={submit}>
                <label style={lbl}>Correo</label>
                <div style={{ position: 'relative', margin: '6px 0 14px' }}>
                  <Mail size={16} style={iconStyle} />
                  <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" autoFocus />
                </div>

                <label style={lbl}>Contraseña</label>
                <div style={{ position: 'relative', margin: '6px 0 4px' }}>
                  <Lock size={16} style={iconStyle} />
                  <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                </div>

                <div style={{ textAlign: 'right', marginTop: 8 }}>
                  <button type="button" style={linkBtn} onClick={() => { setView('recover'); setError(null); setSent(false) }}>¿Olvidaste tu contraseña?</button>
                </div>

                {error && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

                <button className="btn" type="submit" style={{ width: '100%', marginTop: 16 }}><LogIn size={16} /> Entrar</button>
              </form>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>Recuperar contraseña</h1>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: '4px 0 20px' }}>
                Te enviaremos un enlace para restablecerla a tu correo.
              </div>

              {sent ? (
                <>
                  <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }}>
                    <span>Si <b>{email || 'tu correo'}</b> está registrado, te enviamos las instrucciones para restablecer tu contraseña. Revisa tu bandeja.</span>
                  </div>
                  <button type="button" className="btn" style={{ width: '100%', marginTop: 16 }} onClick={() => { setView('login'); setSent(false) }}>Volver a iniciar sesión</button>
                </>
              ) : (
                <form onSubmit={recover}>
                  <label style={lbl}>Correo</label>
                  <div style={{ position: 'relative', margin: '6px 0 4px' }}>
                    <Mail size={16} style={iconStyle} />
                    <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" autoFocus />
                  </div>
                  <button className="btn" type="submit" style={{ width: '100%', marginTop: 16 }} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} >Enviar instrucciones</button>
                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <button type="button" style={linkBtn} onClick={() => { setView('login'); setError(null) }}>Volver a iniciar sesión</button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
