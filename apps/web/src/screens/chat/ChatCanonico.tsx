// CC-2 → UX V2-B · La conversación canónica como producto conversacional (no un panel de ERP): sirve a
// tres entradas con el MISMO componente y el MISMO hilo: visitante en /chat (token CC-1), doctor en el
// portal (página o cajón flotante, JWT) y asesor/Dirección abriendo una conversación asignada.
// Transporte: polling acotado y solo con la pestaña visible; la autoridad SIEMPRE es el servidor
// (modo, asesor, handoff, carrito). Aquí solo se presenta y se envía con idempotencia (client_message_id).
import { suscribirMensajes, type Suscriptor } from '../../data/ops/chatRealtime'
import { TarjetaPromoChat } from './TarjetaPromoChat'
import { MARCA_PROMO } from '../../data/ops/promociones'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, CheckCheck, ChevronDown, History, Plus, Send, X, Zap } from 'lucide-react'
import { reducirFoto } from '../../data/ops/verificacion'
import { BrandLogo } from '../../app/BrandLogo'
import { chat as clientePorDefecto, ETIQUETA_MODO, IA_PUEDE, nuevoClientId, type ClienteChat, type Conversacion, type Mensaje, type ModoConversacion, canalDe, NOMBRE_CANAL } from '../../data/ops/chat'
import { CarritoPanel } from './CarritoPanel'   // CC-5 · carrito canónico (dueño muta; asesor/Dirección solo lee)
import type { ClienteCarrito } from '../../data/ops/carrito'
import { diaNegocio, hoyNegocio, sumarDias, ZONA_NEGOCIO } from '../../data/periodo'
import { diaEtiqueta, etiquetaActor, type Visor } from '../../data/ops/sesionesPresentacion'
import { HistorialConversacion, type CacheSesion } from './HistorialSesiones'   // Chat V2-C3 · historial de solo lectura
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { RespuestasRapidas } from './RespuestasRapidas'   // CHAT PRO · textos listos del personal
import { aplicarNombre, filtrar, respuestasRapidas as respuestasPorDefecto, type ClienteRespuestas, type RespuestaRapida } from '../../data/ops/respuestasRapidas'

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
}

/** Una acción del menú «+» del redactor (solo personal). */
export interface AccionChat { clave: string; etiqueta: string; detalle?: string; icono?: React.ReactNode; onElegir: () => void }

// CHAT PRO · "escribiendo…": se avisa al servidor como mucho cada 3 s mientras se teclea; la marca vence sola en 6 s.
const PING_ESCRIBIENDO_MS = 3000
const SONDEO_ESCRIBIENDO_MS = 1500

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
// Chat V2-C3 · ACTUAL = la conversación viva; HISTORIAL = lista/lector de solo lectura (mismo contenedor).
type Vista = { tipo: 'actual' } | { tipo: 'historial'; sesion: string | null }

/** Chat V2-C3 · mensajes que ve ACTUAL: si el servidor devuelve la última sesión CERRADA, ACTUAL va vacío. */
export const mensajesActuales = (conv: Conversacion | null): Mensaje[] => (!conv || conv.sesion?.estado === 'cerrada' ? [] : conv.mensajes)

