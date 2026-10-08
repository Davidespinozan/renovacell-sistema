// UX-1 → UX V2-A → CHAT V2-D2 · "Habla con Renovacell": el doctor tiene UNA conversación con Renovacell (asistente
// IA y asesor humano en el MISMO hilo, CC-2/CC-4/CC-7). Este lanzador flotante vive en el shell del portal del
// doctor y abre la MISMA `ChatCanonico` (no la bifurca) en un cajón lateral (escritorio) o una hoja a pantalla
// completa (móvil). Reglas:
//  · Solo rol doctor. Nunca para staff/Dirección.
//  · Nunca dos ChatCanonico a la vez: en `chat_cc` (o su alias `asist`) el lanzador no existe.
//  · CHAT V2-D2 · El chat se abre SOLO por decisión del doctor (burbuja, vista previa o pantalla de chat). Ningún
//    episodio comercial ni mensaje entrante lo abre: se NOTIFICA (un pulso breve, badge con el cursor del
//    servidor y una vista previa compacta de ~6 s con remitente y fragmento). Nunca roba el foco ni el teclado.
//  · Sin leer = cursor del servidor (`leido_hasta`); solo abrir el chat lo avanza. Cuenta asesor, Dirección, IA
//    (incluido el saludo de D1) y el aviso del sistema con atención humana ACTIVA ("se unió").
//  · Episodio comercial (CI-1/CI-2): la confirmación del servidor marca el episodio y despierta la lectura
//    canónica → el saludo persistido por D1 llega como vista previa. Nada se infiere en el cliente.
//  · Frontera por conversación (C4, data/ops/autoapertura): lo no leído antiguo no se anuncia; lo nuevo se anuncia
//    una vez; un cierre manual absorbe lo existente; con un modal/hoja, la pestaña oculta o un campo enfocado la
//    vista previa se difiere y aparece en cuanto el obstáculo desaparece (vigilancia temporal, solo con pendiente).
//  · CI-3 · Realtime solo DESPIERTA la lectura canónica; sondeo de 30 s de respaldo; una sola lectura en vuelo.
//  · V2-D3 · Varias pestañas: al leer en una, las demás releen (ping BroadcastChannel; la autoridad sigue siendo el
//    cursor del servidor) y retiran badge y vista previa ya leídos. Latencia medida en memoria (chatMetricas).
//  · Aquí no hay disparadores de handoff ni mutaciones: solo abrir/leer de la conversación propia.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { useRole } from '../auth/RoleContext'
import { hasSupabase } from '../lib/supabase'
import { chat as clientePorDefecto, type ClienteChat, type Conversacion, type Mensaje, type ModoConversacion } from '../data/ops/chat'
import { chatUi, marcarAbiertoPara, useSolicitudApertura } from '../data/store/chatUiStore'
import { ChatCanonico } from '../screens/chat/ChatCanonico'
import { debeDiferir, decidir, esElegible, guardarFrontera, leerFrontera } from '../data/ops/autoapertura'
import { suscribirMensajes, type Suscriptor } from '../data/ops/chatRealtime'
import { primerNombre } from '../lib/nombres'
import { registrarAviso, type ViaLectura } from '../data/ops/chatMetricas'

// Pantallas donde la conversación YA está montada a página completa.
export const PANTALLAS_CHAT: ReadonlySet<string> = new Set(['chat_cc', 'asist'])
export const ETIQUETA_LANZADOR = 'Habla con Renovacell'
const MODOS_CON_ASESOR: ReadonlySet<ModoConversacion> = new Set(['human_assigned', 'human_active'])
export const DURACION_VISTA_MS = 6000
export const TEXTO_GENERICO = 'Tienes un mensaje nuevo.'

/** Mensajes que cuentan como actividad (badge): asesor, Dirección e IA; del sistema, solo con la atención humana activa. */
export function cuentaComoActividad(m: Conversacion['mensajes'][number], modo: ModoConversacion): boolean {
  if (m.propio) return false
  if (m.actor === 'seller' || m.actor === 'admin' || m.actor === 'ai') return true
  if (m.actor === 'system') return modo === 'human_active'
  return false
}

