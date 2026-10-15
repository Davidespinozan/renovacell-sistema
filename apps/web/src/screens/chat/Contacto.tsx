// CX-ENLACE · Página del ENLACE DE CONTACTO (/contacto): el enlace único que el equipo comparte en grupos.
// Es el MISMO chat del sistema (ChatCanonico, misma conversación canónica) con piel de mensajería. Para conversar
// no hace falta estar verificado, pero sí dejar un prerregistro mínimo. Desde aquí se llega a la landing y a la
// verificación; al registrarse desde este mismo navegador y entrar al sistema, la conversación continúa.
// Quién atiende (su vendedor o Dirección) lo decide el servidor; esta página nunca lo sabe.
import React, { useEffect, useState } from 'react'
import { BadgeCheck, Globe, Send } from 'lucide-react'
import { BrandLogo } from '../../app/BrandLogo'
import { supabase, hasSupabase } from '../../lib/supabase'
import { abrirVisitante, estadoVisitante, prerregistrar, validarPrerregistro, type CampoPrerregistro, type DatosPrerregistro } from '../../data/ops/visitante'
import { ChatCanonico } from './ChatCanonico'
import { TarjetaVerificarme } from './TarjetaVerificarme'
import { urlEnlaceContacto } from '../../data/ops/contactoEnlace'
import type { ClienteChat } from '../../data/ops/chat'

export const URL_LANDING = '/'
export const URL_VERIFICACION = '/#contacto'       // formulario de verificación de la landing (mismo origen: reusa el prerregistro)
export const URL_PRIVACIDAD = '/landing/privacidad.html'

type Paso = 'cargando' | 'formulario' | 'chat' | 'personal'
export type SesionContacto = 'ninguna' | 'cliente' | 'personal'
interface Deps { estado?: typeof estadoVisitante; abrir?: typeof abrirVisitante; registrar?: typeof prerregistrar; conSesion?: () => Promise<SesionContacto>; cliente?: ClienteChat }

// ¿Quién abre el enlace? Sin sesión: un visitante. Con sesión de doctor: su cuenta. Con sesión del PERSONAL: no es un
// cliente; este enlace no es su lugar de trabajo (ahí no puede pedir asesor ni se le pide prerregistro).
async function haySesion(): Promise<SesionContacto> {
  if (!hasSupabase) return 'ninguna'
  try {
    const { data } = await supabase.auth.getSession()
    const uid = data.session?.user?.id
    if (!uid) return 'ninguna'
    const { data: p } = await supabase.from('profiles').select('role_id').eq('id', uid).maybeSingle()
    return (p as { role_id?: string } | null)?.role_id === 'doctor' ? 'cliente' : 'personal'
  } catch { return 'ninguna' }
}

export function Contacto({ estado = estadoVisitante, abrir = abrirVisitante, registrar = prerregistrar, conSesion = haySesion, cliente }: Deps) {
  const [paso, setPaso] = useState<Paso>('cargando')
  const [conCuenta, setConCuenta] = useState(false)
  const [verificando, setVerificando] = useState(false)
  useEffect(() => {
    let vivo = true
    void (async () => {
      // Con sesión de doctor manda la cuenta (el servidor decide si puede conversar). El personal ve un aviso.
      const sesion = await conSesion()
      if (sesion !== 'ninguna') { if (vivo) { setConCuenta(sesion === 'cliente'); setPaso(sesion === 'cliente' ? 'chat' : 'personal') } return }
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
          tarjetaFinal={verificando && !conCuenta ? <TarjetaVerificarme onCerrar={() => setVerificando(false)} /> : null}
          barra={<>
            {conCuenta
              ? <a href="/sistema" className="rc-barra--fuerte" data-testid="ir-portal"><BadgeCheck size={15} /> Ir a mi portal</a>
              : <button type="button" className="rc-barra--fuerte" onClick={() => setVerificando(true)} data-testid="ir-verificacion"><BadgeCheck size={15} /> Verificar mi cuenta</button>}
            <a href={URL_LANDING} data-testid="ir-landing"><Globe size={15} /> Conocer Renovacell</a>
          </>} />
      ) : (
        // Antes del prerregistro YA se ve el chat: el asistente saluda y pide los datos dentro del hilo. No es un
        // trámite previo, es el primer paso de la conversación; el redactor espera abajo.
        <div className="rc-chat rc-chat--pagina rc-chat--wa" data-testid="contacto-antesala">
          <header className="rc-head">
            <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>
            <div className="rc-title"><div className="rc-name">Renovacell</div><div className="rc-state"><span className="rc-enlinea" aria-hidden />En línea · te atendemos por aquí</div></div>
          </header>
          <div className="rc-thread">
            <div className="rc-day"><span>Hoy</span></div>
            {paso === 'cargando' ? <div className="rc-sys" role="status">Cargando…</div> : paso === 'personal' ? <AvisoPersonal /> : (<>
              <div className="rc-msg rc-msg--ai rc-msg--inicio"><div className="rc-bubble-wrap"><div className="rc-meta">Renovacell</div><div className="rc-bubble">Hola, te damos la bienvenida. Ya estamos aquí para atenderte.</div></div></div>
              <div className="rc-msg rc-msg--ai"><div className="rc-bubble-wrap"><div className="rc-bubble">Solo dinos quién eres para empezar. Es un momento y no te lo volvemos a pedir.</div></div></div>
              <Prerregistro registrar={registrar} onListo={() => setPaso('chat')} />
            </>)}
          </div>
          <div className="rc-composer" aria-hidden>
            <div className="rc-input rc-input--espera">{paso === 'formulario' ? 'Completa tus datos para escribir…' : 'Escribe tu mensaje…'}</div>
            <button type="button" className="rc-send" disabled tabIndex={-1}><Send size={18} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// El personal con sesión abierta no es un cliente: se le explica cómo verlo como cliente y dónde atiende.
function AvisoPersonal() {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    const url = urlEnlaceContacto()
    try { await navigator.clipboard.writeText(url); setCopiado(true); window.setTimeout(() => setCopiado(false), 2500) } catch { window.prompt('Copia el enlace de contacto:', url) }
  }
  return (
    <div className="rc-pre-tarjeta rc-pre-enhilo" data-testid="aviso-personal">
      <h1>Este enlace es para clientes</h1>
      <p>Tienes abierta tu sesión del sistema en este navegador, así que aquí no se te pide registro ni puedes pedir un asesor. Para verlo como lo ve un cliente, ábrelo en una <b>ventana de incógnito</b> o en otro navegador.</p>
      <button type="button" className="rc-pre-enviar" onClick={() => void copiar()} data-testid="copiar-enlace-contacto">{copiado ? 'Enlace copiado' : 'Copiar enlace para compartir'}</button>
      <p className="rc-pre-nota">Las conversaciones que lleguen por este enlace las atiendes en <a href="/sistema">el sistema</a>, en Conversaciones.</p>
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
    <form className="rc-pre-tarjeta rc-pre-enhilo" onSubmit={enviar} noValidate data-testid="prerregistro" aria-label="Tus datos para empezar a chatear">
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
      <button type="submit" className="rc-pre-enviar" disabled={enviando} data-testid="iniciar-conversacion">{enviando ? 'Un momento…' : 'Empezar a chatear'}</button>
      <p className="rc-pre-nota">¿Ya tienes cuenta? <a href="/sistema">Inicia sesión</a></p>
    </form>
  )
}
