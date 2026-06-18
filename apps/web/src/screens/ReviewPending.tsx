// Gate de verificación: un doctor NO verificado no entra al Portal; ve esta
// pantalla. (Con Supabase, la RLS también bloquea ordenar hasta verified=true.)
import React from 'react'
import { Clock, LogOut } from 'lucide-react'
import { useAuth } from '../auth/useAuth'

export function ReviewPending() {
  const { logout } = useAuth()
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <img src="/brand/logo.png" alt="Renovacell" style={{ width: 56, height: 56, borderRadius: 14, boxShadow: 'var(--sh-md)' }} />
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--warn-bg)', color: 'var(--warn)', display: 'grid', placeItems: 'center', margin: '16px auto 0' }}>
          <Clock size={22} />
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 700, marginTop: 12 }}>Tu cuenta está en revisión</h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 8 }}>
          Estamos validando tu cédula profesional. En cuanto Administración verifique tu cuenta,
          podrás acceder al portal y realizar pedidos.
        </p>
        <button className="btn ghost" type="button" style={{ marginTop: 18 }} onClick={logout}><LogOut size={15} /> Cerrar sesión</button>
      </div>
    </div>
  )
}
