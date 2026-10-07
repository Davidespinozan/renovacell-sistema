// CC-2 → UX V2-B · La conversación canónica como producto conversacional (no un panel de ERP): sirve a
// tres entradas con el MISMO componente y el MISMO hilo: visitante en /chat (token CC-1), doctor en el
// portal (página o cajón flotante, JWT) y asesor/Dirección abriendo una conversación asignada.
// Transporte: polling acotado y solo con la pestaña visible; la autoridad SIEMPRE es el servidor
// (modo, asesor, handoff, carrito). Aquí solo se presenta y se envía con idempotencia (client_message_id).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Send, X } from 'lucide-react'
import { chat as clientePorDefecto, ETIQUETA_MODO, IA_PUEDE, nuevoClientId, type ClienteChat, type Conversacion, type Mensaje, type ModoConversacion } from '../../data/ops/chat'
import { CarritoPanel } from './CarritoPanel'   // CC-5 · carrito canónico (dueño muta; asesor/Dirección solo lee)
import type { ClienteCarrito } from '../../data/ops/carrito'
import { diaNegocio, hoyNegocio, sumarDias, ZONA_NEGOCIO } from '../../data/periodo'

interface Props {
  embebido?: boolean                 // dentro del portal (tarjeta a página completa)
  conversationId?: string           // modo asesor: abrir una conversación concreta
  asesor?: boolean                  // controles de asesor (iniciar/terminar/liberar)
  cliente?: ClienteChat
  intervaloMs?: number
  onSalir?: () => void
  conCarrito?: boolean               // CC-5 · chip de carrito (default: sí)
  clienteCarrito?: ClienteCarrito
  panel?: boolean                   // UX-1 · dentro del cajón flotante: ocupa el alto del contenedor
  onLeido?: (seq: number) => void    // UX-1 · avisa el cursor que se marcó leído (el lanzador apaga su badge)
  etiquetaSalir?: string
  autoFoco?: boolean                 // UX V2-B · al abrir el cajón, el foco entra al redactor
}

// Etiqueta del asesor humano. Una sola fuente (la pidió el dueño así); si cambia la persona, cambia aquí.
export const ETIQUETA_ASESOR = 'Asesora'
const NOMBRE_ACTOR: Record<Mensaje['actor'], string> = { visitor: 'Tú', doctor: 'Tú', seller: 'Asesor', admin: 'Renovacell', ai: 'Asistente', system: '' }

/** Subtítulo del encabezado: UN estado en lenguaje natural, decidido por lo que manda el servidor. */
export function subtituloDe(conv: Conversacion | null, asesor: boolean): string {
  if (!conv) return 'Conectando…'
  if (conv.estado === 'cerrada') return 'Conversación cerrada'
  const modo = conv.modo
  if (asesor) return `${ETIQUETA_MODO[modo]}${conv.asesor_nombre && modo !== 'ai_active' ? ` · ${conv.asesor_nombre}` : ''}`
  const nombre = conv.asesor_nombre?.trim() || null
  const fuera = conv.handoff?.fuera_horario
  switch (modo) {
    case 'ai_active':
    case 'human_offered': return 'Asistente Renovacell'
    case 'human_requested': return fuera === true ? 'Te atenderá un asesor en horario de atención · el asistente sigue contigo' : 'Buscando a tu asesor · el asistente sigue contigo'
    case 'human_assigned': return fuera === true ? `${nombre ?? 'Tu asesor'} te responderá en horario de atención · el asistente sigue contigo` : `${nombre ?? 'Tu asesor'} se unirá pronto · el asistente sigue contigo`
    case 'human_active': return nombre ? `${nombre} · ${ETIQUETA_ASESOR}` : `Con tu ${ETIQUETA_ASESOR.toLowerCase()}`
    case 'human_ended': return 'Asesoría terminada · escribe para seguir con el asistente'
  }
}

