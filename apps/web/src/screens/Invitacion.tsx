// INVITACIONES · Página pública /invitacion#<secreto>: el cliente que ya compra crea su cuenta con el enlace que le
// mandó Dirección o su vendedor. La cuenta nace ligada a su expediente y VERIFICADA. Al terminar inicia sesión aquí
// mismo (mismo origen que el sistema) y entra a su portal.
import React, { useEffect, useState } from 'react'
import { BrandLogo } from '../app/BrandLogo'
import { hasSupabase, supabase } from '../lib/supabase'
import { aceptarInvitacion as aceptarPorDefecto, verInvitacion as verPorDefecto } from '../data/ops/invitacion'

const tokenDeUrl = (): string => (typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').trim() : '')
async function entrar(email: string, password: string): Promise<boolean> {
  if (!hasSupabase) return false
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return !error
}

type Estado = { fase: 'cargando' } | { fase: 'invalida'; mensaje: string } | { fase: 'form'; nombre: string; email: string } | { fase: 'lista' }

export function Invitacion({ ver = verPorDefecto, aceptar = aceptarPorDefecto, iniciar = entrar, token = tokenDeUrl() }: {
  ver?: typeof verPorDefecto; aceptar?: typeof aceptarPorDefecto; iniciar?: (e: string, p: string) => Promise<boolean>; token?: string
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [email, setEmail] = useState(''); const [pass, setPass] = useState(''); const [pass2, setPass2] = useState(''); const [acepta, setAcepta] = useState(false)
  const [error, setError] = useState<string | null>(null); const [enviando, setEnviando] = useState(false)
  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!token) { if (vivo) setEstado({ fase: 'invalida', mensaje: 'El enlace está incompleto. Ábrelo completo desde el mensaje que te enviamos.' }); return }
      const r = await ver(token)
      if (!vivo) return
      if (!r.ok) { setEstado({ fase: 'invalida', mensaje: r.mensaje }); return }
      if (r.data.estado !== 'valida') { setEstado({ fase: 'invalida', mensaje: r.data.message ?? 'Esta invitación ya no es válida.' }); return }
      setEmail(r.data.email ?? ''); setEstado({ fase: 'form', nombre: r.data.nombre ?? '', email: r.data.email ?? '' })
    })()
    return () => { vivo = false }
  }, [token, ver])
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('El correo no parece válido.'); return }
    if (pass.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (pass !== pass2) { setError('Las contraseñas no coinciden.'); return }
    if (!acepta) { setError('Para continuar, acepta el Aviso de privacidad.'); return }
    setEnviando(true); setError(null)
    const r = await aceptar(token, email.trim().toLowerCase(), pass)
    if (!r.ok) { setEnviando(false); setError(r.mensaje); return }
    setEstado({ fase: 'lista' })
    if (await iniciar(email.trim().toLowerCase(), pass)) window.location.assign('/sistema')
    else setEnviando(false)
  }
  return (
    <div className="rc-contacto" data-testid="invitacion">
      <div className="rc-pre rc-chat--wa">
        <header className="rc-head">
          <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>
          <div className="rc-title"><div className="rc-name">Renovacell</div><div className="rc-state">Tecnologías Antiedad</div></div>
        </header>
        <div className="rc-pre-cuerpo">
          {estado.fase === 'cargando' && <div className="rc-sys" role="status">Cargando…</div>}
          {estado.fase === 'invalida' && (
            <div className="rc-pre-tarjeta" data-testid="invitacion-invalida"><h1>No pudimos abrir tu invitación</h1><p>{estado.mensaje}</p>
              <p className="rc-pre-nota">¿Ya tienes cuenta? <a href="/sistema">Inicia sesión</a></p></div>
          )}
          {estado.fase === 'lista' && (
            <div className="rc-pre-tarjeta" data-testid="invitacion-lista"><h1>¡Tu cuenta está lista!</h1><p>Ya estás verificado. Entrando a tu portal…</p>
              <p className="rc-pre-nota">Si no entra solo, <a href="/sistema">inicia sesión aquí</a> con tu correo y contraseña.</p></div>
          )}
          {estado.fase === 'form' && (
            <form className="rc-pre-tarjeta" onSubmit={enviar} noValidate data-testid="invitacion-form">
              <h1>Hola{estado.nombre ? `, ${estado.nombre}` : ''}</h1>
              <p>Crea tu contraseña para entrar a tu portal. Como ya eres cliente de Renovacell, tu cuenta queda <b>verificada</b>: verás precios, harás pedidos y hablarás con tu asesor.</p>
              <div className="rc-campo"><label htmlFor="inv-email">Correo</label><input id="inv-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} maxLength={160} /></div>
              <div className="rc-campo"><label htmlFor="inv-pass">Contraseña</label><input id="inv-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => { setPass(e.target.value); setError(null) }} placeholder="Mínimo 8 caracteres" maxLength={72} /></div>
              <div className="rc-campo"><label htmlFor="inv-pass2">Repite la contraseña</label><input id="inv-pass2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => { setPass2(e.target.value); setError(null) }} maxLength={72} /></div>
              <label className="rc-casilla"><input type="checkbox" checked={acepta} onChange={(e) => { setAcepta(e.target.checked); setError(null) }} data-testid="inv-acepta" /><span>He leído y acepto el <a href="https://renovacell.mx/landing/privacidad.html" target="_blank" rel="noopener">Aviso de privacidad</a>.</span></label>
              {error && <div role="alert" className="rc-error rc-error--inline">{error}</div>}
              <button type="submit" className="rc-pre-enviar" disabled={enviando} data-testid="inv-crear">{enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
