// Gate de verificación del doctor. Un doctor NO verificado no entra al Portal; ve
// esta pantalla, donde puede capturar su cédula y disparar la VERIFICACIÓN AUTOMÁTICA
// (IA + SEP): si el dictamen es `auto`, se le da acceso al instante; si es `review`,
// queda en cola de Dirección; si es `reject`, se le explica y puede reintentar.
// (Con backend, el flip de `verified` lo hace la Edge Function con service_role, ya
// que la RLS impide que el propio doctor cambie su verificación.)
import React, { useState } from 'react'
import { Clock, LogOut, ShieldCheck, ScanSearch, Sparkles } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { useRole } from '../auth/RoleContext'
import { hasSupabase, supabase } from '../lib/supabase'
import { decideVerification, simulateSep, type VerifyDecision } from '../data/verification/decide'

export function ReviewPending() {
  const { logout } = useAuth()
  const { login, user, role, capabilities } = useRole()
  const [cedula, setCedula] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<VerifyDecision | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    const c = cedula.trim()
    if (c.replace(/\D/g, '').length < 5) { setErr('Escribe tu número de cédula profesional.'); return }
    setErr(null); setBusy(true)
    const name = user?.name ?? ''
    let result: VerifyDecision
    if (hasSupabase) {
      const { data, error } = await supabase.functions.invoke('verify-cedula', { body: { cedula: c } })
      if (error || !data) { setErr('No pudimos validar en este momento. Intenta de nuevo.'); setBusy(false); return }
      result = data as VerifyDecision
    } else {
      result = decideVerification(name, simulateSep(c, name))
    }
    setBusy(false)
    setRes(result)
    // Aprobado → refleja verified en la sesión y entra al Portal.
    if (result.decision === 'auto') setTimeout(() => login(role, true, user ?? undefined, capabilities), 1300)
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <img src="/brand/logo.png" alt="Renovacell" style={{ width: 56, height: 56, borderRadius: 14, boxShadow: 'var(--sh-md)' }} />

        {res?.decision === 'auto' ? (
          <>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--ok-bg)', color: 'var(--green-deep)', display: 'grid', placeItems: 'center', margin: '16px auto 0' }}><ShieldCheck size={22} /></div>
            <h1 style={{ fontSize: 19, fontWeight: 700, marginTop: 12 }}>¡Cédula verificada!</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 8 }}>Validamos tu cédula en el registro profesional. Entrando a tu portal…</p>
          </>
        ) : res?.decision === 'review' ? (
          <>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--warn-bg)', color: 'var(--warn)', display: 'grid', placeItems: 'center', margin: '16px auto 0' }}><ScanSearch size={22} /></div>
            <h1 style={{ fontSize: 19, fontWeight: 700, marginTop: 12 }}>Tu cédula está en revisión</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 8 }}>
              Encontramos tu registro pero necesitamos una revisión de Administración. En cuanto la aprueben, tendrás acceso al portal. Te avisaremos.
            </p>
            <button className="btn ghost" type="button" style={{ marginTop: 18 }} onClick={logout}><LogOut size={15} /> Cerrar sesión</button>
          </>
        ) : (
          <>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--warn-bg)', color: 'var(--warn)', display: 'grid', placeItems: 'center', margin: '16px auto 0' }}><Clock size={22} /></div>
            <h1 style={{ fontSize: 19, fontWeight: 700, marginTop: 12 }}>Verifica tu cédula profesional</h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 8 }}>
              Renovacell vende solo a profesionales de la salud. Valida tu <b>cédula profesional</b> contra el
              registro oficial (SEP) para habilitar tu portal de compra. Es automático.
            </p>

            <input
              value={cedula}
              onChange={(e) => setCedula(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Número de cédula profesional"
              inputMode="numeric"
              style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 15, outline: 'none', marginTop: 16 }}
            />
            {res?.decision === 'reject' && (
              <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'transparent', color: 'var(--danger)', marginTop: 12, textAlign: 'left' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>No pudimos validar tu cédula.</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{res.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                <div style={{ fontSize: 12, marginTop: 6 }}>Revisa el número o escríbenos si crees que es un error.</div>
              </div>
            )}
            {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}

            <button className="btn" type="button" style={{ marginTop: 16, width: '100%' }} disabled={busy} onClick={submit}>
              <Sparkles size={15} /> {busy ? 'Validando…' : 'Verificar mi cédula'}
            </button>
            <button className="btn ghost" type="button" style={{ marginTop: 10 }} onClick={logout}><LogOut size={15} /> Cerrar sesión</button>
          </>
        )}
      </div>
    </div>
  )
}
