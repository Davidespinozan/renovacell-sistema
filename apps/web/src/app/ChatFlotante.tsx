// UX-1 → UX V2-A · "Habla con Renovacell": el doctor tiene UNA conversación con Renovacell (asistente IA y
// asesor humano en el MISMO hilo, CC-2/CC-4/CC-7). Este lanzador flotante vive en el shell del portal del
// doctor y abre la MISMA `ChatCanonico` (no la bifurca) en un cajón lateral (escritorio) o una hoja a
// pantalla completa (móvil). Reglas:
//  · Solo rol doctor. Nunca para staff/Dirección.
//  · Nunca dos ChatCanonico a la vez: en `chat_cc` (o su alias `asist`) el lanzador no existe.
//  · Se abre solo cuando el SERVIDOR confirmó un handoff nuevo (respuesta de la mutación del carrito, vía
//    chatUiStore), una vez por carrito; nunca por cantidades, polling, re-render ni reintentos.
//  · Sin leer = cursor del servidor (`leido_hasta`). Cuenta mensajes relevantes (asesor, Dirección, IA) y el
//    aviso del sistema SOLO mientras hay un handoff vivo; el resto de avisos internos no hacen ruido.
//  · Actividad significativa (mensaje del asesor, asesor asignado/activo) = badge + UN pulso discreto. Sin
//    auto-abrir y sin notificaciones del navegador.
//  · Aquí no hay disparadores de handoff ni mutaciones: solo abrir/leer de la conversación propia.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { useRole } from '../auth/RoleContext'
import { hasSupabase } from '../lib/supabase'
import { chat as clientePorDefecto, type ClienteChat, type Conversacion, type ModoConversacion } from '../data/ops/chat'
import { chatUi, marcarAbiertoPara, useSolicitudApertura } from '../data/store/chatUiStore'
import { ChatCanonico } from '../screens/chat/ChatCanonico'

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

export function ChatFlotante({ cliente = clientePorDefecto, intervaloMs = 30000 }: { cliente?: ClienteChat; intervaloMs?: number }) {
  const { role, screen } = useRole()
  const [abierto, setAbierto] = useState(false)
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

  // Si el doctor navega a la pantalla de chat, el cajón se cierra: un solo montaje del hilo.
  useEffect(() => { if (!visible) setAbierto(false) }, [visible])

  // Abrir/reanudar la conversación propia (idempotente en el servidor) una sola vez.
  useEffect(() => {
    if (!visible || !conBackend || convId) return
    let vivo = true
    void cliente.abrir().then((r) => { if (vivo && r.ok) setConvId(r.data.conversation_id) })
    return () => { vivo = false }
  }, [visible, conBackend, convId, cliente])

  const pulsar = useCallback(() => { setPulso(true); window.setTimeout(() => setPulso(false), 2600) }, [])

  // Cuenta la actividad con la autoridad del servidor: mensajes relevantes posteriores a `leido_hasta`.
  const contar = useCallback(async () => {
    if (!convId) return
    const r = await cliente.leer(convId, cursor.current)
    if (!r.ok) return
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
  }, [cliente, convId, pulsar])

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
    if (!abierto) { marcarAbiertoPara(solicitud.cartId); setSinLeer(0); setAbierto(true) }
    chatUi.consumir(solicitud.id)
  }, [solicitud, visible, abierto])

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('chat-open'); document.documentElement.style.removeProperty('--rc-kb')
      vv?.removeEventListener('resize', ajustar); vv?.removeEventListener('scroll', ajustar)
      document.removeEventListener('keydown', onKey)
    }
  }, [abierto])

  const cerrar = useCallback(() => { setAbierto(false); window.setTimeout(() => fab.current?.focus(), 0) }, [])
  const onLeido = useCallback((seq: number) => { cursor.current = Math.max(cursor.current, seq); setSinLeer(0) }, [])

  if (!visible) return null
  const etiqueta = sinLeer > 0 ? `${ETIQUETA_LANZADOR}, ${sinLeer} ${sinLeer === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : ETIQUETA_LANZADOR
  return (
    <>
      <button ref={fab} type="button" className={`chat-fab${pulso ? ' chat-fab--pulso' : ''}`} aria-label={etiqueta} title={ETIQUETA_LANZADOR} aria-expanded={abierto}
        onClick={() => { if (abierto) cerrar(); else { setSinLeer(0); setAbierto(true) } }} data-testid="chat-fab">
        <Icon name="chat" />
        {conAsesor && sinLeer === 0 && <span className="chat-fab-asesor" aria-hidden data-testid="chat-fab-asesor" />}
        {sinLeer > 0 && <span className="chat-fab-badge" data-testid="chat-fab-badge">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>
      {abierto && (
        <div className="chat-drawer-wrap" onClick={cerrar} data-testid="chat-drawer">
          <aside className="chat-drawer" role="dialog" aria-modal="true" aria-label={ETIQUETA_LANZADOR} onClick={(e) => e.stopPropagation()}>
            <ChatCanonico embebido panel autoFoco cliente={cliente} onSalir={cerrar} etiquetaSalir="Cerrar" onLeido={onLeido} />
          </aside>
        </div>
      )}
    </>
  )
}