export function ChatCanonico({ embebido = false, conversationId, asesor = false, cliente = clientePorDefecto, intervaloMs = 4000, onSalir, conCarrito = true, clienteCarrito, panel = false, onLeido, etiquetaSalir = 'Cerrar', autoFoco = false, nombreCliente = null, onFin, barra, accionesAdjunto, reducir = reducirFoto, tarjetaFinal, suscribir = suscribirMensajes, respuestas = respuestasPorDefecto, puedeEmpresa = false, estilo = 'mensajeria', onIrCatalogo, bloqueoEscritura = null, tira, acciones, hoja }: Props) {
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
  // Chat V2-C3 · historial: vista, caché por sesión (cerradas = inmutables), cursor de lectura diferido y aviso.
  const [vista, setVista] = useState<Vista>({ tipo: 'actual' })
  const enHistorial = useRef(false)
  const porLeer = useRef(0)            // máximo seq de ACTUAL recibido mientras HISTORIAL estaba visible (sin `leido`)
  const anunciado = useRef(0)          // máximo seq ajeno ya avisado (dedupe del aviso por seq)
  const [nuevoActual, setNuevoActual] = useState(false)
  const cache = useRef(new Map<string, CacheSesion>())
  const botonHist = useRef<HTMLButtonElement | null>(null)
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
    if (asesor && (r.data.rol === 'asesor' || r.data.rol === 'supervisor')) autorizado.current = true
    setError(null)
    setConv((prev) => {
      if (!prev || desde === 0 || prev.conversation_id !== id) return r.data
      // Chat V2-C1 · el servidor muestra SOLO la sesión actual: si cambió de sesión, el hilo empieza de nuevo.
      if (r.data.sesion?.id && prev.sesion?.id && r.data.sesion.id !== prev.sesion.id) return r.data
      const vistos = new Set(prev.mensajes.map((m) => m.seq))
      return { ...r.data, mensajes: [...prev.mensajes, ...r.data.mensajes.filter((m) => !vistos.has(m.seq))] }
    })
    const max = r.data.mensajes.reduce((s, m) => Math.max(s, m.seq), desde)
    if (max <= ultimoSeq.current) return
    ultimoSeq.current = max
    if (enHistorial.current) {
      // Chat V2-C3 · con HISTORIAL visible NO se marca leído; actividad ajena nueva → aviso (una vez por seq).
      porLeer.current = max
      const ajeno = r.data.mensajes.reduce((s, m) => (m.propio ? s : Math.max(s, m.seq)), 0)
      if (ajeno > anunciado.current) { anunciado.current = ajeno; setNuevoActual(true) }
      return
    }
    void cliente.leido(id, max); onLeido?.(max)
  }, [cliente, onLeido, asesor])

  const abrirHistorial = (sesion: string | null) => {
    enHistorial.current = true; anunciado.current = ultimoSeq.current; porLeer.current = 0
    setNuevoActual(false); setVista({ tipo: 'historial', sesion })
  }
  const volverActual = () => {
    enHistorial.current = false; setNuevoActual(false); setVista({ tipo: 'actual' })
    // De vuelta en ACTUAL: lectura normal de lo que llegó mientras tanto.
    if (convId && porLeer.current > 0) { const s = porLeer.current; porLeer.current = 0; void cliente.leido(convId, s); onLeido?.(s) }
    window.setTimeout(() => botonHist.current?.focus(), 0)
  }

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

  // Polling acotado, solo con la pestaña visible.
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
    const t = setInterval(() => { void cargar(convId, ultimoSeq.current) }, SONDEO_ESCRIBIENDO_MS)
    return () => clearInterval(t)
  }, [convId, finAtencion, otroEscribiendo, cargar])

  // Al final del hilo tras cada cambio (y de nuevo tras el layout/fuentes): el último elemento siempre visible.
  const alFinal = useCallback(() => { fin.current?.scrollIntoView?.({ block: 'end' }) }, [])
  useEffect(() => {
    alFinal()
    const raf = requestAnimationFrame(alFinal); const t = window.setTimeout(alFinal, 180)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t) }
  }, [conv?.mensajes.length, conv?.modo, pendiente, enviando, cargando, alFinal, vista, otroEscribiendo])
  useEffect(() => { if (autoFoco && !cargando) area.current?.focus() }, [autoFoco, cargando])

  const modo: ModoConversacion = conv?.modo ?? 'ai_active'
  const cerrada = conv?.estado === 'cerrada'
  const soyAsesor = asesor && (conv?.rol === 'asesor' || conv?.rol === 'supervisor')
  // CANAL (WhatsApp / Instagram / Facebook) · en modo espejo lo que se escribiera aquí NUNCA saldría por el canal (se contesta en
  // Leadsales): el redactor se apaga.
  const canal = asesor ? canalDe(conv) : null
  const waEspejo = !!canal && canal.modo === 'espejo'
  const puedoEscribir = !!conv && !cerrada && !waEspejo && !bloqueoEscritura && (soyAsesor ? modo === 'human_active' || conv.rol === 'supervisor' : true)
  const nombreAsesor = conv?.asesor_nombre?.trim() || null
  const anterior = conv?.sesion?.estado === 'cerrada' ? conv.sesion : null   // D1: no se muestra como actual

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
  // FOTOS · mandar una imagen: se reduce en el dispositivo y viaja con su propio id (reintento sin duplicar).
  const archivo = useRef<HTMLInputElement | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const mandarImagen = async (f: File | undefined) => {
    if (!f || !convId || subiendo) return
    setSubiendo(true); setError(null)
    const dataUrl = await reducir(f)
    if (!dataUrl) { setSubiendo(false); setError('No se pudo leer la imagen.'); return }
    const r = await cliente.adjuntar(convId, dataUrl)
    setSubiendo(false)
    if (archivo.current) archivo.current.value = ''
    if (!r.ok) { setError(r.error.mensaje); return }
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
    if (solicitud && !window.confirm('¿Cerrar esta solicitud de asesor? El cliente sigue con el asistente y puede volver a pedir un asesor cuando quiera.')) return
    setErrorTerminar(null)
    const r = await cliente.terminar(convId)
    if (!r.ok) { setErrorTerminar(r.error.mensaje); await cargar(convId, 0); return }
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

  const mensajes = useMemo(() => mensajesActuales(conv), [conv])
  // PALOMITAS · azul = el otro lado ya lo vio: su cursor de lectura lo alcanzó, o ya respondió después (incluye al asistente).
  const ultimoAjeno = useMemo(() => mensajes.reduce((s, m) => (!m.propio && m.actor !== 'system' ? Math.max(s, m.seq) : s), 0), [mensajes])
  const visto = (seq: number): boolean => seq <= Math.max(conv?.leido_otro ?? 0, ultimoAjeno)
  const handoffVivo = !asesor && !!conv && !cerrada && !!conv.handoff?.origen && (modo === 'human_requested' || modo === 'human_assigned')
  // La tarjeta de handoff ocupa el lugar del último aviso del sistema (el servidor lo publica junto con el
  // handoff): así no hay banner + aviso duplicados. Si no hubiera aviso, la tarjeta va al final del hilo.
  const seqTarjeta = useMemo(() => (handoffVivo ? mensajes.filter((m) => m.actor === 'system').reduce((s, m) => Math.max(s, m.seq), 0) : 0), [handoffVivo, mensajes])
  const esperandoIA = enviando && !pendiente?.error && !asesor && IA_PUEDE(modo)
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
  for (const m of mensajes) {
    const dia = diaDe(m.created_at)
    if (dia && dia !== diaPrevio) { hilo.push(<div key={`d-${m.seq}`} className="rc-day"><span>{dia}</span></div>); diaPrevio = dia; actorPrevio = null }
    if (m.actor === 'system') {
      if (handoffVivo && m.seq === seqTarjeta) hilo.push(<React.Fragment key={m.id}>{tarjetaHandoff}</React.Fragment>)
      else if (MARCA_PROMO.test(m.content)) hilo.push(<TarjetaPromoChat key={m.id} content={m.content} onCatalogo={!asesor ? onIrCatalogo : undefined} />)   // PROMO-6
      else hilo.push(<div key={m.id} className="rc-sys" data-testid="msg-system">{m.content}</div>)
      actorPrevio = null
      continue
    }
    const clave = m.propio ? 'own' : m.actor
    const inicio = clave !== actorPrevio
    actorPrevio = clave
    const etiqueta = etiquetaActor(m, visor, { nombreCliente, nombreAsesor, etiquetaAsesor: ETIQUETA_ASESOR })
    hilo.push(
      <div key={m.id} className={`rc-msg rc-msg--${m.propio ? 'own' : m.actor}${inicio ? ' rc-msg--inicio' : ''}`} data-testid={`msg-${m.actor}`}>
        {inicio && !m.propio && m.actor === 'ai' && <span className="rc-avatar" aria-hidden><BrandLogo alt="" className="rc-logo" /></span>}
        {inicio && !m.propio && m.actor !== 'ai' && <span className="rc-avatar rc-avatar--persona" aria-hidden>{(etiqueta ?? '?').slice(0, 1)}</span>}
        <div className="rc-bubble-wrap">
          {inicio && etiqueta && <div className="rc-meta">{etiqueta}</div>}
          {m.adjunto ? (
            <div className="rc-bubble rc-bubble--img" title={horaDe(m.created_at)} data-testid="msg-imagen">
              {m.adjunto.url
                ? <a href={m.adjunto.url} target="_blank" rel="noreferrer"><img className="rc-img" src={m.adjunto.url} alt="Imagen enviada en la conversación" loading="lazy" /></a>
                : <span className="rc-img-nd">Imagen no disponible</span>}
              {m.adjunto.uso && <span className="rc-img-uso">Usada como {m.adjunto.uso === 'ine-front' ? 'INE frente' : 'INE reverso'}</span>}
              {accionesAdjunto?.(m)}
            </div>
          ) : <div className="rc-bubble" title={horaDe(m.created_at)}>{conEnlaces(m.content)}</div>}
          <time className="rc-hora" dateTime={m.created_at}>{horaDe(m.created_at)}{m.propio && (visto(m.seq)
            ? <CheckCheck className="rc-tick rc-tick--visto" size={15} aria-label="Visto" data-testid="tick-visto" />
            : <CheckCheck className="rc-tick" size={15} aria-label="Entregado" data-testid="tick-entregado" />)}</time>
        </div>
      </div>,
    )
  }
  if (handoffVivo && seqTarjeta === 0) hilo.push(<React.Fragment key="handoff">{tarjetaHandoff}</React.Fragment>)
  if (!asesor && conv && !cerrada && modo === 'human_active') hilo.push(<div key="join" className="rc-join" data-testid="aviso-asesor-activo"><span>{nombreAsesor ?? 'Tu asesor'} está contigo</span></div>)

  return (
    <div className={`rc-chat${panel ? ' rc-chat--panel' : embebido ? ' rc-chat--embebido' : ' rc-chat--pagina'}${estilo === 'mensajeria' ? ' rc-chat--wa' : ''}`} data-testid="chat-canonico"
      onKeyDown={(e) => { if (e.key === 'Escape' && vista.tipo === 'historial') { e.stopPropagation(); volverActual() } }}>
      <header className="rc-head">
        {/* Como en un mensajero: el personal ve la inicial de su cliente; el cliente ve el logo de Renovacell. */}
        {asesor && capitalizarNombre(nombreCliente)
          ? <div className="rc-mark rc-mark--inicial" aria-hidden>{capitalizarNombre(nombreCliente).replace(/^(dra?\.?|doctora?|lic\.?)\s+/i, '').slice(0, 1).toUpperCase()}</div>
          : <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>}
        <div className="rc-title">
          <div className="rc-name">{asesor ? (capitalizarNombre(nombreCliente) || 'Asesoría') : 'Renovacell'}</div>
          <div className={`rc-state${otroEscribiendo ? ' rc-state--escribiendo' : ''}`} data-testid="chat-modo">{otroEscribiendo ? 'escribiendo…' : `${canal ? NOMBRE_CANAL[canal.canal] + ' · ' : ''}${subtituloDe(conv, asesor)}`}</div>
        </div>
        <div className="rc-actions">
          {conv?.sesion && convId && (
            <button type="button" ref={botonHist} className={`rc-ico rc-ico--hist${vista.tipo === 'historial' ? ' rc-ico--on' : ''}`} onClick={() => (vista.tipo === 'historial' ? volverActual() : abrirHistorial(null))}
              aria-label="Conversaciones anteriores" aria-pressed={vista.tipo === 'historial'} title="Conversaciones anteriores" data-testid="btn-historial"><History size={18} /></button>
          )}
          {!finAtencion && vista.tipo === 'actual' && soyAsesor && conv && modo === 'human_assigned' && conv.asesor_soy_yo && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.iniciar(convId!))} data-testid="btn-iniciar"><span className="rc-larga">Iniciar asesoría</span><span className="rc-corta" aria-hidden>Iniciar</span></button>
          )}
          {/* D4-FIX · solo en los estados que el backend acepta (human_active / human_ended); en human_assigned se pulsa "Iniciar" */}
          {!finAtencion && vista.tipo === 'actual' && soyAsesor && conv && (modo === 'human_active' || modo === 'human_ended') && (conv.asesor_soy_yo || conv.rol === 'supervisor') && (
            <button type="button" className="btn ghost sm" onClick={() => void terminarAsesoria()} data-testid="btn-terminar"><span className="rc-larga">Terminar asesoría</span><span className="rc-corta" aria-hidden>Terminar</span></button>
          )}
          {/* TERMINAR-SOLICITUD (mig 20270205) · una solicitud sin iniciar también se cierra: Dirección cualquiera, el
              vendedor la que tiene asignada. Sin vendedor solo Dirección (lo decide la base). */}
          {!finAtencion && vista.tipo === 'actual' && soyAsesor && conv && !cerrada && (modo === 'human_requested' || modo === 'human_assigned') && (conv.rol === 'supervisor' || conv.asesor_soy_yo) && (
            <button type="button" className="btn ghost sm" onClick={() => void terminarAsesoria(true)} data-testid="btn-cerrar-solicitud"><span className="rc-larga">Cerrar solicitud</span><span className="rc-corta" aria-hidden>Cerrar</span></button>
          )}
          {!finAtencion && vista.tipo === 'actual' && conv?.rol === 'supervisor' && conv && modo !== 'ai_active' && !cerrada && (
            <button type="button" className="btn ghost sm" onClick={() => accion(() => cliente.liberar(convId!))}>Devolver a la cola</button>
          )}
          {onSalir && panel && <button type="button" className="rc-ico" onClick={onSalir} aria-label="Minimizar" title="Minimizar" data-testid="btn-minimizar"><ChevronDown size={18} /></button>}
          {onSalir && <button type="button" className="rc-ico" onClick={onSalir} aria-label={etiquetaSalir} title={etiquetaSalir} data-testid="btn-salir"><X size={18} /></button>}
        </div>
      </header>
      {barra && <div className="rc-barra" data-testid="chat-barra">{barra}</div>}
      {tira && !finAtencion && vista.tipo === 'actual' && <div className="rc-tira" data-testid="chat-tira">{tira}</div>}

      {finAtencion ? (
        <div className="rc-thread" data-testid="asesoria-fin">
          <div className="rc-card" role="status" data-testid={finAtencion === 'terminada' ? 'aviso-asesoria-finalizada' : 'aviso-sin-asignacion'}>
            <div className="rc-card-body">
              <div className="rc-card-title">{finAtencion === 'terminada' ? TEXTO_ASESORIA_FINALIZADA : TEXTO_SIN_ASIGNACION}</div>
              {onSalir && <button type="button" className="rc-link" onClick={onSalir} data-testid="btn-volver-asesorias">Volver a Asesorías</button>}
            </div>
          </div>
        </div>
      ) : vista.tipo === 'historial' && convId ? (
        <>
          {nuevoActual && (
            <div className="rc-hist-aviso" role="status" aria-live="polite" data-testid="aviso-nuevo-actual">
              <span>Nuevo mensaje en la conversación actual</span>
              <button type="button" className="rc-link" onClick={volverActual} data-testid="aviso-nuevo-ver">Ver</button>
            </div>
          )}
          <HistorialConversacion key={`${convId}:${vista.sesion ?? ''}`} conversationId={convId} lector={cliente} visor={visor} nombreCliente={nombreCliente}
            cache={cache.current} inicial={vista.sesion} onActual={volverActual} />
        </>
      ) : (<>
      {conCarrito && convId && conv && (
        // Dueño: su carrito activo ligado a esta conversación. Asesor/Dirección: el carrito del dueño, solo lectura (el servidor lo decide).
        <CarritoPanel conversationId={asesor ? null : convId} cartId={asesor ? conv.cart_id ?? null : null} soloLectura={asesor} cliente={clienteCarrito} />
      )}

      <div className="rc-thread" aria-live="polite">
        {cargando && <div className="rc-sys">Cargando conversación…</div>}
        {!cargando && anterior && (
          <div className="rc-anterior" data-testid="tarjeta-anterior">
            <span>{asesor ? 'Conversación anterior' : 'Tu conversación anterior'}{diaEtiqueta(anterior.closed_at ?? anterior.opened_at) ? ` · ${diaEtiqueta(anterior.closed_at ?? anterior.opened_at)}` : ''}</span>
            <button type="button" className="rc-link" onClick={() => abrirHistorial(anterior.id)} data-testid="tarjeta-anterior-ver">Ver</button>
          </div>
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
      {/* WA-2 · el cliente escribe por WhatsApp: qué le llega y qué no (solo lo ve el personal). */}
      {canal && (canal.modo === 'espejo'
        ? <div className="rc-wa-aviso" role="status" data-testid="wa-espejo">{NOMBRE_CANAL[canal.canal]} en modo espejo: aquí ves sus mensajes, pero todavía se contestan en Leadsales; desde aquí no se puede escribir.</div>
        : !canal.ventana_abierta
          ? <div className="rc-wa-aviso rc-wa-aviso--cerrada" role="status" data-testid="wa-ventana">Escribió por {NOMBRE_CANAL[canal.canal]} hace más de 24 horas: lo que escribas queda aquí pero no le llega por {NOMBRE_CANAL[canal.canal]} hasta que vuelva a escribir (regla de Meta).</div>
          : null)}

      {hoja && !finAtencion && <div className="rc-hoja" data-testid="chat-hoja">{hoja}</div>}
      {accAbierto && conAcciones && (
        <div className="rc-acc-menu" role="menu" aria-label="Acciones con este cliente" data-testid="menu-acciones"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAccAbierto(false) } }}>
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
      <form className="rc-composer" onSubmit={(e) => { e.preventDefault(); void enviar() }}>
        <input ref={archivo} type="file" accept="image/jpeg,image/png,image/*" hidden onChange={(e) => void mandarImagen(e.target.files?.[0])} data-testid="input-imagen" />
        {conAcciones && (
          <button type="button" className={`rc-ico rc-adjuntar rc-mas${accAbierto ? ' rc-ico--on' : ''}`} onClick={() => { setRrBoton(false); setAccAbierto((v) => !v) }}
            aria-label="Acciones con este cliente" aria-expanded={accAbierto} aria-haspopup="menu" title="Verificar, mandar acceso, cotizar, registrar pago…" data-testid="btn-acciones"><Plus size={21} /></button>
        )}
        {conRespuestas && (
          <button type="button" className={`rc-ico rc-adjuntar${rrBoton ? ' rc-ico--on' : ''}`} onClick={() => { setAccAbierto(false); setRrBoton((v) => !v) }} disabled={!puedoEscribir}
            aria-label="Respuestas rápidas" aria-expanded={rrAbierto} title="Respuestas rápidas (o escribe /)" data-testid="btn-respuestas"><Zap size={19} /></button>
        )}
        <button type="button" className="rc-ico rc-adjuntar" onClick={() => archivo.current?.click()} disabled={!puedoEscribir || subiendo} aria-label={subiendo ? 'Subiendo imagen' : 'Mandar una foto'} title="Mandar una foto" data-testid="btn-imagen"><Camera size={20} /></button>
        <textarea
          ref={area} className="rc-input" aria-label="Escribe tu mensaje" value={texto} rows={1} maxLength={4000}
          onChange={(e) => { setTexto(e.target.value); autoAlto(e.target); avisarEscribiendo(e.target.value) }} onKeyDown={alTeclear}
          disabled={!puedoEscribir || enviando || !!pendiente?.error}
          placeholder={cerrada ? 'La conversación está cerrada' : bloqueoEscritura ? bloqueoEscritura : soyAsesor && modo !== 'human_active' && conv?.rol !== 'supervisor' ? 'Inicia la asesoría para escribir' : 'Escribe tu mensaje…'}
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
      </>)}
    </div>
  )
}
