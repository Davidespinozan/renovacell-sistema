// CX-ENLACE · Página del ENLACE DE CONTACTO (/contacto): el enlace único que el equipo comparte en grupos.
// Es el MISMO chat del sistema (ChatCanonico, misma conversación canónica) con piel de mensajería. Para conversar
// no hace falta estar verificado, pero sí dejar un prerregistro mínimo. Desde aquí se llega a la landing y a la
// verificación; al registrarse desde este mismo navegador y entrar al sistema, la conversación continúa.
// Quién atiende (su vendedor o Dirección) lo decide el servidor; esta página nunca lo sabe.
import React, { useEffect, useState } from 'react'
import { BadgeCheck, Globe } from 'lucide-react'
import { BrandLogo } from '../../app/BrandLogo'
import { supabase, hasSupabase } from '../../lib/supabase'
import { abrirVisitante, estadoVisitante, prerregistrar, validarPrerregistro, type CampoPrerregistro, type DatosPrerregistro } from '../../data/ops/visitante'
import { ChatCanonico } from './ChatCanonico'
import type { ClienteChat } from '../../data/ops/chat'

export const URL_LANDING = '/'
export const URL_VERIFICACION = '/#contacto'       // formulario de verificación de la landing (mismo origen: reusa el prerregistro)
export const URL_PRIVACIDAD = '/landing/privacidad.html'

type Paso = 'cargando' | 'formulario' | 'chat'
interface Deps { estado?: typeof estadoVisitante; abrir?: typeof abrirVisitante; registrar?: typeof prerregistrar; conSesion?: () => Promise<boolean>; cliente?: ClienteChat }

async function haySesion(): Promise<boolean> {
  if (!hasSupabase) return false
  try { const { data } = await supabase.auth.getSession(); return !!data.session } catch { return false }
}

export function Contacto({ estado = estadoVisitante, abrir = abrirVisitante, registrar = prerregistrar, conSesion = haySesion, cliente }: Deps) {
  const [paso, setPaso] = useState<Paso>('cargando')
  useEffect(() => {
    let vivo = true
    void (async () => {
      // Con sesión (doctor o personal) manda la cuenta: el servidor decide si puede conversar.
      if (await conSesion()) { if (vivo) setPaso('chat'); return }
      await abrir()
      const e = await estado()
      if (vivo) setPaso(e.prerregistrado ? 'chat' : 'formulario')
    })()
    return () => { vivo = false }
  }, [abrir, estado, conSesion])

  return (
    <div className="rc-contacto" data-testid="contacto">
      {paso === 'chat' ? (
        <ChatCanonico estilo="mensajeria" conCarrito={false} cliente={cliente} autoFoco
          barra={<>
            <a href={URL_VERIFICACION} className="rc-barra--fuerte" data-testid="ir-verificacion"><BadgeCheck size={15} /> Verificar mi cédula</a>
            <a href={URL_LANDING} data-testid="ir-landing"><Globe size={15} /> Conocer Renovacell</a>
          </>} />
      ) : (
        <div className="rc-pre rc-chat--wa">
          <header className="rc-head">
            <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>
            <div className="rc-title"><div className="rc-name">Renovacell</div><div className="rc-state">Tecnologías Antiedad</div></div>
          </header>
          <div className="rc-pre-cuerpo">
            {paso === 'cargando' ? <div className="rc-sys" role="status">Cargando…</div> : <Prerregistro registrar={registrar} onListo={() => setPaso('chat')} />}
          </div>
        </div>
      )}
    </div>
  )
}

function Prerregistro({ registrar, onListo }: { registrar: typeof prerregistrar; onListo: () => void }) {
  const [d, setD] = useState<DatosPrerregistro>({ nombre: '', telefono: '', email: '', es_medico: false, cedula: '' })
  const [acepta, setAcepta] = useState(false)
  const [fallo, setFallo] = useState<{ campo?: CampoPrerregistro; mensaje: string } | null>(null)
  const [enviando, setEnviando] = useState(false)
  const pon = (k: keyof DatosPrerregistro) => (e: React.ChangeEvent<HTMLInputElement>) => { setD((x) => ({ ...x, [k]: e.target.value })); setFallo(null) }
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    const v = validarPrerregistro(d, acepta)
    if (v) { setFallo(v); return }
    setEnviando(true); setFallo(null)
    const r = await registrar(d)
    setEnviando(false)
    if (r.ok) onListo(); else setFallo({ campo: r.campo, mensaje: r.mensaje })
  }
  const mal = (c: CampoPrerregistro) => (fallo?.campo === c ? ' rc-campo--mal' : '')
  const aviso = (c: CampoPrerregistro) => (fallo?.campo === c ? <small role="alert">{fallo.mensaje}</small> : null)
  return (
    <form className="rc-pre-tarjeta" onSubmit={enviar} noValidate data-testid="prerregistro">
      <h1>Hablemos</h1>
      <p>Déjanos tus datos para atenderte y darte seguimiento. Es un momento y solo se hace una vez.</p>
      <div className={'rc-campo' + mal('nombre')}><label htmlFor="pre-nombre">Nombre completo</label>
        <input id="pre-nombre" value={d.nombre} onChange={pon('nombre')} autoComplete="name" maxLength={120} placeholder="Nombre y apellidos" />{aviso('nombre')}</div>
      <div className={'rc-campo' + mal('telefono')}><label htmlFor="pre-telefono">Celular</label>
        <input id="pre-telefono" value={d.telefono} onChange={pon('telefono')} type="tel" inputMode="numeric" autoComplete="tel" maxLength={16} placeholder="10 dígitos" />{aviso('telefono')}</div>
      <div className={'rc-campo' + mal('email')}><label htmlFor="pre-email">Correo</label>
        <input id="pre-email" value={d.email} onChange={pon('email')} type="email" inputMode="email" autoComplete="email" maxLength={160} placeholder="ejemplo@correo.com" />{aviso('email')}</div>
      <label className="rc-casilla"><input type="checkbox" checked={d.es_medico} onChange={(e) => { setD((x) => ({ ...x, es_medico: e.target.checked })); setFallo(null) }} data-testid="es-medico" />
        <span>Soy profesional de la salud</span></label>
      {d.es_medico && (
        <div className={'rc-campo' + mal('cedula')}><label htmlFor="pre-cedula">Cédula profesional (opcional)</label>
          <input id="pre-cedula" value={d.cedula} onChange={pon('cedula')} inputMode="numeric" maxLength={40} placeholder="Número de cédula" />{aviso('cedula')}</div>
      )}
      <label className="rc-casilla"><input type="checkbox" checked={acepta} onChange={(e) => { setAcepta(e.target.checked); setFallo(null) }} data-testid="acepta-aviso" />
        <span>He leído y acepto el <a href={URL_PRIVACIDAD} target="_blank" rel="noopener">Aviso de privacidad</a>.</span></label>
      {fallo && (!fallo.campo || fallo.campo === 'consentimiento') && <div role="alert" className="rc-error rc-error--inline">{fallo.mensaje}</div>}
      <button type="submit" className="rc-pre-enviar" disabled={enviando} data-testid="iniciar-conversacion">{enviando ? 'Un momento…' : 'Iniciar conversación'}</button>
      <p className="rc-pre-nota">¿Ya tienes cuenta? <a href="/sistema">Inicia sesión</a></p>
    </form>
  )
}