/** Tarjeta conversacional del handoff (sustituye al banner operativo). Copia veraz según horario del servidor. */
function textoHandoff(conv: Conversacion): { titulo: string; detalle: string } {
  const nombre = conv.asesor_nombre?.trim() || null
  const h = conv.handoff
  const detalle = 'Mientras tanto puedes seguir hablando con el asistente.'
  if (h?.asignado && h.fuera_horario !== true) return { titulo: `${nombre ?? 'Tu asesor personal'} se unirá a esta conversación.`, detalle }
  if (h?.fuera_horario === true) return { titulo: `${nombre ?? 'Tu asesor'} te responderá en horario de atención.`, detalle }
  if (h?.fuera_horario === false) return { titulo: 'Te conectaremos con un asesor personal.', detalle }
  return { titulo: 'Registramos tu solicitud de asesor; te avisaremos aquí cuando se una.', detalle }
}

// Separadores de día con el reloj del NEGOCIO (data/periodo.ts): "Hoy"/"Ayer" según el día de Mazatlán, no el del dispositivo.
const diaDe = (iso: string): string => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''
  const dia = diaNegocio(d); const hoy = hoyNegocio()
  if (dia === hoy) return 'Hoy'
  if (dia === sumarDias(hoy, -1)) return 'Ayer'
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: ZONA_NEGOCIO })
}
const horaDe = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: ZONA_NEGOCIO }) }

type Pendiente = { clientId: string; texto: string; error: string | null }

