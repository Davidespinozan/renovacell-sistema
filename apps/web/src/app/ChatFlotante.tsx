// UX-1 → UX V2-A · "Habla con Renovacell": el doctor tiene UNA conversación con Renovacell (asistente IA y
// asesor humano en el MISMO hilo, CC-2/CC-4/CC-7). Este lanzador flotante vive en el shell del portal del
// doctor y abre la MISMA `ChatCanonico` (no la bifurca) en un cajón lateral (escritorio) o una hoja a
// pantalla completa (móvil). Reglas:
//  · Solo rol doctor. Nunca para staff/Dirección.
//  · Nunca dos ChatCanonico a la vez: en `chat_cc` (o su alias `asist`) el lanzador no existe.
//  · Se abre solo cuando el SERVIDOR confirmó un handoff nuevo (respuesta de la mutación del carrito, vía
//    chatUiStore), una vez por EPISODIO comercial (CI-2); nunca por cantidades, polling, re-render ni reintentos.
//  · Sin leer = cursor del servidor (`leido_hasta`). Cuenta mensajes relevantes (asesor, Dirección, IA) y el
//    aviso del sistema SOLO mientras hay un handoff vivo; el resto de avisos internos no hacen ruido.
//  · Actividad significativa (mensaje del asesor, asesor asignado/activo) = badge + UN pulso discreto.
//  · Chat V2-C4 · ESTE componente es la ÚNICA autoridad de apertura automática (handoff del carrito y
//    actividad nueva vista por el sondeo de la burbuja). Frontera por conversación (data/ops/autoapertura):
//    lo no leído antiguo no abre; lo nuevo abre una vez; un cierre manual suprime lo existente; se difiere
//    con un modal/hoja, la pestaña oculta o un campo enfocado. Sin notificaciones del navegador.
//  · Aquí no hay disparadores de handoff ni mutaciones: solo abrir/leer de la conversación propia.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { useRole } from '../auth/RoleContext'
import { hasSupabase } from '../lib/supabase'
import { chat as clientePorDefecto, type ClienteChat, type Conversacion, type ModoConversacion } from '../data/ops/chat'
import { chatUi, marcarAbiertoPara, useSolicitudApertura } from '../data/store/chatUiStore'
import { ChatCanonico } from '../screens/chat/ChatCanonico'
import { debeDiferir, decidir, guardarFrontera, leerFrontera } from '../data/ops/autoapertura'

// Pantallas donde la conversación YA está montada a página completa.
export const PANTALLAS_CHAT: ReadonlySet<string> = new Set(['chat_cc', 'asist'])
export const ETIQUETA_LANZADOR = 'Habla con Renovacell'
const MODOS_CON_ASESOR: ReadonlySet<ModoConversacion> = new Set(['human_assigned', 'human_active'])

/** Mensajes que cuentan como actividad para el doctor (categorías explícitas, no "todo lo que no es propio"). */
export function cuentaComoActividad(m: Conversacion['mensajes'][number], handoffVivo: boolean): boolean {
  if (m.propio) return false
  if (m.actor === 'seller' || m.actor === 'admin' || m.actor === 'ai') return true
  if (m.actor === 'system') return handoffVivo
  return false
}
export const handoffVivoDe = (c: Pick<Conversacion, 'modo' | 'handoff'>): boolean => !!c.handoff?.origen && (c.modo === 'human_requested' || c.modo === 'human_assigned')

// Solo vista previa local / pruebas: cliente inyectable para el lanzador montado por el shell.
let clienteShell: ClienteChat = clientePorDefecto
export function _configurarClienteLanzador(c: ClienteChat) { clienteShell = c }

