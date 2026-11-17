// CC-2 → UX V2-B · La conversación canónica como producto conversacional (no un panel de ERP): sirve a
// tres entradas con el MISMO componente y el MISMO hilo: visitante en /chat (token CC-1), doctor en el
// portal (página o cajón flotante, JWT) y asesor/Dirección abriendo una conversación asignada.
// Transporte: polling acotado y solo con la pestaña visible; la autoridad SIEMPRE es el servidor
// (modo, asesor, handoff, carrito). Aquí solo se presenta y se envía con idempotencia (client_message_id).
import { suscribirMensajes, type Suscriptor } from '../../data/ops/chatRealtime'
import { confirmar } from '../../app/dialogos'   // CALIDAD VISUAL · diálogos del sistema
import { TarjetaPromoChat } from './TarjetaPromoChat'
import { MARCA_PROMO } from '../../data/ops/promociones'
import { MARCA_DIFUSION } from '../../data/ops/difusiones'
import { TarjetaDifusion } from './TarjetaDifusion'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, ChevronDown, ChevronUp, Download, FileText, MapPin, Paperclip, Pencil, Plus, Search, Send, X, Zap } from 'lucide-react'
import { enlaceMaps, leerUbicacion } from '../../../../../supabase/functions/_shared/ubicacion'   // UBICACIÓN EN EL CHAT
import { ACEPTA, claseDe, pesoLegible, problemaArchivo, tipoDe } from '../../data/ops/adjuntosEquipo'
import { normalizar, partesResaltadas } from '../../data/ops/busqueda'
import { reducirFoto } from '../../data/ops/verificacion'
import { BrandLogo } from '../../app/BrandLogo'
import { chat as clientePorDefecto, ETIQUETA_MODO, IA_PUEDE, nuevoClientId, type ClienteChat, type Conversacion, type Mensaje, type ModoConversacion, type SesionListada, canalDe, NOMBRE_CANAL } from '../../data/ops/chat'
import { retomarConversacion } from '../../data/ops/misConversaciones'   // CONV-WHATSAPP · escribir = retomar
import { telefonoLegible } from '../../lib/telefono'
import { hiloPersona as hiloPersonaPorDefecto, NOMBRE_CANAL_PERSONA, type CanalPersona, type HiloPersona } from '../../data/ops/hiloPersona'
import { CarritoPanel } from './CarritoPanel'   // CC-5 · carrito canónico (dueño muta; asesor/Dirección solo lee)
import type { ClienteCarrito } from '../../data/ops/carrito'
import { diaNegocio, hoyNegocio, sumarDias, ZONA_NEGOCIO } from '../../data/periodo'
import { etiquetaActor, type Visor } from '../../data/ops/sesionesPresentacion'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { RespuestasRapidas } from './RespuestasRapidas'
import { RetomarWhatsApp } from './RetomarWhatsApp'   // WA-PLANTILLAS   // CHAT PRO · textos listos del personal
import { aplicarNombre, filtrar, respuestasRapidas as respuestasPorDefecto, type ClienteRespuestas, type RespuestaRapida } from '../../data/ops/respuestasRapidas'
import { pedirAvisos } from '../../data/store/puertaAvisos'   // PUSH SIEMPRE
import { EVENTO_ABRIR_CHAT, tomarBorrador } from '../../data/store/chatUiStore'   // IA-VENDEDORA

interface Props {
  /** PROMO-6 · la tarjeta de una promoción puede llevar al catálogo (lo define quien monta el chat del doctor). */
  onIrCatalogo?: () => void
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
  nombreCliente?: string | null      // Chat V2-C3 · nombre del dueño que manda el servidor (vista del personal)
  onFin?: (motivo: 'terminada') => void   // D4-FIX · el asesor terminó la asesoría: quien monta vuelve a su lista
  estilo?: 'mensajeria' | 'sistema'  // CHAT PRO · piel de mensajería en TODOS los chats (cliente, doctor y vendedor); 'sistema' = la anterior
  barra?: React.ReactNode            // CX-ENLACE · accesos bajo el encabezado (conocer Renovacell, verificarse)
  accionesAdjunto?: (m: Mensaje) => React.ReactNode   // FOTOS · acciones bajo una imagen (p. ej. "Usar como INE" para quien verifica)
  reducir?: (f: File) => Promise<string | null>        // FOTOS · inyectable en pruebas
  suscribir?: Suscriptor | null                        // INMEDIATO · canal en tiempo real (null en pruebas)
  tarjetaFinal?: React.ReactNode                       // VERIFICARME · tarjeta al final del hilo (p. ej. crear la cuenta en el chat)
  respuestas?: ClienteRespuestas | null                // CHAT PRO · respuestas rápidas (solo personal; null las apaga)
  puedeEmpresa?: boolean                               // CHAT PRO · Dirección administra las de la empresa
  bloqueoEscritura?: string | null                     // R4-B2-4 · canal: el servidor dice que aún no puedes escribir (p. ej. falta tomarla); el texto es el porqué
  // EXPEDIENTE EN EL CHAT · el personal trabaja al cliente SIN salir del hilo: quién es (franja bajo el encabezado), qué
  // puede hacer (menú «+» del redactor) y la hoja de la acción elegida (sobre el redactor). Los arma quien monta.
  tira?: React.ReactNode
  acciones?: AccionChat[]
  hoja?: React.ReactNode
  inicioHilo?: React.ReactNode       // ENLACE · al inicio del hilo (p. ej. con quién hablas y quién te recomendó)
  notaRedactor?: React.ReactNode     // CONTACTO CONVERSACIONAL · línea bajo el redactor (aviso de privacidad)
  telefono?: string | null           // CONV-WHATSAPP · número de quien escribe (vista del personal), si quien monta ya lo tiene
  retomar?: (id: string) => Promise<{ ok: true } | { ok: false; mensaje: string }>   // CONV-WHATSAPP · el responsable escribe = retoma
  hiloDePersona?: typeof hiloPersonaPorDefecto | null   // HILO-PERSONA · sus otras conversaciones (otros canales); null lo apaga
}

/** Una acción del menú «+» del redactor (solo personal). */
export interface AccionChat { clave: string; etiqueta: string; detalle?: string; icono?: React.ReactNode; onElegir: () => void }

// CHAT PRO · "escribiendo…": se avisa al servidor como mucho cada 3 s mientras se teclea; la marca vence sola en 6 s.
const PING_ESCRIBIENDO_MS = 5000
const SONDEO_ESCRIBIENDO_MS = 3000
// PERF: la IA responde en segundo plano; mientras tanto se lee seguido (también sin Realtime, p. ej. el visitante)
// y se deja de esperar al llegar su mensaje, si la conversación sale del modo con IA o tras ESPERA_IA_MAX_MS.
const SONDEO_IA_MS = 1500
const ESPERA_IA_MAX_MS = 45_000

// Etiqueta del asesor humano. Una sola fuente (la pidió el dueño así); si cambia la persona, cambia aquí.
export const ETIQUETA_ASESOR = 'Asesoría'
// D4-FIX · textos neutrales del cierre y de la pérdida legítima de acceso del asesor (no son errores).
export const TEXTO_ASESORIA_FINALIZADA = 'Asesoría finalizada. El historial permanece disponible en Cliente 360.'
export const TEXTO_SIN_ASIGNACION = 'Esta conversación ya no está asignada a ti. Puedes consultar su historial en Cliente 360.'

/** Subtítulo del encabezado: UN estado en lenguaje natural, decidido por lo que manda el servidor. */
export function subtituloDe(conv: Conversacion | null, asesor: boolean): string {
  if (!conv) return 'Conectando…'
  if (conv.estado === 'cerrada') return 'Conversación cerrada'
  const modo = conv.modo
  if (asesor) return `${ETIQUETA_MODO[modo]}${conv.asesor_nombre && modo !== 'ai_active' ? ` · ${conv.asesor_nombre}` : ''}`
  const nombre = conv.asesor_nombre?.trim() || null
  // CI-2 · sin prometer tiempos ni horarios (el horario puede no estar configurado): solo lo que el servidor confirmó.
  switch (modo) {
    case 'ai_active':
    case 'human_offered': return 'Asistente Renovacell'
    case 'human_requested': return 'Avisamos a nuestro equipo comercial · el asistente sigue contigo'
    case 'human_assigned': return `Avisamos a ${primerNombre(nombre) ?? 'tu asesor'} · el asistente sigue contigo`
    case 'human_active': return nombre ? `${nombre} · ${ETIQUETA_ASESOR}` : `Con tu ${ETIQUETA_ASESOR.toLowerCase()}`
    case 'human_ended': return 'Asesoría terminada · escribe para seguir con el asistente'
  }
}