export function ChatCanonico({ embebido = false, conversationId, asesor = false, cliente = clientePorDefecto, intervaloMs = 4000, onSalir, conCarrito = true, clienteCarrito, panel = false, onLeido, etiquetaSalir = 'Cerrar', autoFoco = false }: Props) {
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [convId, setConvId] = useState<string | null>(conversationId ?? null)
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fin = useRef<HTMLDivElement | null>(null)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const ultimoSeq = useRef(0)

  const cargar = useCallback(async (id: string, desde = 0) => {
    const r = await cliente.leer(id, desde)
    if (!r.ok) { setError(r.error.mensaje); return }
    setError(null)
    setConv((prev) => {
      if (!prev || desde === 0 || prev.conversation_id !== id) return r.data
      // Chat V2-C1 · el servidor muestra SOLO la sesión actual: si cambió de sesión, el hilo empieza de nuevo.
      if (r.data.sesion?.id && prev.sesion?.id && r.data.sesion.id !== prev.sesion.id) return r.data
      const vistos = new Set(prev.mensajes.map((m) => m.seq))
      return { ...r.data, mensajes: [...prev.mensajes, ...r.data.mensajes.filter((m) => !vistos.has(m.seq))] }
    })
    const max = r.data.mensajes.reduce((s, m) => Math.max(s, m.seq), desde)
    if (max > ultimoSeq.current) { ultimoSeq.current = max; void cliente.leido(id, max); onLeido?.(max) }
  }, [cliente, onLeido])

  // Abrir/reanudar (dueño) o cargar la asignada (asesor).
  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      let id = conversationId ?? null
      if (!id) {
        const a = await cliente.abrir()
        if (!a.ok) { if (vivo) { setError(a.error.mensaje); setCargando(false) } return }
        id = a.data.conversation_id
      }
      if (!vivo) return
      setConvId(id); ultimoSeq.current = 0
      await cargar(id, 0)
      if (vivo) setCargando(false)
    })()
    return () => { vivo = false }
  }, [cliente, conversationId, cargar])

  // Polling acotado, solo con la pestaña visible.
  useEffect(() => {
    if (!convId) return
    const tick = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void cargar(convId, ultimoSeq.current) }
    const t = setInterval(tick, intervaloMs)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [convId, cargar, intervaloMs])

  // Al final del hilo tras cada cambio (y de nuevo tras el layout/fuentes): el último elemento siempre visible.
  const alFinal = useCallback(() => { fin.current?.scrollIntoView?.({ block: 'end' }) }, [])
  useEffect(() => {
    alFinal()
    const raf = requestAnimationFrame(alFinal); const t = window.setTimeout(alFinal, 180)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t) }
  }, [conv?.mensajes.length, conv?.modo, pendiente, enviando, cargando, alFinal])
  useEffect(() => { if (autoFoco && !cargando) area.current?.focus() }, [autoFoco, cargando])

  const modo: ModoConversacion = conv?.modo ?? 'ai_active'
  const cerrada = conv?.estado === 'cerrada'
  const soyAsesor = asesor && (conv?.rol === 'asesor' || conv?.rol === 'supervisor')
  const puedoEscribir = !!conv && !cerrada && (soyAsesor ? modo === 'human_active' || conv.rol === 'supervisor' : true)
  const nombreAsesor = conv?.asesor_nombre?.trim() || null

  // Enviar con idempotencia: el MISMO client_message_id en cada reintento → nunca se duplica.
  const enviarTexto = async (t: string, clientId: string) => {
    if (!convId || enviando) return
    setEnviando(true); setError(null)
    setPendiente({ clientId, texto: t, error: null })
    const r = await cliente.enviar(convId, t, clientId)
    if (!r.ok) { setPendiente({ clientId, texto: t, error: r.error.mensaje }); setEnviando(false); return }
    await cargar(convId, ultimoSeq.current)
    setPendiente(null); setEnviando(false)
  }
  const enviar = async () => {
    const t = texto.trim()
    if (!t || enviando || pendiente?.error) return
    setTexto('')
    if (area.current) area.current.style.height = 'auto'
    await enviarTexto(t, nuevoClientId())
  }
  const reintentar = () => { if (pendiente) void enviarTexto(pendiente.texto, pendiente.clientId) }
  const descartarPendiente = () => { if (pendiente) { setTexto(pendiente.texto); setPendiente(null) } }
  const accion = async (fn: () => Promise<{ ok: boolean; error?: { mensaje: string } }>) => {
    if (!convId) return
    setError(null)
    const r = await fn()
    if (!r.ok && r.error) setError(r.error.mensaje)
    await cargar(convId, 0)
  }
  const alTeclear = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar() }
  }
  const autoAlto = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px` }

  const mensajes = useMemo(() => conv?.mensajes ?? [], [conv])
  const handoffVivo = !asesor && !!conv && !cerrada && !!conv.handoff?.origen && (modo === 'human_requested' || modo === 'human_assigned')
  // La tarjeta de handoff ocupa el lugar del último aviso del sistema (el servidor lo publica junto con el
  // handoff): así no hay banner + aviso duplicados. Si no hubiera aviso, la tarjeta va al final del hilo.
  const seqTarjeta = useMemo(() => (handoffVivo ? mensajes.filter((m) => m.actor === 'system').reduce((s, m) => Math.max(s, m.seq), 0) : 0), [handoffVivo, mensajes])
  const esperandoIA = enviando && !pendiente?.error && !asesor && IA_PUEDE(modo)

  const tarjetaHandoff = conv && handoffVivo ? (() => {
    const t = textoHandoff(conv)
    return (
      <div className="rc-card" role="status" data-testid="aviso-handoff">
        <div className="rc-card-mark" aria-hidden>{(nombreAsesor ?? 'R').slice(0, 1).toUpperCase()}</div>
        <div className="rc-card-body">
          <div className="rc-card-title">{t.titulo}</div>
          <div className="rc-card-sub">{t.detalle}</div>
          {conv.handoff?.puede_rechazar && (
            <button type="button" className="rc-link" onClick={() => accion(() => cliente.rechazarAsesor(convId!))} data-testid="btn-rechazar-asesor">Seguir solo con el asistente</button>
          )}
        </div>
      </div>
    )
  })() : null

  const hilo: React.ReactNode[] = []
  let diaPrevio = ''; let actorPrevio: string | null = null
  for (const m of mensajes) {
    const dia = diaDe(m.created_at)
    if (dia && dia !== diaPrevio) { hilo.push(<div key={`d-${m.seq}`} className="rc-day"><span>{dia}</span></div>); diaPrevio = dia; actorPrevio = null }
    if (m.actor === 'system') {
      if (handoffVivo && m.seq === seqTarjeta) hilo.push(<React.Fragment key={m.id}>{tarjetaHandoff}</React.Fragment>)
      else hilo.push(<div key={m.id} className="rc-sys" data-testid="msg-system">{m.content}</div>)
      actorPrevio = null
      continue
    }
    const clave = m.propio ? 'own' : m.actor
    const inicio = clave !== actorPrevio
    actorPrevio = clave
    const etiqueta = m.propio ? null : m.actor === 'seller' ? `${nombreAsesor ?? NOMBRE_ACTOR.seller} · ${ETIQUETA_ASESOR}` : NOMBRE_ACTOR[m.actor]
    hilo.push(
      <div key={m.id} className={`rc-msg rc-msg--${m.propio ? 'own' : m.actor}${inicio ? ' rc-msg--inicio' : ''}`} data-testid={`msg-${m.actor}`}>
        {inicio && !m.propio && m.actor === 'ai' && <span className="rc-avatar" aria-hidden>R</span>}
        {inicio && !m.propio && m.actor !== 'ai' && <span className="rc-avatar rc-avatar--persona" aria-hidden>{(etiqueta ?? '?').slice(0, 1)}</span>}
        <div className="rc-bubble-wrap">
          {inicio && etiqueta && <div className="rc-meta">{etiqueta}</div>}
          <div className="rc-bubble" title={horaDe(m.created_at)}>{m.content}</div>
          <time className="rc-hora" dateTime={m.created_at}>{horaDe(m.created_at)}</time>
        </div>
      </div>,
    )
  }
  if (handoffVivo && seqTarjeta === 0) hilo.push(<React.Fragment key="handoff">{tarjetaHandoff}</React.Fragment>)
  if (!asesor && conv && !cerrada && modo === 'human_active') hilo.push(<div key="join" className="rc-join" data-testid="aviso-asesor-activo"><span>{nombreAsesor ?? 'Tu asesor'} está contigo</span></div>)

  return (
    <div className={`rc-chat${panel ? ' rc-chat--panel' : embebido ? ' rc-chat--embebido' : ' rc-chat--pagina'}`} data-testid="chat-canonico">
      <header className="rc-head">
        <div className="rc-mark" aria-hidden>R</div>
        <div className="rc-title">
          <div className="rc-name">{asesor ? 'Asesoría' : 'Renovacell'}</div>
          <div className="rc-state" data-testid="chat-modo">{subtituloDe(conv, asesor)}</div>
        </div>
        <div className="rc-actions">
          {soyAsesor && conv && modo === 'human_assigned' && conv.asesor_soy_yo && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.iniciar(convId!))} data-testid="btn-iniciar">Iniciar asesoría</button>
          )}
          {soyAsesor && conv && (modo === 'human_active' || modo === 'human_assigned') && (conv.asesor_soy_yo || conv.rol === 'supervisor') && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.terminar(convId!))} data-testid="btn-terminar">Terminar asesoría</button>
          )}
          {conv?.rol === 'supervisor' && conv && modo !== 'ai_active' && !cerrada && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.liberar(convId!))}>Devolver a la cola</button>
          )}
          {onSalir && panel && <button type="button" className="rc-ico" onClick={onSalir} aria-label="Minimizar" title="Minimizar" data-testid="btn-minimizar"><ChevronDown size={18} /></button>}
          {onSalir && <button type="button" className="rc-ico" onClick={onSalir} aria-label={etiquetaSalir} title={etiquetaSalir} data-testid="btn-salir"><X size={18} /></button>}
        </div>
      </header>

      {conCarrito && convId && conv && (
        // Dueño: su carrito activo ligado a esta conversación. Asesor/Dirección: el carrito del dueño, solo lectura (el servidor lo decide).
        <CarritoPanel conversationId={asesor ? null : convId} cartId={asesor ? conv.cart_id ?? null : null} soloLectura={asesor} cliente={clienteCarrito} />
      )}

      <div className="rc-thread" aria-live="polite">
        {cargando && <div className="rc-sys">Cargando conversación…</div>}
        {!cargando && mensajes.length === 0 && !error && !pendiente && (
          <div className="rc-msg rc-msg--ai rc-msg--inicio" data-testid="msg-bienvenida"><span className="rc-avatar" aria-hidden>R</span><div className="rc-bubble-wrap"><div className="rc-meta">Asistente</div><div className="rc-bubble">{asesor ? 'Sin mensajes todavía.' : 'Hola, soy el asistente de Renovacell. ¿En qué te ayudo?'}</div></div></div>
        )}
        {hilo}
        {pendiente && (
          <div className={`rc-msg rc-msg--own rc-msg--inicio${pendiente.error ? ' rc-msg--fallo' : ' rc-msg--pendiente'}`} data-testid="msg-pendiente">
            <div className="rc-bubble-wrap">
              <div className="rc-bubble">{pendiente.texto}</div>
              {pendiente.error
                ? <div className="rc-fallo" role="alert">No se envió. <button type="button" className="rc-link" onClick={reintentar} data-testid="btn-reintentar">Reintentar</button> · <button type="button" className="rc-link" onClick={descartarPendiente}>Editar</button></div>
                : <div className="rc-hora rc-hora--fija">Enviando…</div>}
            </div>
          </div>
        )}
        {esperandoIA && <div className="rc-msg rc-msg--ai rc-msg--inicio" data-testid="escribiendo" aria-label="El asistente está escribiendo"><span className="rc-avatar" aria-hidden>R</span><div className="rc-bubble-wrap"><div className="rc-bubble rc-typing"><i /><i /><i /></div></div></div>}
        <div ref={fin} />
      </div>

      {error && <div role="alert" className="rc-error">{error}</div>}

      <form className="rc-composer" onSubmit={(e) => { e.preventDefault(); void enviar() }}>
        <textarea
          ref={area} className="rc-input" aria-label="Escribe tu mensaje" value={texto} rows={1} maxLength={4000}
          onChange={(e) => { setTexto(e.target.value); autoAlto(e.target) }} onKeyDown={alTeclear}
          disabled={!puedoEscribir || enviando || !!pendiente?.error}
          placeholder={cerrada ? 'La conversación está cerrada' : soyAsesor && modo !== 'human_active' && conv?.rol !== 'supervisor' ? 'Inicia la asesoría para escribir' : 'Escribe tu mensaje…'}
          enterKeyHint="send" autoComplete="off" autoCapitalize="sentences" inputMode="text"
        />
        <button type="submit" className="rc-send" disabled={!puedoEscribir || enviando || !texto.trim() || !!pendiente?.error} aria-label={enviando ? 'Enviando' : 'Enviar'} title="Enviar" data-testid="btn-enviar"><Send size={18} /></button>
      </form>
      {!asesor && conv && !cerrada && (modo === 'ai_active' || modo === 'human_offered') && (
        <div className="rc-foot"><button type="button" className="rc-link" onClick={() => accion(() => cliente.solicitarAsesor(convId!))} data-testid="btn-asesor">¿Prefieres hablar con un asesor?</button></div>
      )}
      {!asesor && conv && !cerrada && modo === 'human_ended' && (
        <div className="rc-foot"><button type="button" className="rc-link" onClick={() => accion(() => cliente.reanudarIA(convId!))} data-testid="btn-reanudar">Seguir con el asistente</button></div>
      )}
    </div>
  )
}
