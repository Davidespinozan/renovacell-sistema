// Pantalla de Login (UI real, mock por dentro). Dos paneles: marca (verde
// profundo) + formulario. Al entrar setea rol/usuario/capabilities (useAuth).
import React, { useEffect, useState } from 'react'
import { motivoCierreSesion } from '../auth/suspension'
import { Mail, Lock, LogIn, Sparkles } from 'lucide-react'
import { urlVerificacionMedica } from '../data/ops/contactoEnlace'
import { useAuth } from '../auth/useAuth'
import { BrandLogo } from '../app/BrandLogo'

const input: React.CSSProperties = {
  width: '100%', padding: '11px 12px 11px 38px', border: '1px solid var(--line)',
  borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', backgroundColor: 'var(--cp-surface)',
}
const iconStyle: React.CSSProperties = { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(255,255,255,.55)' }

export function Login() {
  const { signIn, recoverPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(() => motivoCierreSesion())
  // UN solo registro de doctores: el formulario de la landing (datos, teléfono, domicilio, INE y aviso de privacidad).
  // Aquí antes había un formulario corto (nombre, correo, cédula, contraseña) que dejaba fuera la identidad y el
  // teléfono; quien llega con #registro se manda directo al registro completo.
  const [view, setView] = useState<'login' | 'recover'>('login')
  useEffect(() => { if (typeof window !== 'undefined' && /registro/i.test(window.location.hash)) window.location.replace(urlVerificacionMedica()) }, [])
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await signIn(email, password)
    if (!res.ok) setError(res.error ?? 'No se pudo iniciar sesión.')
    setBusy(false)
  }

  const recover = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return
    await recoverPassword(email) // con backend envía el correo real de restablecimiento
    setSent(true)
  }

  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
    color: 'var(--green-soft)', fontSize: 12.5, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', minHeight: 44,
  }

  return (
    <div className="login-wrap">
      {/* Panel de marca (desktop) */}
      <aside className="login-brand">
        <div className="lb-top">
          <BrandLogo />
          <div>
            <div className="bn">Renovacell</div>
            <div className="bs">Tecnologías Antiedad</div>
          </div>
        </div>
        <div className="lb-mid">
          <h2>Bienvenido a Renovacell</h2>
          <p>Acceso para el equipo y médicos verificados. Inicia sesión para entrar a tu espacio.</p>
        </div>
        <div className="lb-foot">Acceso seguro</div>
      </aside>

      {/* Panel del formulario */}
      <div className="login-panel">
        <div className="login-card">
          <div className="login-mini-brand">
            <BrandLogo />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>Renovacell</div>
              <div style={{ fontSize: 11, letterSpacing: '.04em', color: 'rgba(255,255,255,.6)' }}>Tecnologías Antiedad</div>
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

                {error && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

                <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 16, opacity: busy ? 0.7 : 1 }}><LogIn size={16} /> {busy ? 'Entrando…' : 'Entrar'}</button>
              </form>

              <div style={{ textAlign: 'center', marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.12)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 8 }}>¿Primera vez y eres médico?</div>
                <a className="btn" href={urlVerificacionMedica()} data-testid="ir-registro-medico" style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.22)', color: '#fff', boxShadow: 'none', textDecoration: 'none', justifyContent: 'center' }}>
                  <Sparkles size={15} /> Verifica tu cédula y crea tu cuenta
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>Recuperar contraseña</h1>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', margin: '4px 0 20px' }}>
                Si el envío de correos está habilitado, recibirás un enlace para restablecerla.
              </div>

              {sent ? (
                <>
                  <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)', color: 'var(--green-deep)' }}>
                    <span>Si <b>{email || 'tu correo'}</b> está registrado y el envío de correos está habilitado, recibirás las instrucciones para restablecer tu contraseña. Si no llega, contacta a Renovacell.</span>
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