/**
 * CI-2 → V2-D2 · Estado compacto de la atención comercial (sustituye al aviso del sistema en el hilo actual). La
 * bienvenida la da el saludo persistido por D1 (mensaje del asistente): aquí solo el estado, sin repetirla.
 * Nombra a la asesora solo si el servidor la asignó; nunca promete tiempos ni horarios.
 */
export function textoHandoff(conv: Pick<Conversacion, 'asesor_nombre' | 'handoff'>): { titulo: string; detalle: string } {
  const nombre = conv.handoff?.asignado ? primerNombre(conv.asesor_nombre) : null
  if (nombre) return { titulo: `${nombre}, de nuestro equipo comercial, ya tiene tu solicitud.`, detalle: '' }
  return { titulo: 'Nuestro equipo comercial ya tiene tu solicitud.', detalle: '' }
}

// Enlaces en el texto: solo http(s), se abren aparte y sin dar acceso a esta pestaña. El resto queda como texto.
const URL_EN_TEXTO = /(https?:\/\/[^\s<>"]+)/g
export function conEnlaces(texto: string): React.ReactNode {
  // UBICACIÓN EN EL CHAT · «📍 …» con su enlace de Maps se ve como tarjeta (nombre, dirección y «Abrir en Google Maps»).
  const u = leerUbicacion(texto)
  if (u) return (
    <span className="rc-ubic" data-testid="msg-ubicacion">
      <span className="rc-ubic-tit"><MapPin size={15} aria-hidden /> <b>{u.nombre}</b></span>
      {u.direccion && <span className="rc-ubic-dir">{u.direccion}</span>}
      <a href={enlaceMaps(u)} target="_blank" rel="noopener noreferrer" className="rc-enlace">Abrir en Google Maps</a>
    </span>
  )
  const partes = texto.split(URL_EN_TEXTO)
  if (partes.length === 1) return texto
  return partes.map((p, i) => {
    if (i % 2 === 0) return p
    const limpio = p.replace(/[.,;:!?)\]]+$/, ''); const resto = p.slice(limpio.length)
    return <React.Fragment key={i}><a href={limpio} target="_blank" rel="noopener noreferrer" className="rc-enlace">{limpio}</a>{resto}</React.Fragment>
  })
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
// CONV-WHATSAPP · hilo continuo: las sesiones anteriores se cargan por tandas hasta ~MIN_PREVIOS mensajes.
const MIN_PREVIOS = 60
const PAGINA_SESION = 100   // límite que fija la Edge `leer_sesion`
/** Une mensajes de varias sesiones en UN hilo: sin duplicados y en orden. */
// EDITAR-MENSAJES · las correcciones recientes que manda el servidor se aplican a lo que ya está en pantalla.
export const conCorrecciones = (mensajes: Mensaje[], ediciones?: Conversacion['ediciones']): Mensaje[] => {
  if (!ediciones?.length) return mensajes
  const por = new Map(ediciones.map((e) => [e.message_id, e.texto]))
  return mensajes.map((m) => (por.has(m.id) && m.content !== por.get(m.id) ? { ...m, content: por.get(m.id)!, editado: true } : m))
}
/** Se puede editar: propio del personal, solo texto, en el portal y dentro de 15 minutos. */
export const MIN_EDITAR = 15
export const editable = (m: Mensaje, ahora = Date.now()): boolean =>
  m.propio && (m.actor === 'seller' || m.actor === 'admin') && !m.adjunto && !m.archivo && ahora - Date.parse(m.created_at) < MIN_EDITAR * 60_000
export const unirHilo = (...listas: Mensaje[][]): Mensaje[] => {
  const porSeq = new Map<number, Mensaje>()
  for (const l of listas) for (const m of l) porSeq.set(m.seq, m)
  return [...porSeq.values()].sort((a, b) => a.seq - b.seq)
}

/** Chat V2-C3 · mensajes que ve ACTUAL: si el servidor devuelve la última sesión CERRADA, ACTUAL va vacío. */
export const mensajesActuales = (conv: Conversacion | null): Mensaje[] => (!conv || conv.sesion?.estado === 'cerrada' ? [] : conv.mensajes)

export function ChatCanonico({ embebido = false, conversationId, asesor = false, cliente = clientePorDefecto, intervaloMs = 15_000, onSalir, conCarrito = true, clienteCarrito, panel = false, onLeido, etiquetaSalir = 'Cerrar', autoFoco = false, nombreCliente = null, onFin, barra, accionesAdjunto, reducir = reducirFoto, tarjetaFinal, suscribir = suscribirMensajes, respuestas = respuestasPorDefecto, puedeEmpresa = false, estilo = 'mensajeria', onIrCatalogo, bloqueoEscritura = null, tira, acciones, hoja, inicioHilo, notaRedactor, telefono = null, retomar = retomarConversacion, hiloDePersona = hiloPersonaPorDefecto }: Props) {
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [convId, setConvId] = useState<string | null>(conversationId ?? null)
  const [texto, setTexto] = useState('')
  // IA-VENDEDORA · pregunta sugerida desde el catálogo (solo el dueño; el asesor nunca la recibe)
  useEffect(() => {
    if (asesor) return
    const tomar = () => { const b = tomarBorrador(); if (b) setTexto(b) }
    tomar()
    window.addEventListener(EVENTO_ABRIR_CHAT, tomar)
    return () => window.removeEventListener(EVENTO_ABRIR_CHAT, tomar)
  }, [asesor])
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [esperaIA, setEsperaIA] = useState<{ seq: number; desde: number } | null>(null)   // PERF · turno de IA en curso tras mi mensaje
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fin = useRef<HTMLDivElement | null>(null)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const ultimoSeq = useRef(0)
  // CONV-WHATSAPP · sesiones cerradas = inmutables: se leen una vez (caché por sesión).
  const cache = useRef(new Map<string, Mensaje[]>())
  const visor: Visor = asesor ? 'personal' : 'cliente'
  // D4-FIX · fin de la atención en la vista del asesor: 'terminada' (cerró él) o 'sin_acceso' (lo cerró C2, Dirección
  // lo reasignó o devolvió, u otra sesión lo terminó). Solo aplica a un asesor que YA estaba autorizado.
  const [finAtencion, setFinAtencion] = useState<null | 'terminada' | 'sin_acceso'>(null)
  const finRef = useRef(false)
  const autorizado = useRef(false)
  const [errorTerminar, setErrorTerminar] = useState<string | null>(null)   // el sondeo no lo borra (sí `error`)

  const cargar = useCallback(async (id: string, desde = 0) => {
    if (finRef.current) return
    const r = await cliente.leer(id, desde)
    if (finRef.current) return
    if (!r.ok) {
      // D4-FIX · un asesor que YA tenía la conversación y deja de estar asignado → estado neutral, sin más lecturas.
      if (asesor && autorizado.current && r.error.codigo === 'no_autorizado') { finRef.current = true; setFinAtencion('sin_acceso'); return }
      setError(r.error.mensaje); return
    }
    if (asesor && (r.data.rol === 'asesor' || r.data.rol === 'supervisor' || r.data.rol === 'responsable')) autorizado.current = true
    setError(null)
    setConv((prev) => {
      if (!prev || desde === 0 || prev.conversation_id !== id) return r.data
      // Chat V2-C1 · el servidor muestra SOLO la sesión actual: si cambió de sesión, el hilo empieza de nuevo.
      if (r.data.sesion?.id && prev.sesion?.id && r.data.sesion.id !== prev.sesion.id) return r.data
      const vistos = new Set(prev.mensajes.map((m) => m.seq))
      return { ...r.data, mensajes: conCorrecciones([...prev.mensajes, ...r.data.mensajes.filter((m) => !vistos.has(m.seq))], r.data.ediciones) }
    })
    const max = r.data.mensajes.reduce((s, m) => Math.max(s, m.seq), desde)
    if (max <= ultimoSeq.current) return
    ultimoSeq.current = max
    void cliente.leido(id, max); onLeido?.(max)
  }, [cliente, onLeido, asesor])

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

  // Al instante: con sesión, un mensaje nuevo en ESTA conversación despierta la lectura (Realtime; el RLS decide quién
  // recibe la señal y el contenido se lee siempre por el servidor). El sondeo de abajo queda como respaldo.
  useEffect(() => {
    if (!convId || finAtencion || !suscribir) return
    return suscribir(convId, () => { void cargar(convId, ultimoSeq.current) })
  }, [convId, finAtencion, suscribir, cargar])

  // Polling de respaldo, solo con la pestaña visible. PERF: Realtime ya despierta la lectura al llegar un mensaje;
  // a 4 s cada pestaña abierta hacía ~15 llamadas/min a la Edge.
  useEffect(() => {
    if (!convId || finAtencion) return   // D4-FIX · terminada o sin acceso: sin sondeo
    const tick = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void cargar(convId, ultimoSeq.current) }
    const t = setInterval(tick, intervaloMs)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [convId, cargar, intervaloMs, finAtencion])

  // CHAT PRO · mientras el otro lado escribe, se lee más seguido: su mensaje aparece en cuanto lo manda.
  const otroEscribiendo = !!conv?.escribiendo_otro
  useEffect(() => {
    if (!convId || finAtencion || !otroEscribiendo) return
    const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void cargar(convId, ultimoSeq.current) }, SONDEO_ESCRIBIENDO_MS)
    return () => clearInterval(t)
  }, [convId, finAtencion, otroEscribiendo, cargar])

  // PERF · mientras la IA responde en segundo plano: lectura rápida y acotada; termina con su respuesta.
  const modoConv = conv?.modo
  const respondioIA = !!esperaIA && !!conv?.mensajes.some((m) => m.seq > esperaIA.seq && !m.propio)
  useEffect(() => {
    if (!esperaIA) return
    if (respondioIA || finAtencion || (modoConv && !IA_PUEDE(modoConv))) { setEsperaIA(null); return }
    const t = setInterval(() => {
      if (Date.now() - esperaIA.desde > ESPERA_IA_MAX_MS) { setEsperaIA(null); return }
      if (convId && (typeof document === 'undefined' || document.visibilityState === 'visible')) void cargar(convId, ultimoSeq.current)
    }, SONDEO_IA_MS)
    return () => clearInterval(t)
  }, [esperaIA, respondioIA, finAtencion, modoConv, convId, cargar])

  // Al final del hilo tras cada cambio (y de nuevo tras el layout/fuentes): el último elemento siempre visible.
  // CONV-WHATSAPP · se mueve SOLO el hilo (scrollIntoView movía también la página: "bajo y no se mueve orgánicamente").
  const hiloRef = useRef<HTMLDivElement | null>(null)
  const pegadoAlFinal = useRef(true)   // el vendedor está viendo lo último (si subió a leer, no lo jalamos)
  const alFinal = useCallback(() => { const el = hiloRef.current; if (el) { el.scrollTop = el.scrollHeight; pegadoAlFinal.current = true } }, [])
  // SCROLL (17 nov 2026, dueño: «no puedo llegar hasta abajo de la conversación, se queda atorado») · una foto, sticker,
  // audio o video termina de cargar DESPUÉS de bajar al final y empuja lo último fuera de la vista: si estaba abajo, se
  // vuelve a bajar.
  useEffect(() => {
    const el = hiloRef.current
    if (!el) return
    const alMover = () => { pegadoAlFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }
    const alCargar = () => { if (pegadoAlFinal.current) el.scrollTop = el.scrollHeight }
    el.addEventListener('scroll', alMover, { passive: true })
    el.addEventListener('load', alCargar, true); el.addEventListener('loadedmetadata', alCargar, true)
    return () => { el.removeEventListener('scroll', alMover); el.removeEventListener('load', alCargar, true); el.removeEventListener('loadedmetadata', alCargar, true) }
  }, [cargando, convId])
  useEffect(() => {
    alFinal()
    const raf = requestAnimationFrame(alFinal); const t = window.setTimeout(alFinal, 180)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t) }
  }, [conv?.mensajes.length, conv?.modo, pendiente, enviando, cargando, alFinal, otroEscribiendo])
  useEffect(() => { if (autoFoco && !cargando) area.current?.focus() }, [autoFoco, cargando])

  const modo: ModoConversacion = conv?.modo ?? 'ai_active'
  const cerrada = conv?.estado === 'cerrada'
  const soyAsesor = asesor && (conv?.rol === 'asesor' || conv?.rol === 'supervisor')
  // CANAL (WhatsApp / Instagram / Facebook) · en modo espejo lo que se escribiera aquí NUNCA saldría por el canal (se contesta en
  // Leadsales): el redactor se apaga.
  const canal = asesor ? canalDe(conv) : null
  const waEspejo = !!canal && canal.modo === 'espejo'
  // CONV-WHATSAPP · como en WhatsApp, el personal ESCRIBE y ya: su vendedor responsable (rol 'responsable', la atiende el
  // asistente o terminó la asesoría) retoma al mandar; con la asesoría asignada a mí, mandar la inicia. El servidor decide.
  const soyResponsable = asesor && conv?.rol === 'responsable'
  const iniciaAlEscribir = soyAsesor && modo === 'human_assigned' && !!conv?.asesor_soy_yo
  const puedoEscribir = !!conv && !cerrada && !waEspejo && !bloqueoEscritura
    && (soyResponsable || iniciaAlEscribir || (soyAsesor ? modo === 'human_active' || conv.rol === 'supervisor' : true))
  const nombreAsesor = conv?.asesor_nombre?.trim() || null
  const nombreVisible = capitalizarNombre(nombreCliente) || capitalizarNombre(conv?.contacto?.nombre ?? null) || null
  const telVisible = asesor ? telefonoLegible(conv?.contacto?.telefono ?? telefono ?? (canal?.canal === 'whatsapp' ? canal.id : null)) : null

  // CONVERSACIÓN CONTINUA → CONV-WHATSAPP (14 nov 2026, dueño: "el reloj esconde los chats", "se tiene que sentir tal cual
  // como WhatsApp"). UN hilo con todo lo que se ha hablado: las sesiones anteriores se cargan arriba por tandas (las más
  // recientes primero) y se leen una sola vez (cerradas = inmutables). Sin "Antes/Ahora" ni relojito: solo días.
  const [anteriores, setAnteriores] = useState<Mensaje[]>([])
  const [quedan, setQuedan] = useState<SesionListada[]>([])
  const [cargandoAnt, setCargandoAnt] = useState(false)
  const sesionActual = conv?.sesion?.id ?? null
  const leerCompleta = useCallback(async (id: string): Promise<Mensaje[] | null> => {
    const hit = cache.current.get(id)
    if (hit) return hit
    if (!cliente.leerSesion) return null
    let todos: Mensaje[] = []
    for (let pag = 0; pag < 10; pag++) {
      const r = await cliente.leerSesion(id, todos.length ? todos[todos.length - 1].seq : 0)
      if (!r.ok) return todos.length ? todos : null
      todos = todos.concat(r.data.mensajes)
      const ultimo = r.data.sesion.last_seq ?? null
      if (r.data.mensajes.length < PAGINA_SESION || (ultimo != null && todos.length && todos[todos.length - 1].seq >= ultimo)) break
    }
    cache.current.set(id, todos)
    return todos
  }, [cliente])
  const cargarTanda = useCallback(async (lista: SesionListada[], vivo: () => boolean) => {
    let junta: Mensaje[] = []; let i = 0
    while (i < lista.length && (junta.length < MIN_PREVIOS || i === 0)) {
      const m = await leerCompleta(lista[i].id)
      if (!vivo()) return
      if (m) junta = m.concat(junta)
      i++
    }
    setAnteriores((prev) => unirHilo(junta, prev)); setQuedan(lista.slice(i))
  }, [leerCompleta])
  useEffect(() => {
    let vivo = true
    setAnteriores([]); setQuedan([])
    if (!convId || !sesionActual || !cliente.sesiones || (conv?.sesion?.ordinal ?? 1) <= 1) return
    void (async () => {
      const l = await cliente.sesiones!(convId)
      if (!vivo || !l.ok) return
      const previas = (l.data.sesiones ?? []).filter((x) => x.id !== sesionActual && x.estado === 'cerrada' && x.n_mensajes > 0).sort((a, b) => b.ordinal - a.ordinal)
      await cargarTanda(previas, () => vivo)
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, sesionActual])
  const verAnteriores = async () => {
    if (cargandoAnt || !quedan.length) return
    const alto = hiloRef.current?.scrollHeight ?? 0
    setCargandoAnt(true); conservarScroll.current = alto
    await cargarTanda(quedan, () => true)
    setCargandoAnt(false)
  }
  const conservarScroll = useRef<number | null>(null)   // al cargar mensajes viejos arriba, la vista no salta
  useLayoutEffect(() => {
    const el = hiloRef.current
    if (conservarScroll.current != null && el) { el.scrollTop += el.scrollHeight - conservarScroll.current; conservarScroll.current = null; return }
    alFinal()
  }, [anteriores.length, alFinal])

  // HILO-PERSONA (dueño: "se generan dos conversaciones… dentro debería aparecer el historial unificado, identificado por
  // canal, y que el vendedor elija por cuál hablarle"). Solo personal: sus mensajes de OTROS canales entran al mismo hilo
  // con su etiqueta, y el redactor elige por dónde sale la respuesta (por defecto, por donde escribió la última vez).
  const [persona, setPersona] = useState<HiloPersona | null>(null)
  const [destino, setDestino] = useState<string | null>(null)
  const recargarPersona = useCallback(async () => {
    if (!asesor || !hiloDePersona || !convId) return
    const h = await hiloDePersona(convId)
    setPersona(h && h.conversaciones.length > 1 ? h : null)
  }, [asesor, hiloDePersona, convId])
  useEffect(() => { setPersona(null); setDestino(null) }, [convId])
  useEffect(() => { void recargarPersona() }, [recargarPersona, conv?.ultimo_seq])
  useEffect(() => {
    if (!persona) return
    const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void recargarPersona() }, intervaloMs)
    return () => clearInterval(t)
  }, [persona, recargarPersona, intervaloMs])
  const portalPropio = !conv?.canal && !conv?.whatsapp   // EDITAR-MENSAJES · solo en el portal (WhatsApp no deja cambiar lo enviado)
  const canalPropio: CanalPersona | null = persona?.conversaciones.find((c) => c.conversation_id === convId)?.canal ?? null

  // CHAT PRO · avisar "escribiendo…" (sin texto). Las pruebas pueden usar clientes sin este método.
  const ultimoPing = useRef(0)
  const avisarEscribiendo = (t: string) => {
    if (!convId || !puedoEscribir || !t.trim() || t.startsWith('/') || typeof cliente.escribiendo !== 'function') return
    const ahora = Date.now()
    if (ahora - ultimoPing.current < PING_ESCRIBIENDO_MS) return
    ultimoPing.current = ahora
    void cliente.escribiendo(convId, true)
  }
  // CHAT PRO · respuestas rápidas: solo para el personal que atiende.
  const conRespuestas = asesor && !!respuestas
  const [rrLista, setRrLista] = useState<RespuestaRapida[]>([])
  const [rrBoton, setRrBoton] = useState(false)
  const [rrActiva, setRrActiva] = useState(0)
  const cargarRespuestas = useCallback(() => { if (respuestas) void respuestas.listar().then(setRrLista) }, [respuestas])
  useEffect(() => { if (conRespuestas) cargarRespuestas() }, [conRespuestas, cargarRespuestas])
  const rrFiltro = texto.startsWith('/') ? texto.slice(1) : ''
  const rrAbierto = conRespuestas && puedoEscribir && (rrBoton || texto.startsWith('/'))
  const rrVisibles = useMemo(() => filtrar(rrLista, rrFiltro), [rrLista, rrFiltro])
  useEffect(() => { setRrActiva(0) }, [rrFiltro, rrAbierto])
  const cerrarRespuestas = () => { setRrBoton(false); if (texto.startsWith('/')) setTexto('') }
  // EXPEDIENTE EN EL CHAT · menú «+»: abre la hoja de la acción dentro del mismo chat.
  const [accAbierto, setAccAbierto] = useState(false)
  const menuAcc = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!accAbierto) return
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (!t || menuAcc.current?.contains(t) || (t as Element).closest?.('[data-testid="btn-acciones"]')) return
      setAccAbierto(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAccAbierto(false) }
    document.addEventListener('pointerdown', fuera); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', esc) }
  }, [accAbierto])
  const conAcciones = asesor && !!acciones?.length && !finAtencion
  useEffect(() => { if (!conAcciones) setAccAbierto(false) }, [conAcciones])
  const elegirRespuesta = (r: RespuestaRapida) => {
    const t = aplicarNombre(r.texto, nombreCliente)
    setRrBoton(false); setTexto(t)
    window.setTimeout(() => { const el = area.current; if (el) { el.focus(); autoAlto(el); el.setSelectionRange?.(t.length, t.length) } }, 0)
  }

  // Enviar con idempotencia: el MISMO client_message_id en cada reintento → nunca se duplica.
  const enviarTexto = async (t: string, clientId: string) => {
    if (!convId || enviando) return
    setEnviando(true); setError(null)
    setPendiente({ clientId, texto: t, error: null })
    const otro = destinoEfectivo && destinoEfectivo !== convId ? destinoEfectivo : null
    if (otro) {
      // HILO-PERSONA · sale por OTRO canal de la misma persona: si aún no la atiendo ahí, la retomo y reintento una vez.
      let r = await cliente.enviar(otro, t, clientId)
      if (!r.ok && ['asesoria_no_iniciada', 'no_autorizado', 'transicion_invalida'].includes(r.error.codigo)) {
        const rt = await retomar(otro)
        if (rt.ok) r = await cliente.enviar(otro, t, clientId)
        else { setPendiente({ clientId, texto: t, error: rt.mensaje }); setEnviando(false); return }
      }
      if (!r.ok) { setPendiente({ clientId, texto: t, error: r.error.mensaje }); setEnviando(false); return }
      await recargarPersona()
      setPendiente(null); setEnviando(false)
      return
    }
    if (soyResponsable || iniciaAlEscribir) {
      // CONV-WHATSAPP · primero retomar (o iniciar la asignada); si no se puede, el mensaje queda para reintentar.
      const previo = soyResponsable ? await retomar(convId)
        : await cliente.iniciar(convId).then((x) => (x.ok ? { ok: true as const } : { ok: false as const, mensaje: x.error.mensaje }))
      if (!previo.ok) { setPendiente({ clientId, texto: t, error: previo.mensaje }); setEnviando(false); return }
      await cargar(convId, 0)
    }
    const r = await cliente.enviar(convId, t, clientId)
    if (!r.ok) { setPendiente({ clientId, texto: t, error: r.error.mensaje }); setEnviando(false); return }
    if (r.data.ia === 'en_curso') setEsperaIA({ seq: r.data.seq, desde: Date.now() })
    await cargar(convId, ultimoSeq.current)
    setPendiente(null); setEnviando(false)
    if (!asesor) pedirAvisos('chat')   // PUSH SIEMPRE · el doctor acaba de escribir: que se entere cuando le respondan
  }
  // EDITAR-MENSAJES · como WhatsApp: el texto sube al cuadro, se corrige y se guarda (el cliente ve «editado»).
  const [editando, setEditando] = useState<Mensaje | null>(null)
  const empezarEdicion = (m: Mensaje) => { setEditando(m); setTexto(m.content); setTimeout(() => { if (area.current) { area.current.focus(); autoAlto(area.current) } }, 0) }
  const cancelarEdicion = () => { setEditando(null); setTexto('') }
  const guardarEdicion = async (t: string) => {
    if (!convId || !editando) return
    setEnviando(true); setError(null)
    const r = await cliente.editar(convId, editando.id, t)
    setEnviando(false)
    if (!r.ok) { setError(r.error.mensaje); return }
    const id = editando.id
    setConv((prev) => (prev ? { ...prev, mensajes: prev.mensajes.map((m) => (m.id === id ? { ...m, content: r.data.texto, editado: true } : m)) } : prev))
    setEditando(null); setTexto('')
  }
  const enviar = async () => {
    const t = texto.trim()
    if (editando) { if (t) await guardarEdicion(t); return }
    if (!t || enviando || pendiente?.error) return
    setTexto('')
    if (area.current) area.current.style.height = 'auto'
    await enviarTexto(t, nuevoClientId())
  }
  // FOTOS · mandar una imagen: se reduce en el dispositivo y viaja con su propio id (reintento sin duplicar).
  // CHAT-ARCHIVOS (3 nov 2026) · el mismo botón manda videos y documentos (hasta 50 MB) por la subida firmada.
  const archivo = useRef<HTMLInputElement | null>(null)
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const mandarArchivo = async (f: File | undefined) => {
    if (!f || !convId || subiendo) return
    setError(null)
    const tipo = tipoDe(f.name, f.type)
    const clase = claseDe(tipo)
    const problema = problemaArchivo(f)
    if (problema || !clase) { setError(problema ?? 'Ese archivo no se puede mandar.'); if (archivo.current) archivo.current.value = ''; return }
    setSubiendo(f.name)
    let r: { ok: boolean; error?: { mensaje: string } }
    if (clase === 'imagen') {
      const dataUrl = await reducir(f)
      r = dataUrl ? await cliente.adjuntar(convId, dataUrl) : { ok: false, error: { mensaje: 'No se pudo leer la imagen.' } }
    } else r = await cliente.archivo(convId, f, tipo)
    setSubiendo(null)
    if (archivo.current) archivo.current.value = ''
    if (!r.ok) { setError(r.error?.mensaje ?? 'No se pudo mandar el archivo.'); return }
    await cargar(convId, ultimoSeq.current)
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
  // D4-FIX · Terminar: si el servidor confirma, NO se relee (el asesor deja de tener acceso por diseño de C1); se
  // detiene el sondeo y quien monta vuelve a su lista con la confirmación. Un fallo real conserva su manejo.
  const terminarAsesoria = async (solicitud = false) => {
    if (!convId) return
    // TERMINAR-SOLICITUD · cerrar una solicitud que nadie inició se confirma: el cliente sigue con el asistente.
    if (solicitud && !(await confirmar('¿Cerrar esta solicitud de asesor? El cliente sigue con el asistente y puede volver a pedir un asesor cuando quiera.'))) return
    setErrorTerminar(null)
    const r = await cliente.terminar(convId)
    if (!r.ok) { setErrorTerminar(r.error.mensaje); await cargar(convId, 0); return }
    // CONV-WHATSAPP · si sigue siendo SU cliente, la conversación no se cierra: queda abierta para leer y retomar al escribir.
    const sigue = asesor ? await cliente.leer(convId, 0) : null
    if (sigue?.ok && sigue.data.rol === 'responsable') { await cargar(convId, 0); return }
    finRef.current = true; setFinAtencion('terminada')
    onFin?.('terminada')
  }
  const alTeclear = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (rrAbierto) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setRrActiva((i) => Math.min(i + 1, Math.max(rrVisibles.length - 1, 0))); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setRrActiva((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarRespuestas(); return }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && rrVisibles[rrActiva]) { e.preventDefault(); elegirRespuesta(rrVisibles[rrActiva]); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar() }
  }
  const autoAlto = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px` }

  const mensajes = useMemo(() => unirHilo(anteriores, conv?.mensajes ?? []), [anteriores, conv])
  type Mostrable = Mensaje & { canalMsg?: CanalPersona | null; otro?: boolean }
  const mostrar: Mostrable[] = useMemo(() => {
    if (!persona) return mensajes
    const propios: Mostrable[] = mensajes.map((m) => ({ ...m, canalMsg: canalPropio }))
    const otros: Mostrable[] = persona.mensajes.map((m) => ({ ...m, canalMsg: m.canal, otro: true }))
    return [...propios, ...otros].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.seq - b.seq)
  }, [persona, mensajes, canalPropio])
  // Por defecto se responde por donde el cliente escribió la última vez.
  const destinoSugerido = useMemo(() => {
    if (!persona) return null
    for (let i = mostrar.length - 1; i >= 0; i--) {
      const m = mostrar[i]
      if (m.actor === 'visitor' || m.actor === 'doctor') return m.otro ? (m as Mostrable & { conversation_id: string }).conversation_id : convId
    }
    return convId
  }, [persona, mostrar, convId])
  const destinoEfectivo = persona ? (destino ?? destinoSugerido) : null
  const aOtroCanal = !!destinoEfectivo && destinoEfectivo !== convId
  const escribible = puedoEscribir || aOtroCanal
  // HERRAMIENTAS DEL VENDEDOR · buscar una palabra en ESTE chat: resalta cada coincidencia y salta entre ellas.
  const [busq, setBusq] = useState<string | null>(null)
  const [busqIdx, setBusqIdx] = useState(0)
  const raiz = useRef<HTMLDivElement | null>(null)
  // SCROLL · el chat embebido mide el espacio que de verdad le queda en la pantalla (debajo de pestañas, avisos o la barra de
  // arriba) en vez de una altura fija: así el cuadro de escribir y el último mensaje nunca quedan fuera de la vista.
  useLayoutEffect(() => {
    if (!embebido || panel) return
    const el = raiz.current
    if (!el || typeof window === 'undefined') return
    const ajustar = () => {
      if (window.innerWidth < 901) { el.style.height = ''; return }   // en celular manda el CSS de siempre
      const lienzo = el.closest('.canvas') as HTMLElement | null
      const arriba = el.getBoundingClientRect().top + (lienzo?.scrollTop ?? 0) - (lienzo?.getBoundingClientRect().top ?? 0)
      const visible = lienzo ? lienzo.clientHeight : window.innerHeight
      const alto = Math.max(340, Math.floor(visible - arriba - 12))
      el.style.height = `${alto}px`
    }
    ajustar()
    window.addEventListener('resize', ajustar)
    const t = window.setTimeout(ajustar, 250)
    return () => { window.removeEventListener('resize', ajustar); window.clearTimeout(t) }
  }, [embebido, panel, cargando])
  const hallados = useMemo(() => {
    const b = normalizar((busq ?? '').trim())
    return b.length < 2 ? [] : mensajes.filter((m) => !m.adjunto && m.actor !== 'system' && normalizar(m.content).includes(b)).map((m) => m.id)
  }, [busq, mensajes])
  useEffect(() => { setBusqIdx(hallados.length ? hallados.length - 1 : 0) }, [hallados.length, busq])   // empieza por la más reciente
  const actualHallado = hallados[busqIdx] ?? null
  useEffect(() => {
    if (!actualHallado) return
    const el = raiz.current?.querySelector<HTMLElement>(`[data-msg-id="${actualHallado}"]`); const h = hiloRef.current
    if (el && h) h.scrollTop += el.getBoundingClientRect().top - h.getBoundingClientRect().top - h.clientHeight / 2 + el.clientHeight / 2
  }, [actualHallado])
  const cerrarBusqueda = () => { setBusq(null); setBusqIdx(0) }
  // PALOMITAS · azul = el otro lado ya lo vio: su cursor de lectura lo alcanzó, o ya respondió después (incluye al asistente).
  const ultimoAjeno = useMemo(() => mensajes.reduce((s, m) => (!m.propio && m.actor !== 'system' ? Math.max(s, m.seq) : s), 0), [mensajes])
  const visto = (seq: number): boolean => seq <= Math.max(conv?.leido_otro ?? 0, ultimoAjeno)
  const handoffVivo = !asesor && !!conv && !cerrada && !!conv.handoff?.origen && (modo === 'human_requested' || modo === 'human_assigned')
  // La tarjeta de handoff ocupa el lugar del último aviso del sistema (el servidor lo publica junto con el
  // handoff): así no hay banner + aviso duplicados. Si no hubiera aviso, la tarjeta va al final del hilo.
  const seqTarjeta = useMemo(() => (handoffVivo ? mensajes.filter((m) => m.actor === 'system').reduce((s, m) => Math.max(s, m.seq), 0) : 0), [handoffVivo, mensajes])
  const esperandoIA = (enviando || !!esperaIA) && !pendiente?.error && !asesor && IA_PUEDE(modo)
  const quienEscribe = (asesor ? primerNombre(nombreCliente) : primerNombre(nombreAsesor)) ?? (asesor ? 'Cliente' : ETIQUETA_ASESOR)

  const tarjetaHandoff = conv && handoffVivo ? (() => {
    const t = textoHandoff(conv)
    return (
      <div className="rc-card" role="status" data-testid="aviso-handoff">
        <div className="rc-card-mark" aria-hidden>{(nombreAsesor ?? 'R').slice(0, 1).toUpperCase()}</div>
        <div className="rc-card-body">
          <div className="rc-card-title">{t.titulo}</div>
          {t.detalle && <div className="rc-card-sub">{t.detalle}</div>}
          {conv.handoff?.puede_rechazar && (
            <button type="button" className="rc-link" onClick={() => accion(() => cliente.rechazarAsesor(convId!))} data-testid="btn-rechazar-asesor">Seguir solo con el asistente</button>
          )}
        </div>
      </div>
    )
  })() : null

  const hilo: React.ReactNode[] = []
  let diaPrevio = ''; let actorPrevio: string | null = null
  for (const m of mostrar) {
    const dia = diaDe(m.created_at)
    if (dia && dia !== diaPrevio) { hilo.push(<div key={`d-${m.seq}`} className="rc-day"><span>{dia}</span></div>); diaPrevio = dia; actorPrevio = null }
    if (m.actor === 'system') {
      if (handoffVivo && m.seq === seqTarjeta) hilo.push(<React.Fragment key={m.id}>{tarjetaHandoff}</React.Fragment>)
      else if (MARCA_PROMO.test(m.content)) hilo.push(<TarjetaPromoChat key={m.id} content={m.content} onCatalogo={!asesor ? onIrCatalogo : undefined} />)   // PROMO-6
      else if (MARCA_DIFUSION.test(m.content)) hilo.push(<TarjetaDifusion key={m.id} content={m.content} />)   // DIFUSIONES del vendedor
      else hilo.push(<div key={m.id} className="rc-sys" data-testid="msg-system">{m.content}</div>)
      actorPrevio = null
      continue
    }
    const clave = `${m.propio ? 'own' : m.actor}|${m.canalMsg ?? ''}`   // HILO-PERSONA · cambiar de canal abre otro grupo
    const inicio = clave !== actorPrevio
    actorPrevio = clave
    const etiqueta = etiquetaActor(m, visor, { nombreCliente, nombreAsesor, etiquetaAsesor: ETIQUETA_ASESOR })
    hilo.push(
      <div key={m.id} className={`rc-msg rc-msg--${m.propio ? 'own' : m.actor}${inicio ? ' rc-msg--inicio' : ''}${m.id === actualHallado ? ' rc-msg--hallado' : ''}`} data-testid={`msg-${m.actor}`} data-msg-id={m.id}>
        {inicio && !m.propio && m.actor === 'ai' && <span className="rc-avatar" aria-hidden><BrandLogo alt="" className="rc-logo" /></span>}
        {inicio && !m.propio && m.actor !== 'ai' && <span className="rc-avatar rc-avatar--persona" aria-hidden>{(etiqueta ?? '?').slice(0, 1)}</span>}
        <div className="rc-bubble-wrap">
          {inicio && (etiqueta || m.canalMsg) && <div className="rc-meta">{etiqueta}{m.canalMsg && <span className={`rc-canal rc-canal--${m.canalMsg}`} data-testid="msg-canal">{NOMBRE_CANAL_PERSONA[m.canalMsg]}</span>}</div>}
          {m.archivo ? (
            <div className="rc-bubble rc-bubble--img" title={horaDe(m.created_at)} data-testid={m.archivo.clase === 'video' ? 'msg-video' : m.archivo.clase === 'audio' ? 'msg-audio' : 'msg-documento'}>
              {!m.archivo.url ? <span className="rc-img-nd">{m.archivo.nombre} · no disponible</span>
                : m.archivo.clase === 'video' ? <div className="tc-adj tc-adj--video"><video src={m.archivo.url} controls preload="metadata" playsInline /></div>
                : m.archivo.clase === 'audio' ? <div className="tc-adj tc-adj--audio"><audio src={m.archivo.url} controls preload="metadata" aria-label="Nota de voz" /></div>
                : (
                  <a className="tc-adj tc-adj--doc" href={m.archivo.url} target="_blank" rel="noreferrer" download={m.archivo.nombre}>
                    <FileText size={22} aria-hidden />
                    <span className="tc-adj-meta"><span className="tc-adj-nombre">{m.archivo.nombre}</span><small>{[m.archivo.nombre.split('.').pop()?.toUpperCase(), pesoLegible(m.archivo.bytes)].filter(Boolean).join(' · ')}</small></span>
                    <Download size={17} aria-hidden />
                  </a>
                )}
            </div>
          ) : m.adjunto ? (
            <div className={'rc-bubble rc-bubble--img' + (m.content.startsWith('Envió un sticker') ? ' rc-bubble--sticker' : '')} title={horaDe(m.created_at)} data-testid={m.content.startsWith('Envió un sticker') ? 'msg-sticker' : 'msg-imagen'}>
              {m.adjunto.url
                ? <a href={m.adjunto.url} target="_blank" rel="noreferrer"><img className="rc-img" src={m.adjunto.url} alt={m.content.startsWith('Envió un sticker') ? 'Sticker' : 'Imagen enviada en la conversación'} loading="lazy" /></a>
                : <span className="rc-img-nd">Imagen no disponible</span>}
              {m.adjunto.uso && <span className="rc-img-uso">Usada como {m.adjunto.uso === 'ine-front' ? 'INE frente' : 'INE reverso'}</span>}
              {accionesAdjunto?.(m)}
            </div>
          ) : <div className="rc-bubble" title={horaDe(m.created_at)}>{busq && hallados.includes(m.id)
                ? partesResaltadas(m.content, busq).map((p, i) => (p.hallado ? <mark key={i} className="rc-mark-busq">{p.t}</mark> : <React.Fragment key={i}>{p.t}</React.Fragment>))
                : conEnlaces(m.content)}</div>}
          {asesor && portalPropio && !m.otro && editable(m) && !editando && (
            <button type="button" className="rc-editar" onClick={() => empezarEdicion(m)} aria-label="Editar mensaje" title="Editar (hasta 15 minutos)" data-testid="btn-editar-msg"><Pencil size={13} /></button>
          )}
          <time className="rc-hora" dateTime={m.created_at}>{m.editado && <span className="rc-editado" data-testid="msg-editado">editado · </span>}{horaDe(m.created_at)}{m.propio && !m.otro && (visto(m.seq)
            ? <CheckCheck className="rc-tick rc-tick--visto" size={15} aria-label="Visto" data-testid="tick-visto" />
            : <CheckCheck className="rc-tick" size={15} aria-label="Entregado" data-testid="tick-entregado" />)}</time>
        </div>
      </div>,
    )
  }
  if (handoffVivo && seqTarjeta === 0) hilo.push(<React.Fragment key="handoff">{tarjetaHandoff}</React.Fragment>)
  if (!asesor && conv && !cerrada && modo === 'human_active') hilo.push(<div key="join" className="rc-join" data-testid="aviso-asesor-activo"><span>{nombreAsesor ?? 'Tu asesor'} está contigo</span></div>)

  return (
    <div ref={raiz} className={`rc-chat${panel ? ' rc-chat--panel' : embebido ? ' rc-chat--embebido' : ' rc-chat--pagina'}${estilo === 'mensajeria' ? ' rc-chat--wa' : ''}`} data-testid="chat-canonico">
      <header className="rc-head">
        {/* Como en un mensajero: el personal ve la inicial de su cliente; el cliente ve el logo de Renovacell. */}
        {asesor && nombreVisible
          ? <div className="rc-mark rc-mark--inicial" aria-hidden>{nombreVisible.replace(/^(dra?\.?|doctora?|lic\.?)\s+/i, '').slice(0, 1).toUpperCase()}</div>
          : <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>}
        <div className="rc-title">
          <div className="rc-name">{asesor ? (nombreVisible || telVisible || 'Asesoría') : 'Renovacell'}</div>
          {/* CONV-WHATSAPP · el personal ve SIEMPRE el número (como en WhatsApp), luego el canal y quién atiende. */}
          <div className={`rc-state${otroEscribiendo ? ' rc-state--escribiendo' : ''}`} data-testid="chat-modo">{otroEscribiendo ? 'escribiendo…' : <>
            {telVisible && nombreVisible && <a className="rc-tel" href={`tel:${telVisible.replace(/\s/g, '')}`} data-testid="chat-telefono">{telVisible}</a>}
            {telVisible && nombreVisible && ' · '}
            {`${canal ? NOMBRE_CANAL[canal.canal] + ' · ' : ''}${soyResponsable && (modo === 'ai_active' || modo === 'human_offered') ? 'La atiende el asistente' : subtituloDe(conv, asesor)}`}
          </>}</div>
        </div>
        <div className="rc-actions">
          {conv && !finAtencion && (
            <button type="button" className={`rc-ico${busq !== null ? ' rc-ico--on' : ''}`} onClick={() => (busq !== null ? cerrarBusqueda() : setBusq(''))}
              aria-label="Buscar en esta conversación" aria-pressed={busq !== null} title="Buscar en esta conversación" data-testid="btn-buscar-chat"><Search size={18} /></button>
          )}
          {!finAtencion && soyAsesor && conv && modo === 'human_assigned' && conv.asesor_soy_yo && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.iniciar(convId!))} data-testid="btn-iniciar"><span className="rc-larga">Iniciar asesoría</span><span className="rc-corta" aria-hidden>Iniciar</span></button>
          )}
          {/* D4-FIX · solo en los estados que el backend acepta (human_active / human_ended); en human_assigned se pulsa "Iniciar" */}
          {!finAtencion && soyAsesor && conv && (modo === 'human_active' || modo === 'human_ended') && (conv.asesor_soy_yo || conv.rol === 'supervisor') && (
            <button type="button" className="btn ghost sm" onClick={() => void terminarAsesoria()} data-testid="btn-terminar"><span className="rc-larga">Terminar asesoría</span><span className="rc-corta" aria-hidden>Terminar</span></button>
          )}
          {/* TERMINAR-SOLICITUD (mig 20270205) · una solicitud sin iniciar también se cierra: Dirección cualquiera, el
              vendedor la que tiene asignada. Sin vendedor solo Dirección (lo decide la base). */}
          {!finAtencion && soyAsesor && conv && !cerrada && (modo === 'human_requested' || modo === 'human_assigned') && (conv.rol === 'supervisor' || conv.asesor_soy_yo) && (
            <button type="button" className="btn ghost sm" onClick={() => void terminarAsesoria(true)} data-testid="btn-cerrar-solicitud"><span className="rc-larga">Cerrar solicitud</span><span className="rc-corta" aria-hidden>Cerrar</span></button>
          )}
          {!finAtencion && conv?.rol === 'supervisor' && conv && modo !== 'ai_active' && !cerrada && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.liberar(convId!))}>Devolver a la cola</button>
          )}
          {onSalir && panel && <button type="button" className="rc-ico" onClick={onSalir} aria-label="Minimizar" title="Minimizar" data-testid="btn-minimizar"><ChevronDown size={18} /></button>}
          {onSalir && <button type="button" className="rc-ico" onClick={onSalir} aria-label={etiquetaSalir} title={etiquetaSalir} data-testid="btn-salir"><X size={18} /></button>}
        </div>
      </header>
      {busq !== null && (
        <div className="rc-busq" role="search" data-testid="chat-busqueda"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrarBusqueda() } }}>
          <Search size={15} aria-hidden />
          <input autoFocus value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar en esta conversación" aria-label="Buscar en esta conversación" data-testid="chat-busqueda-q"
            onKeyDown={(e) => { if (e.key === 'Enter' && hallados.length) { e.preventDefault(); setBusqIdx((i) => (e.shiftKey ? (i + 1) % hallados.length : (i - 1 + hallados.length) % hallados.length)) } }} />
          <span className="rc-busq-n" data-testid="chat-busqueda-n">{busq.trim().length < 2 ? '' : hallados.length ? `${hallados.length - busqIdx} de ${hallados.length}` : 'Sin resultados'}</span>
          <button type="button" className="rc-ico" disabled={!hallados.length} onClick={() => setBusqIdx((i) => (i - 1 + hallados.length) % hallados.length)} aria-label="Anterior (más antigua)"><ChevronUp size={17} /></button>
          <button type="button" className="rc-ico" disabled={!hallados.length} onClick={() => setBusqIdx((i) => (i + 1) % hallados.length)} aria-label="Siguiente (más reciente)"><ChevronDown size={17} /></button>
          <button type="button" className="rc-ico" onClick={cerrarBusqueda} aria-label="Cerrar búsqueda"><X size={17} /></button>
        </div>
      )}
      {barra && <div className="rc-barra" data-testid="chat-barra">{barra}</div>}
      {tira && !finAtencion && <div className="rc-tira" data-testid="chat-tira">{tira}</div>}

      {finAtencion ? (
        <div className="rc-thread" data-testid="asesoria-fin">
          <div className="rc-card" role="status" data-testid={finAtencion === 'terminada' ? 'aviso-asesoria-finalizada' : 'aviso-sin-asignacion'}>
            <div className="rc-card-body">
              <div className="rc-card-title">{finAtencion === 'terminada' ? TEXTO_ASESORIA_FINALIZADA : TEXTO_SIN_ASIGNACION}</div>
              {onSalir && <button type="button" className="rc-link" onClick={onSalir} data-testid="btn-volver-asesorias">Volver a Asesorías</button>}
            </div>
          </div>
        </div>
      ) : (<>
      {conCarrito && convId && conv && (
        // Dueño: su carrito activo ligado a esta conversación. Asesor/Dirección: el carrito del dueño, solo lectura (el servidor lo decide).
        <CarritoPanel senal={conv.mensajes[conv.mensajes.length - 1]?.seq} conversationId={asesor ? null : convId} cartId={asesor ? conv.cart_id ?? null : null} soloLectura={asesor} cliente={clienteCarrito} />
      )}

      <div className="rc-thread" aria-live="polite" ref={hiloRef}>
        {inicioHilo}
        {cargando && <div className="rc-sys">Cargando conversación…</div>}
        {!cargando && quedan.length > 0 && (
          <div className="rc-day rc-day--mas"><button type="button" className="rc-link" onClick={() => void verAnteriores()} disabled={cargandoAnt} data-testid="ver-anteriores">{cargandoAnt ? 'Cargando…' : 'Ver mensajes anteriores'}</button></div>
        )}
        {!cargando && mensajes.length === 0 && !error && !pendiente && (
          <div className="rc-msg rc-msg--ai rc-msg--inicio" data-testid="msg-bienvenida"><span className="rc-avatar" aria-hidden><BrandLogo alt="" className="rc-logo" /></span><div className="rc-bubble-wrap"><div className="rc-meta">Asistente</div><div className="rc-bubble">{asesor ? 'Sin mensajes todavía.' : 'Hola, soy el asistente de Renovacell. ¿En qué te ayudo?'}</div></div></div>
        )}
        {hilo}
        {pendiente && (
          <div className={`rc-msg rc-msg--own rc-msg--inicio${pendiente.error ? ' rc-msg--fallo' : ' rc-msg--pendiente'}`} data-testid="msg-pendiente">
            <div className="rc-bubble-wrap">
              <div className="rc-bubble">{pendiente.texto}</div>
              {pendiente.error
                ? <div className="rc-fallo" role="alert">No se envió. <button type="button" className="rc-link" onClick={reintentar} data-testid="btn-reintentar">Reintentar</button> · <button type="button" className="rc-link" onClick={descartarPendiente}>Editar</button></div>
                : <div className="rc-hora rc-hora--fija" aria-label="Enviando"><Check className="rc-tick" size={15} data-testid="tick-enviando" /></div>}
            </div>
          </div>
        )}
        {esperandoIA && <div className="rc-msg rc-msg--ai rc-msg--inicio" data-testid="escribiendo" aria-label="El asistente está escribiendo"><span className="rc-avatar" aria-hidden><BrandLogo alt="" className="rc-logo" /></span><div className="rc-bubble-wrap"><div className="rc-bubble rc-typing"><i /><i /><i /></div></div></div>}
        {otroEscribiendo && !esperandoIA && (
          <div className={`rc-msg rc-msg--${asesor ? 'doctor' : 'seller'} rc-msg--inicio`} data-testid="otro-escribiendo" aria-label={`${quienEscribe} está escribiendo`}>
            <span className="rc-avatar rc-avatar--persona" aria-hidden>{quienEscribe.slice(0, 1).toUpperCase()}</span>
            <div className="rc-bubble-wrap"><div className="rc-bubble rc-typing"><i /><i /><i /></div></div>
          </div>
        )}
        {tarjetaFinal}
        <div ref={fin} />
      </div>

      {(error ?? errorTerminar) && !finAtencion && <div role="alert" className="rc-error">{error ?? errorTerminar}</div>}
      {/* BOT DETECTADO · el freno vio respuestas automáticas de otro sistema: se avisa al personal (el contacto no lo ve). */}
      {canal?.bot && (
        <div className="rc-wa-aviso rc-wa-aviso--bot" role="status" data-testid="aviso-bot">
          🤖 <b>Parece un bot</b>: {canal.bot.motivo === 'numero_empresa' ? 'escribe desde un número 800 de empresa y su mensaje no trae texto' : 'manda respuestas automáticas de otro sistema'}. La IA dejó de contestarle para no gastar. Si es una persona, contéstale tú.
        </div>
      )}
      {/* WA-2 · el cliente escribe por WhatsApp: qué le llega y qué no (solo lo ve el personal). */}
      {canal && (canal.modo === 'espejo'
        ? <div className="rc-wa-aviso" role="status" data-testid="wa-espejo">{NOMBRE_CANAL[canal.canal]} en modo espejo: aquí ves sus mensajes, pero todavía se contestan en Leadsales; desde aquí no se puede escribir.</div>
        : !canal.ventana_abierta
          ? <div className="rc-wa-aviso rc-wa-aviso--cerrada" role="status" data-testid="wa-ventana">
              {canal.canal === 'whatsapp'
                ? <>Escribió por WhatsApp hace más de 24 horas: Meta solo deja mandarle un mensaje aprobado (plantilla). Cuando conteste, sigue la plática aquí.</>
                : <>Escribió por {NOMBRE_CANAL[canal.canal]} hace más de 24 horas: lo que escribas queda aquí pero no le llega por {NOMBRE_CANAL[canal.canal]} hasta que vuelva a escribir (regla de Meta).</>}
              {/* WA-PLANTILLAS (3 nov 2026) · retomarlo con una plantilla aprobada, llamarle o abrir su WhatsApp. */}
              {canal.canal === 'whatsapp' && asesor && convId && <RetomarWhatsApp conversationId={convId} waId={canal.id} nombreCliente={nombreCliente} onEnviada={() => void cargar(convId, 0)} />}
            </div>
          : null)}

      {hoja && !finAtencion && <div className="rc-hoja" data-testid="chat-hoja">{hoja}</div>}
      {accAbierto && conAcciones && (
        <div ref={menuAcc} className="rc-acc-menu" role="menu" aria-label="Acciones con este cliente" data-testid="menu-acciones"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAccAbierto(false) } }}>
          {/* Se cierra con el ✕, tocando fuera o con Esc (antes solo volviendo a tocar el «+», y nadie lo encontraba). */}
          <div className="rc-acc-head"><b>Acciones con este cliente</b>
            <button type="button" className="rc-ico" onClick={() => setAccAbierto(false)} aria-label="Cerrar acciones" title="Cerrar" data-testid="acciones-cerrar"><X size={17} /></button>
          </div>
          {acciones!.map((a) => (
            <button key={a.clave} type="button" role="menuitem" className="rc-acc-item" onClick={() => { setAccAbierto(false); a.onElegir() }} data-testid={`accion-${a.clave}`}>
              {a.icono && <span className="rc-acc-ico" aria-hidden>{a.icono}</span>}
              <span className="rc-acc-tx"><b>{a.etiqueta}</b>{a.detalle && <small>{a.detalle}</small>}</span>
            </button>
          ))}
        </div>
      )}
      {rrAbierto && respuestas && (
        <RespuestasRapidas lista={rrVisibles} activa={rrActiva} filtro={rrFiltro} onElegir={elegirRespuesta} onCerrar={cerrarRespuestas}
          onCambio={cargarRespuestas} cliente={respuestas} puedeEmpresa={puedeEmpresa} nombre={nombreCliente} />
      )}
      {subiendo && <div className="rc-subiendo" role="status" data-testid="subiendo">Subiendo {subiendo}…</div>}
      {persona && (
        <div className="rc-canal-sel" role="radiogroup" aria-label="Responder por" data-testid="responder-por">
          <span>Responder por</span>
          {persona.conversaciones.map((c) => (
            <button key={c.conversation_id} type="button" role="radio" aria-checked={destinoEfectivo === c.conversation_id}
              className={`rc-canal-op rc-canal--${c.canal}${destinoEfectivo === c.conversation_id ? ' on' : ''}`} onClick={() => setDestino(c.conversation_id)}
              data-testid={`responder-por-${c.canal}`}>{NOMBRE_CANAL_PERSONA[c.canal]}</button>
          ))}
        </div>
      )}
      {editando && (
        <div className="rc-editando" data-testid="editando">
          <Pencil size={14} aria-hidden /><span><b>Editando mensaje</b><small>{editando.content.slice(0, 80)}</small></span>
          <button type="button" className="rc-ico" onClick={cancelarEdicion} aria-label="Cancelar edición" data-testid="cancelar-edicion"><X size={16} /></button>
        </div>
      )}
      <form className="rc-composer" onSubmit={(e) => { e.preventDefault(); void enviar() }}>
        <input ref={archivo} type="file" accept={ACEPTA} hidden onChange={(e) => void mandarArchivo(e.target.files?.[0])} data-testid="input-imagen" />
        {conAcciones && (
          <button type="button" className={`rc-ico rc-adjuntar rc-mas${accAbierto ? ' rc-ico--on' : ''}`} onClick={() => { setRrBoton(false); setAccAbierto((v) => !v) }}
            aria-label="Acciones con este cliente" aria-expanded={accAbierto} aria-haspopup="menu" title="Verificar, mandar acceso, cotizar, registrar pago…" data-testid="btn-acciones"><Plus size={21} /></button>
        )}
        {conRespuestas && (
          <button type="button" className={`rc-ico rc-adjuntar${rrBoton ? ' rc-ico--on' : ''}`} onClick={() => { setAccAbierto(false); setRrBoton((v) => !v) }} disabled={!puedoEscribir}
            aria-label="Respuestas rápidas" aria-expanded={rrAbierto} title="Respuestas rápidas (o escribe /)" data-testid="btn-respuestas"><Zap size={19} /></button>
        )}
        <button type="button" className="rc-ico rc-adjuntar" onClick={() => archivo.current?.click()} disabled={!puedoEscribir || !!subiendo} aria-label={subiendo ? `Subiendo ${subiendo}` : 'Mandar foto, video o documento'} title="Mandar foto, video o documento" data-testid="btn-imagen"><Paperclip size={20} /></button>
        <textarea
          ref={area} className="rc-input" aria-label="Escribe tu mensaje" value={texto} rows={1} maxLength={4000}
          onChange={(e) => { setTexto(e.target.value); autoAlto(e.target); avisarEscribiendo(e.target.value) }} onKeyDown={alTeclear}
          disabled={!escribible || enviando || !!pendiente?.error}
          placeholder={aOtroCanal ? `Escribe por ${NOMBRE_CANAL_PERSONA[persona!.conversaciones.find((c) => c.conversation_id === destinoEfectivo)?.canal ?? 'portal']}…` : cerrada ? 'La conversación está cerrada' : bloqueoEscritura ? bloqueoEscritura : soyResponsable ? 'Escribe para retomar la conversación…' : iniciaAlEscribir ? 'Escribe para iniciar la asesoría…' : soyAsesor && modo !== 'human_active' && conv?.rol !== 'supervisor' ? 'Inicia la asesoría para escribir' : 'Escribe tu mensaje…'}
          enterKeyHint="send" autoComplete="off" autoCapitalize="sentences" inputMode="text"
        />
        <button type="submit" className="rc-send" disabled={!escribible || enviando || !texto.trim() || !!pendiente?.error} aria-label={enviando ? 'Enviando' : 'Enviar'} title="Enviar" data-testid="btn-enviar"><Send size={18} /></button>
      </form>
      {notaRedactor && <div className="rc-nota-redactor">{notaRedactor}</div>}
      {!asesor && conv && !cerrada && (modo === 'ai_active' || modo === 'human_offered') && (
        <div className="rc-foot"><button type="button" className="rc-link" onClick={() => accion(() => cliente.solicitarAsesor(convId!))} data-testid="btn-asesor">¿Prefieres hablar con un asesor?</button></div>
      )}
      {!asesor && conv && !cerrada && modo === 'human_ended' && (
        <div className="rc-foot"><button type="button" className="rc-link" onClick={() => accion(() => cliente.reanudarIA(convId!))} data-testid="btn-reanudar">Seguir con el asistente</button></div>
      )}
      </>)}
    </div>
  )
}
