// Pantalla de Login (UI real, mock por dentro). Correo + contraseña con el logo
// real. Al entrar setea el rol/usuario (mismo estado que "Ver como"). El gate de
// verificación lo aplica App (doctor no verificado → "en revisión").
import React, { useState } from 'react'
import { Mail, Lock, LogIn } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { MOCK_ACCOUNTS } from '../data/mock/accounts'

const input: React.CSSProperties = {
  width: '100%', padding: '11px 12px 11px 38px', border: '1px solid var(--line)',
  borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff',
}
const iconStyle: React.CSSProperties = { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }

export function Login() {
  const { signIn, signInAs, goLanding } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const res = signIn(email, password)
    if (!res.ok) setError(res.error ?? 'No se pudo iniciar sesión.')
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src="/brand/logo.png" alt="Renovacell" style={{ width: 64, height: 64, borderRadius: 16, boxShadow: 'var(--sh-md)' }} />
          <h1 style={{ fontSize: 21, fontWeight: 700, marginTop: 14 }}>Renovacell</h1>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', letterSpacing: '.04em' }}>Sistema operativo · acceso</div>
        </div>

        <form onSubmit={submit}>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-3)' }}>Correo</label>
          <div style={{ position: 'relative', margin: '6px 0 14px' }}>
            <Mail size={16} style={iconStyle} />
            <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" autoFocus />
          </div>

          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-3)' }}>Contraseña</label>
          <div style={{ position: 'relative', margin: '6px 0 4px' }}>
            <Lock size={16} style={iconStyle} />
            <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          {error && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

          <button className="btn" type="submit" style={{ width: '100%', marginTop: 16 }}><LogIn size={16} /> Entrar</button>
        </form>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-3)', marginBottom: 8 }}>Cuentas de prueba · contraseña <b>demo</b></div>
          <div style={{ display: 'grid', gap: 6 }}>
            {MOCK_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" className="btn ghost sm" style={{ justifyContent: 'space-between', width: '100%' }} onClick={() => signInAs(a)}>
                <span>{a.name}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{a.email}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button type="button" onClick={goLanding} style={{ background: 'none', border: 'none', color: 'var(--green-deep)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            Ver sitio público →
          </button>
        </div>
      </div>
    </div>
  )
}