/** Fragmento apto para mostrarse FUERA del chat: plano, ~90 caracteres; enlaces, correos o números largos → genérico. */
export function fragmentoSeguro(contenido: string, max = 90): string | null {
  const plano = contenido.replace(/\s+/g, ' ').trim()
  if (!plano) return null
  if (/https?:\/\/|www\.|\S@\S|\d[\d .-]{6,}\d/i.test(plano)) return null
  const c = [...plano]                       // por puntos de código (emojis/acentos completos)
  return c.length > max ? `${c.slice(0, max - 1).join('').trimEnd()}…` : plano
}

/** Quién escribe, en lenguaje del doctor. */
export function remitenteDe(m: Pick<Mensaje, 'actor'>, asesorNombre: string | null | undefined): string {
  if (m.actor === 'seller') return primerNombre(asesorNombre) ?? 'Tu asesora'
  if (m.actor === 'ai') return 'Asistente Renovacell'
  return 'Renovacell'
}

export interface AvisoVista { seq: number; remitente: string; texto: string; extra: number }

// Solo vista previa local / pruebas: cliente inyectable para el lanzador montado por el shell.
let clienteShell: ClienteChat = clientePorDefecto
export function _configurarClienteLanzador(c: ClienteChat) { clienteShell = c }
let suscriptorShell: Suscriptor = suscribirMensajes
export function _configurarSuscriptorLanzador(s: Suscriptor) { suscriptorShell = s }

