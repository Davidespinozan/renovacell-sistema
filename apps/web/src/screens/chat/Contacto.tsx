// CX-ENLACE · Página del ENLACE DE CONTACTO (/contacto): el MISMO chat del sistema (ChatCanonico, misma conversación
// canónica) con piel de mensajería. Desde aquí se llega a la landing y a la verificación; al registrarse desde este mismo
// navegador y entrar al sistema, la conversación continúa. Quién atiende lo decide el servidor; esta página nunca lo sabe.
// ENLACE-VENDEDOR · /contacto/<código>: el enlace de un vendedor o la recomendación de un cliente. Para que quien lo recibe
// confíe en abrir un chat que no es WhatsApp, el hilo empieza diciendo con qué asesor va a hablar, quién lo recomendó, que
// es Renovacell y que no hay nada que descargar.
// CONTACTO CONVERSACIONAL (dueño, 30 oct): sin formulario. Se entra directo al chat; el asistente ya saludó y pide el
// nombre, y luego celular y correo, platicando (los registra el servidor). El aviso de privacidad queda bajo el redactor.
import React, { useEffect, useState } from 'react'
import { BadgeCheck, Globe, Heart, Lock, Send, ShieldCheck, Smartphone } from 'lucide-react'
import { BrandLogo } from '../../app/BrandLogo'
import { supabase, hasSupabase } from '../../lib/supabase'
import { abrirVisitante } from '../../data/ops/visitante'
import { ChatCanonico } from './ChatCanonico'
import { TarjetaVerificarme } from './TarjetaVerificarme'
import { BotonAvisos } from '../../app/BotonAvisos'
import { urlEnlaceContacto } from '../../data/ops/contactoEnlace'
import { aplicarEnlace as aplicarPorDefecto, codigoDeRuta, verEnlace as verPorDefecto, type EnlacePublico } from '../../data/ops/enlaces'
import type { ClienteChat } from '../../data/ops/chat'

export const URL_LANDING = '/'
export const URL_VERIFICACION = '/#contacto'       // formulario de verificación de la landing (mismo origen)
export const URL_PRIVACIDAD = '/landing/privacidad.html'

type Paso = 'cargando' | 'chat' | 'personal'
export type SesionContacto = 'ninguna' | 'cliente' | 'personal'
interface Deps { abrir?: typeof abrirVisitante; conSesion?: () => Promise<SesionContacto>; cliente?: ClienteChat
  codigo?: string | null; ver?: typeof verPorDefecto; aplicar?: typeof aplicarPorDefecto }

// ¿Quién abre el enlace? Sin sesión: un visitante. Con sesión de doctor: su cuenta. Con sesión del PERSONAL: no es un
// cliente; este enlace no es su lugar de trabajo (ahí no puede pedir asesor).
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

/** Al inicio del hilo: con quién habla, quién lo recomendó y que es Renovacell (confianza para abrir un chat que no es WhatsApp). */
export function TarjetaConfianza({ enlace }: { enlace: EnlacePublico | null }) {
  const asesor = enlace?.asesor ?? null
  return (
    <div className="rc-confianza" data-testid="contacto-confianza">
      {enlace?.recomienda && <div className="rc-conf-rec"><Heart size={15} aria-hidden /> <span><b>{enlace.recomienda}</b> te recomendó con nosotros</span></div>}
      <div className="rc-conf-marca"><BrandLogo alt="" className="rc-logo" /><span><b>Renovacell · Tecnologías Antiedad</b><small>renovacell.mx · Culiacán, Sinaloa</small></span></div>
      <ul>
        <li><ShieldCheck size={14} aria-hidden /> {asesor ? `Hablas directo con ${asesor.primer_nombre ?? asesor.nombre}, de nuestro equipo` : 'Hablas directo con nuestro equipo'}</li>
        <li><Smartphone size={14} aria-hidden /> Sin descargar nada ni crear cuenta</li>
        <li><Lock size={14} aria-hidden /> <span>Tus datos están protegidos (<a href={URL_PRIVACIDAD} target="_blank" rel="noopener">aviso de privacidad</a>)</span></li>
      </ul>
    </div>
  )
}