export function ChatFlotante({ cliente = clienteShell, intervaloMs = 30000 }: { cliente?: ClienteChat; intervaloMs?: number }) {
  const { role, screen } = useRole()
  const [abierto, setAbierto] = useState(false)
  const [apertura, setApertura] = useState<'manual' | 'auto'>('manual')   // C4 · la automática no enfoca el redactor
  const abiertoRef = useRef(false)
  abiertoRef.current = abierto
  const frontera = useRef<{ conv: string; f: number | null } | null>(null)   // C4 · F de la conversación actual
  const descartar = useRef(false)          // C4 · tras un cierre manual: la siguiente lectura absorbe lo existente
  const handoffPendiente = useRef<string | null>(null)   // C4/CI-2 · V2-A diferida por interacción crítica (episodio)
  const vigilante = useRef<(() => void) | null>(null)     // CI-2 · vigilancia temporal del obstáculo (solo con un pendiente)
  const dialogo = useRef<HTMLElement | null>(null)
  const [convId, setConvId] = useState<string | null>(null)
  const [sinLeer, setSinLeer] = useState(0)
  const [pulso, setPulso] = useState(false)
  const [conAsesor, setConAsesor] = useState(false)
  const cursor = useRef(0)                 // último `leido_hasta` conocido (servidor)
  const modoVisto = useRef<ModoConversacion | null>(null)
  const asesorVisto = useRef(0)            // mensajes de asesor contados en la última lectura
  const fab = useRef<HTMLButtonElement | null>(null)
  const visible = role === 'doctor' && !PANTALLAS_CHAT.has(screen)
  const conBackend = hasSupabase || cliente !== clientePorDefecto
  const solicitud = useSolicitudApertura()

  // Si el doctor navega a la pantalla de chat, el cajón se cierra: un solo montaje del hilo (ahí el episodio ya se ve).
  useEffect(() => { if (!visible) { setAbierto(false); handoffPendiente.current = null; vigilante.current?.(); vigilante.current = null } }, [visible])

  // Abrir/reanudar la conversación propia (idempotente en el servidor) una sola vez.
  useEffect(() => {
    if (!visible || !conBackend || convId) return
    let vivo = true
    void cliente.abrir().then((r) => { if (vivo && r.ok) setConvId(r.data.conversation_id) })
    return () => { vivo = false }
  }, [visible, conBackend, convId, cliente])

  const pulsar = useCallback(() => { setPulso(true); window.setTimeout(() => setPulso(false), 2600) }, [])

  // C4 · ÚNICA autoridad de apertura automática. Nunca reabre lo que ya está abierto.
  const abrirAuto = useCallback((): boolean => {
    if (abiertoRef.current || !visible) return false
    abiertoRef.current = true
    setApertura('auto'); setSinLeer(0); setAbierto(true)
    return true
  }, [visible])
  // CI-2 · Un episodio diferido se abre EN CUANTO deja de haber obstáculo (cierre del modal, foco fuera del
  // campo, pestaña visible), sin esperar al sondeo. La vigilancia existe solo mientras hay un pendiente.
  const dejarDeVigilar = useCallback(() => { vigilante.current?.(); vigilante.current = null }, [])
  const atenderRef = useRef<(episodio: string) => void>(() => {})
  const vigilarDiferido = useCallback(() => {
    if (vigilante.current || typeof document === 'undefined') return
    let marco = 0
    const revisar = () => {
      marco = 0
      const p = handoffPendiente.current
      if (!p) { dejarDeVigilar(); return }
      if (!debeDiferir()) atenderRef.current(p)
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
  // V2-A por la misma autoridad: si hay interacción crítica, se difiere y se abre al quitarse el obstáculo.
  const atenderHandoff = useCallback((episodio: string) => {
    if (abiertoRef.current) { handoffPendiente.current = null; dejarDeVigilar(); return }
    if (debeDiferir()) { handoffPendiente.current = episodio; vigilarDiferido(); return }
    handoffPendiente.current = null; dejarDeVigilar()
    if (abrirAuto()) marcarAbiertoPara(episodio)
  }, [abrirAuto, dejarDeVigilar, vigilarDiferido])
  atenderRef.current = atenderHandoff
  useEffect(() => () => dejarDeVigilar(), [dejarDeVigilar])

  // Cuenta la actividad con la autoridad del servidor: mensajes relevantes posteriores a `leido_hasta`.
  const contar = useCallback(async () => {
    if (!convId) return
    if (handoffPendiente.current) atenderHandoff(handoffPendiente.current)
    const r = await cliente.leer(convId, cursor.current)
    if (!r.ok) return
    // C4 · frontera por conversación (sessionStorage) → ¿actividad genuinamente nueva?
    if (frontera.current?.conv !== convId) frontera.current = { conv: convId, f: leerFrontera(convId) }
    const d = decidir({ lectura: r.data, frontera: frontera.current.f, descartar: descartar.current, diferir: debeDiferir() })
    descartar.current = false
    if (d.frontera !== frontera.current.f) { frontera.current.f = d.frontera; guardarFrontera(convId, d.frontera) }
    if (d.abrir) abrirAuto()
    const leido = Math.max(cursor.current, r.data.leido_hasta ?? 0)
    cursor.current = leido
    const vivo = handoffVivoDe(r.data)
    const nuevos = r.data.mensajes.filter((m) => m.seq > leido && cuentaComoActividad(m, vivo))
    const deAsesor = nuevos.filter((m) => m.actor === 'seller').length
    setSinLeer(nuevos.length)
    // Un pulso discreto cuando el asesor escribe o cuando queda asignado/activo (transición vista por primera vez).
    const antes = modoVisto.current
    if (deAsesor > asesorVisto.current || (antes !== null && antes !== r.data.modo && MODOS_CON_ASESOR.has(r.data.modo))) pulsar()
    asesorVisto.current = deAsesor
    modoVisto.current = r.data.modo
    setConAsesor(MODOS_CON_ASESOR.has(r.data.modo))
  }, [cliente, convId, pulsar, abrirAuto, atenderHandoff])

  // Solo con el cajón CERRADO y la pestaña visible (abierto, ChatCanonico ya lee y marca).
  useEffect(() => {
    if (!visible || !convId || abierto) return
    const tick = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void contar() }
    tick()
    const t = setInterval(tick, intervaloMs)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [visible, convId, abierto, contar, intervaloMs])

  // UX V2-A · Apertura automática pedida por la mutación del carrito (handoff confirmado por el servidor).
  useEffect(() => {
    if (!solicitud) return
    if (!visible) { chatUi.consumir(solicitud.id); return }   // en la pantalla de chat ya se ve: no hay cajón
    atenderHandoff(solicitud.episodio)
    chatUi.consumir(solicitud.id)
  }, [solicitud, visible, atenderHandoff])

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

  // C4 · apertura automática: el foco va al diálogo (lectores de pantalla), NUNCA al redactor (sin teclado en móvil).
  useEffect(() => { if (abierto && apertura === 'auto') dialogo.current?.focus() }, [abierto, apertura])

  // C4 · cierre MANUAL explícito (X, flecha, botón flotante, fondo, Escape): suprime lo existente. Navegar,
  // cerrar sesión o desmontar NO pasan por aquí.
  const cerrarManual = useCallback(() => {
    descartar.current = true
    abiertoRef.current = false
    setAbierto(false); window.setTimeout(() => fab.current?.focus(), 0)
  }, [])
  const onLeido = useCallback((seq: number) => { cursor.current = Math.max(cursor.current, seq); setSinLeer(0) }, [])

  if (!visible) return null
  const etiqueta = sinLeer > 0 ? `${ETIQUETA_LANZADOR}, ${sinLeer} ${sinLeer === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : ETIQUETA_LANZADOR
  return (
    <>
      <button ref={fab} type="button" className={`chat-fab${pulso ? ' chat-fab--pulso' : ''}`} aria-label={etiqueta} title={ETIQUETA_LANZADOR} aria-expanded={abierto}
        onClick={() => { if (abierto) cerrarManual(); else { handoffPendiente.current = null; dejarDeVigilar(); setApertura('manual'); setSinLeer(0); setAbierto(true) } }} data-testid="chat-fab">
        <Icon name="chat" />
        {conAsesor && sinLeer === 0 && <span className="chat-fab-asesor" aria-hidden data-testid="chat-fab-asesor" />}
        {sinLeer > 0 && <span className="chat-fab-badge" data-testid="chat-fab-badge">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>
      {abierto && (
        <div className="chat-drawer-wrap" onClick={cerrarManual} data-testid="chat-drawer" data-apertura={apertura}>
          <aside ref={dialogo} tabIndex={-1} style={{ outline: 'none' }} className="chat-drawer" role="dialog" aria-modal="true" aria-label={ETIQUETA_LANZADOR} onClick={(e) => e.stopPropagation()}>
            {/* C4 · conversación conocida → solo `leer` (sin un `abrir` adicional que pueda recuperar un handoff) */}
            <ChatCanonico embebido panel autoFoco={apertura === 'manual'} conversationId={convId ?? undefined} cliente={cliente} onSalir={cerrarManual} etiquetaSalir="Cerrar" onLeido={onLeido} />
          </aside>
        </div>
      )}
    </>
  )
}