export function ChatFlotante({ cliente = clienteShell, intervaloMs = 30000, suscribir = suscriptorShell }: { cliente?: ClienteChat; intervaloMs?: number; suscribir?: Suscriptor }) {
  const { role, screen } = useRole()
  const [abierto, setAbierto] = useState(false)
  const abiertoRef = useRef(false)
  abiertoRef.current = abierto
  const frontera = useRef<{ conv: string; f: number | null } | null>(null)   // C4 · F de la conversación actual
  const descartar = useRef(false)          // C4 · tras un cierre manual: la siguiente lectura absorbe lo existente
  const vigilante = useRef<(() => void) | null>(null)     // vigilancia temporal del obstáculo (solo con un pendiente)
  const diferido = useRef(false)            // actividad nueva cuya vista previa espera a que se quite el obstáculo
  const leyendo = useRef(false)             // CI-3 · una sola lectura canónica en vuelo
  const otraVez = useRef(false)             // CI-3 · llegó una señal durante la lectura → leer otra vez al terminar
  const coalescer = useRef<number | undefined>(undefined)
  const revisarRef = useRef<(via: ViaLectura) => Promise<void>>(async () => {})
  const viaSiguiente = useRef<ViaLectura>('realtime')    // V2-D3 · causa de la relectura pendiente
  const ultimaSenal = useRef<number | null>(null)        // V2-D3 · Date.now() de la última señal Realtime
  const canalPestanas = useRef<BroadcastChannel | null>(null)
  const temporizador = useRef<number | undefined>(undefined)
  const [convId, setConvId] = useState<string | null>(null)
  const [sinLeer, setSinLeer] = useState(0)
  const [pulso, setPulso] = useState(false)
  const [vista, setVista] = useState<AvisoVista | null>(null)   // V2-D2 · vista previa (no es autoridad de lectura)
  const [conAsesor, setConAsesor] = useState(false)
  const cursor = useRef(0)                 // último `leido_hasta` conocido (servidor)
  const modoVisto = useRef<ModoConversacion | null>(null)
  const fab = useRef<HTMLButtonElement | null>(null)
  const visible = role === 'doctor' && !PANTALLAS_CHAT.has(screen)
  const conBackend = hasSupabase || cliente !== clientePorDefecto
  const solicitud = useSolicitudApertura()

  const dejarDeVigilar = useCallback(() => { vigilante.current?.(); vigilante.current = null }, [])
  const ocultarVista = useCallback(() => { window.clearTimeout(temporizador.current); setVista(null) }, [])

  // Si el doctor navega a la pantalla de chat, el cajón se cierra: un solo montaje del hilo (ahí todo ya se ve).
  useEffect(() => { if (!visible) { setAbierto(false); diferido.current = false; dejarDeVigilar(); ocultarVista() } }, [visible, dejarDeVigilar, ocultarVista])

  // Abrir/reanudar la conversación propia (idempotente en el servidor) una sola vez.
  useEffect(() => {
    if (!visible || !conBackend || convId) return
    let vivo = true
    void cliente.abrir().then((r) => { if (vivo && r.ok) setConvId(r.data.conversation_id) })
    return () => { vivo = false }
  }, [visible, conBackend, convId, cliente])

  const pulsar = useCallback(() => { setPulso(true); window.setTimeout(() => setPulso(false), 1300) }, [])

  // V2-D2 · NOTIFICAR (nunca abrir): un pulso y la vista previa ~6 s. Con el cajón abierto no hay vista previa.
  const notificar = useCallback((aviso: AvisoVista) => {
    if (abiertoRef.current) return
    window.clearTimeout(temporizador.current)
    setVista(aviso); pulsar()
    temporizador.current = window.setTimeout(() => setVista(null), DURACION_VISTA_MS)
  }, [pulsar])
  useEffect(() => () => window.clearTimeout(temporizador.current), [])

  // Vista previa diferida: se reevalúa EN CUANTO deja de haber obstáculo (cierre del modal, foco fuera del campo,
  // pestaña visible), sin esperar al sondeo. La vigilancia existe solo mientras hay un pendiente.
  const vigilarDiferido = useCallback(() => {
    if (vigilante.current || typeof document === 'undefined') return
    let marco = 0
    const revisar = () => {
      marco = 0
      if (!diferido.current) { dejarDeVigilar(); return }
      if (debeDiferir()) return
      diferido.current = false; dejarDeVigilar()
      if (!abiertoRef.current) void revisarRef.current('diferido')
    }
    const programar = () => { if (!marco) marco = window.requestAnimationFrame(revisar) }
    const obs = typeof MutationObserver !== 'undefined' ? new MutationObserver(programar) : null
    obs?.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('focusout', programar)
    document.addEventListener('visibilitychange', programar)
    vigilante.current = () => {
      obs?.disconnect(); if (marco) window.cancelAnimationFrame(marco)
      document.removeEventListener('focusout', programar); document.removeEventListener('visibilitychange', programar)
    }
  }, [dejarDeVigilar])
  useEffect(() => () => dejarDeVigilar(), [dejarDeVigilar])

  // Cuenta la actividad con la autoridad del servidor y decide si hay algo NUEVO que anunciar.
  const contar = useCallback(async (via: ViaLectura) => {
    if (!convId) return
    const senalMs = via === 'realtime' || via === 'reconexion' ? ultimaSenal.current : null
    const lecturaInicioMs = Date.now()
    const r = await cliente.leer(convId, cursor.current)
    if (!r.ok) return
    const lecturaFinMs = Date.now()
    // C4 · frontera por conversación (sessionStorage) → ¿actividad genuinamente nueva? (se anuncia, no se abre)
    if (frontera.current?.conv !== convId) frontera.current = { conv: convId, f: leerFrontera(convId) }
    const fAntes = frontera.current.f
    const d = decidir({ lectura: r.data, frontera: fAntes, descartar: descartar.current, diferir: debeDiferir() })
    descartar.current = false
    if (d.frontera !== frontera.current.f) { frontera.current.f = d.frontera; guardarFrontera(convId, d.frontera) }
    if (d.abrir) {
      const piso = Math.max(fAntes ?? 0, r.data.leido_hasta ?? 0)
      const nuevos = r.data.mensajes.filter((m) => m.seq > piso && esElegible(m, r.data))
      const ultimo = nuevos.find((m) => m.seq === d.frontera) ?? nuevos[nuevos.length - 1]
      if (ultimo) {
        notificar({ seq: ultimo.seq, remitente: remitenteDe(ultimo, r.data.asesor_nombre), texto: fragmentoSeguro(ultimo.content) ?? TEXTO_GENERICO, extra: Math.max(0, nuevos.length - 1) })
        registrarAviso({ seq: ultimo.seq, via, creadoServidor: ultimo.created_at, senalMs, lecturaInicioMs, lecturaFinMs, avisoMs: Date.now() })
      }
    } else if (d.motivo === 'diferir' && document.visibilityState === 'visible') { diferido.current = true; vigilarDiferido() }
    const leido = Math.max(cursor.current, r.data.leido_hasta ?? 0)
    cursor.current = leido
    setVista((v) => (v && v.seq <= leido ? null : v))   // V2-D3 · ya leído (p. ej. en otra pestaña): la vista previa se retira
    setSinLeer(r.data.mensajes.filter((m) => m.seq > leido && cuentaComoActividad(m, r.data.modo)).length)
    // Un pulso discreto cuando la atención queda asignada/activa sin mensaje propio (transición vista por primera vez).
    const antes = modoVisto.current
    if (!d.abrir && antes !== null && antes !== r.data.modo && MODOS_CON_ASESOR.has(r.data.modo)) pulsar()
    modoVisto.current = r.data.modo
    setConAsesor(MODOS_CON_ASESOR.has(r.data.modo))
  }, [cliente, convId, pulsar, notificar, vigilarDiferido])

  // CI-3 · UNA lectura canónica en vuelo: sondeo, visibilidad, Realtime y episodios pasan por aquí; si llega otra
  // señal mientras se lee, se vuelve a leer al terminar (ninguna actividad se pierde ni se lee en paralelo).
  const revisarAhora = useCallback(async (via: ViaLectura) => {
    if (leyendo.current) { otraVez.current = true; viaSiguiente.current = via; return }
    leyendo.current = true
    let causa = via
    try {
      do { otraVez.current = false; await contar(causa); causa = viaSiguiente.current } while (otraVez.current && !abiertoRef.current)
    } finally { leyendo.current = false }
  }, [contar])
  revisarRef.current = revisarAhora

  // CI-3 · Realtime: despertador de la lectura canónica (ráfagas se agrupan ~120 ms). Solo con el cajón cerrado y
  // la pestaña visible; al (re)conectarse se lee una vez por si algo llegó mientras el canal estaba caído.
  useEffect(() => {
    if (!visible || !convId) return
    const despertar = (via: ViaLectura) => {
      if (abiertoRef.current || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return
      if (ultimaSenal.current === null || !coalescer.current) ultimaSenal.current = Date.now()
      window.clearTimeout(coalescer.current)
      coalescer.current = window.setTimeout(() => { coalescer.current = undefined; void revisarRef.current(via) }, 120)
    }
    const retirar = suscribir(convId, () => despertar('realtime'), (e) => { if (e === 'listo') despertar('reconexion') })
    return () => { retirar(); window.clearTimeout(coalescer.current) }
  }, [visible, convId, suscribir])

  // Solo con el cajón CERRADO y la pestaña visible (abierto, ChatCanonico ya lee y marca).
  useEffect(() => {
    if (!visible || !convId || abierto) return
    const tick = (via: ViaLectura) => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void revisarAhora(via) }
    tick('cierre')
    const t = setInterval(() => tick('sondeo'), intervaloMs)
    const alVolver = () => tick('visibilidad')
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [visible, convId, abierto, revisarAhora, intervaloMs])

  // CI-2 / V2-D2 · Episodio comercial confirmado por el servidor: se marca (una vez por episodio) y se despierta la
  // lectura canónica para anunciar el saludo de D1. NO abre el chat.
  useEffect(() => {
    if (!solicitud) return
    chatUi.consumir(solicitud.id)
    if (!visible) return                                   // en la pantalla de chat ya se ve todo
    marcarAbiertoPara(solicitud.episodio)
    if (!abiertoRef.current) void revisarRef.current('episodio')
  }, [solicitud, visible])

  // V2-D3 · Varias pestañas: un aviso "leí hasta N" hace que las demás relean al servidor (sin segunda fuente de verdad).
  useEffect(() => {
    if (!visible || !convId || typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel(`rc-chat-${convId}`)
    bc.onmessage = (e: MessageEvent<{ tipo?: string }>) => { if (e.data?.tipo === 'leido' && !abiertoRef.current) void revisarRef.current('pestana') }
    canalPestanas.current = bc
    return () => { bc.close(); canalPestanas.current = null }
  }, [visible, convId])

  // Cajón abierto: bloquea el scroll del fondo, sigue al teclado (visualViewport) y Escape cierra.
  useEffect(() => {
    if (!abierto) return
    document.body.classList.add('chat-open')
    const vv = window.visualViewport
    const ajustar = () => {
      if (!vv) return
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      document.documentElement.style.setProperty('--rc-kb', `${kb}px`)
    }
    ajustar(); vv?.addEventListener('resize', ajustar); vv?.addEventListener('scroll', ajustar)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarManual() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('chat-open'); document.documentElement.style.removeProperty('--rc-kb')
      vv?.removeEventListener('resize', ajustar); vv?.removeEventListener('scroll', ajustar)
      document.removeEventListener('keydown', onKey)
    }
  }, [abierto])   // eslint-disable-line react-hooks/exhaustive-deps

  // Apertura MANUAL (burbuja o vista previa): la única forma de abrir el chat.
  const abrirManual = useCallback(() => {
    diferido.current = false; dejarDeVigilar(); ocultarVista()
    abiertoRef.current = true
    setSinLeer(0); setAbierto(true)
  }, [dejarDeVigilar, ocultarVista])
  // C4 · cierre MANUAL explícito (X, flecha, botón flotante, fondo, Escape): absorbe lo existente (no se re-anuncia).
  const cerrarManual = useCallback(() => {
    descartar.current = true
    abiertoRef.current = false
    setAbierto(false); window.setTimeout(() => fab.current?.focus(), 0)
  }, [])
  const onLeido = useCallback((seq: number) => {
    cursor.current = Math.max(cursor.current, seq); setSinLeer(0)
    try { canalPestanas.current?.postMessage({ tipo: 'leido', seq }) } catch { /* canal cerrado */ }   // V2-D3 · avisa a las otras pestañas
  }, [])

  if (!visible) return null
  const etiqueta = sinLeer > 0 ? `${ETIQUETA_LANZADOR}, ${sinLeer} ${sinLeer === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : ETIQUETA_LANZADOR
  return (
    <>
      {/* V2-D2 · zona viva SIEMPRE montada (los lectores de pantalla anuncian lo que entra); sin overlay ni foco. */}
      <div className="chat-vista-zona" aria-live="polite" data-testid="chat-vista-zona">
        {vista && !abierto && (
          <div className="chat-vista" data-testid="chat-vista">
            <button type="button" className="chat-vista-cuerpo" onClick={abrirManual} data-testid="chat-vista-abrir" aria-label={`Abrir la conversación. ${vista.remitente}: ${vista.texto}`}>
              <span className="chat-vista-de">{vista.remitente}{vista.extra > 0 ? <span className="chat-vista-mas"> · +{vista.extra}</span> : null}</span>
              <span className="chat-vista-texto">{vista.texto}</span>
            </button>
            <button type="button" className="chat-vista-cerrar" onClick={ocultarVista} aria-label="Descartar aviso" data-testid="chat-vista-cerrar">✕</button>
          </div>
        )}
      </div>
      <button ref={fab} type="button" className={`chat-fab${pulso ? ' chat-fab--pulso' : ''}`} aria-label={etiqueta} title={ETIQUETA_LANZADOR} aria-expanded={abierto}
        onClick={() => { if (abierto) cerrarManual(); else abrirManual() }} data-testid="chat-fab">
        <Icon name="chat" />
        {conAsesor && sinLeer === 0 && <span className="chat-fab-asesor" aria-hidden data-testid="chat-fab-asesor" />}
        {sinLeer > 0 && <span className="chat-fab-badge" data-testid="chat-fab-badge">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>
      {abierto && (
        <div className="chat-drawer-wrap" onClick={cerrarManual} data-testid="chat-drawer">
          <aside className="chat-drawer" role="dialog" aria-modal="true" aria-label={ETIQUETA_LANZADOR} onClick={(e) => e.stopPropagation()}>
            {/* C4 · conversación conocida → solo `leer` (sin un `abrir` adicional que pueda recuperar un handoff) */}
            <ChatCanonico embebido panel autoFoco conversationId={convId ?? undefined} cliente={cliente} onSalir={cerrarManual} etiquetaSalir="Cerrar" onLeido={onLeido} />
          </aside>
        </div>
      )}
    </>
  )
}