export function Contacto({ abrir = abrirVisitante, conSesion = haySesion, cliente,
  codigo = typeof window !== 'undefined' ? codigoDeRuta(window.location.pathname) : null, ver = verPorDefecto, aplicar = aplicarPorDefecto }: Deps) {
  const [paso, setPaso] = useState<Paso>('cargando')
  const [conCuenta, setConCuenta] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [enlace, setEnlace] = useState<EnlacePublico | null>(null)
  useEffect(() => {
    let vivo = true
    // Con quién va a hablar: se pinta en cuanto se sabe, antes de abrir la sesión.
    if (codigo) void ver(codigo).then((e) => { if (vivo && e.valido) setEnlace((x) => x ?? e) })
    void (async () => {
      // Con sesión de doctor manda la cuenta (el servidor decide si puede conversar). El personal ve un aviso.
      const sesion = await conSesion()
      if (sesion !== 'ninguna') { if (vivo) { setConCuenta(sesion === 'cliente'); setPaso(sesion === 'cliente' ? 'chat' : 'personal') } return }
      await abrir()
      if (codigo) { const e = await aplicar(codigo); if (vivo && e.valido) setEnlace(e) }   // queda de dónde llegó (gana el primero)
      if (vivo) setPaso('chat')   // sin formulario: directo al chat; el asistente pide los datos platicando
    })()
    return () => { vivo = false }
  }, [abrir, conSesion, codigo, ver, aplicar])
  const asesor = enlace?.asesor ?? null

  return (
    <div className="rc-contacto" data-testid="contacto">
      {paso === 'chat' ? (
        <ChatCanonico estilo="mensajeria" conCarrito={false} cliente={cliente} autoFoco
          inicioHilo={conCuenta ? null : <TarjetaConfianza enlace={enlace} />}
          notaRedactor={conCuenta ? null : <>Al escribirnos aceptas nuestro <a href={URL_PRIVACIDAD} target="_blank" rel="noopener">aviso de privacidad</a>.</>}
          tarjetaFinal={verificando && !conCuenta ? <TarjetaVerificarme onCerrar={() => setVerificando(false)} /> : null}
          barra={<>
            {conCuenta
              ? <a href="/sistema" className="rc-barra--fuerte" data-testid="ir-portal"><BadgeCheck size={15} /> Ir a mi portal</a>
              : <button type="button" className="rc-barra--fuerte" onClick={() => setVerificando(true)} data-testid="ir-verificacion"><BadgeCheck size={15} /> Verificar mi cuenta</button>}
            {asesor && <span className="rc-barra-asesor" data-testid="te-atiende"><ShieldCheck size={15} /> Te atiende {asesor.primer_nombre ?? asesor.nombre}</span>}
            <BotonAvisos />
            <a href={URL_LANDING} data-testid="ir-landing"><Globe size={15} /> Conocer Renovacell</a>
          </>} />
      ) : (
        <div className="rc-chat rc-chat--pagina rc-chat--wa" data-testid="contacto-antesala">
          <header className="rc-head">
            {asesor
              ? <div className={'rc-mark rc-mark--inicial' + (asesor.foto ? ' rc-mark--foto' : '')} aria-hidden>{asesor.foto ? <img src={asesor.foto} alt="" /> : (asesor.primer_nombre ?? asesor.nombre).slice(0, 1).toUpperCase()}</div>
              : <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>}
            <div className="rc-title">
              <div className="rc-name" data-testid="contacto-asesor">{asesor ? asesor.nombre : 'Renovacell'}</div>
              <div className="rc-state"><span className="rc-enlinea" aria-hidden />{asesor ? 'Asesor de Renovacell · te atiende por aquí' : 'En línea · te atendemos por aquí'}</div>
            </div>
          </header>
          <div className="rc-thread">
            <div className="rc-day"><span>Hoy</span></div>
            {paso === 'personal' ? <AvisoPersonal url={codigo ? window.location.href.split(/[?#]/)[0] : undefined} /> : (<>
              <TarjetaConfianza enlace={enlace} />
              <div className="rc-sys" role="status">Conectando…</div>
            </>)}
          </div>
          <div className="rc-composer" aria-hidden>
            <div className="rc-input rc-input--espera">Escribe tu mensaje…</div>
            <button type="button" className="rc-send" disabled tabIndex={-1}><Send size={18} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// El personal con sesión abierta no es un cliente: se le explica cómo verlo como cliente y dónde atiende.
function AvisoPersonal({ url: urlPropia }: { url?: string }) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    const url = urlPropia ?? urlEnlaceContacto()
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
