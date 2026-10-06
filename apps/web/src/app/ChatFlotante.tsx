// UX-1 · "Habla con Renovacell": el doctor tiene UNA conversación con Renovacell (asistente IA y
// asesor humano en el MISMO hilo, CC-2/CC-4/CC-7). Este lanzador flotante vive en el shell del
// portal del doctor y abre la MISMA `ChatCanonico` (no la bifurca) en un cajón lateral (escritorio)
// o una hoja casi completa (móvil). Reglas:
//  · Solo rol doctor. Nunca para staff/Dirección.
//  · Nunca dos ChatCanonico a la vez: en la pantalla `chat_cc` (o su alias `asist`) el lanzador no
//    existe, y el cajón se cierra si el doctor navega ahí.
//  · Sin leer = autoridad del servidor (`leido_hasta` = cc_participants.last_read_seq); con el
//    cajón cerrado se consulta cada 30 s; con el cajón abierto, ChatCanonico marca leído y avisa.
//  · Aquí no hay disparadores de handoff ni mutaciones: solo abrir/leer de la conversación propia.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { useRole } from '../auth/RoleContext'
import { hasSupabase } from '../lib/supabase'
import { chat as clientePorDefecto, type ClienteChat } from '../data/ops/chat'
import { ChatCanonico } from '../screens/chat/ChatCanonico'

// Pantallas donde la conversación YA está montada a página completa.
export const PANTALLAS_CHAT: ReadonlySet<string> = new Set(['chat_cc', 'asist'])
export const ETIQUETA_LANZADOR = 'Habla con Renovacell'

export function ChatFlotante({ cliente = clientePorDefecto, intervaloMs = 30000 }: { cliente?: ClienteChat; intervaloMs?: number }) {
  const { role, screen } = useRole()
  const [abierto, setAbierto] = useState(false)
  const [convId, setConvId] = useState<string | null>(null)
  const [sinLeer, setSinLeer] = useState(0)
  const cursor = useRef(0)   // último `leido_hasta` conocido (servidor)
  const visible = role === 'doctor' && !PANTALLAS_CHAT.has(screen)
  const conBackend = hasSupabase || cliente !== clientePorDefecto

  // Si el doctor navega a la pantalla de chat, el cajón se cierra: un solo montaje del hilo.
  useEffect(() => { if (!visible) setAbierto(false) }, [visible])

  // Abrir/reanudar la conversación propia (idempotente en el servidor) una sola vez.
  useEffect(() => {
    if (!visible || !conBackend || convId) return
    let vivo = true
    void cliente.abrir().then((r) => { if (vivo && r.ok) setConvId(r.data.conversation_id) })
    return () => { vivo = false }
  }, [visible, conBackend, convId, cliente])

  // Cuenta lo no leído con la autoridad del servidor: mensajes posteriores a `leido_hasta` que no son propios ni del sistema.
  const contar = useCallback(async () => {
    if (!convId) return
    const r = await cliente.leer(convId, cursor.current)
    if (!r.ok) return
    const leido = Math.max(cursor.current, r.data.leido_hasta ?? 0)
    cursor.current = leido
    setSinLeer(r.data.mensajes.filter((m) => m.seq > leido && !m.propio && m.actor !== 'system').length)
  }, [cliente, convId])

  // Solo con el cajón CERRADO y la pestaña visible (abierto, ChatCanonico ya lee y marca).
  useEffect(() => {
    if (!visible || !convId || abierto) return
    const tick = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void contar() }
    tick()
    const t = setInterval(tick, intervaloMs)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [visible, convId, abierto, contar, intervaloMs])

  // Escape cierra el cajón.
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [abierto])

  const onLeido = useCallback((seq: number) => { cursor.current = Math.max(cursor.current, seq); setSinLeer(0) }, [])

  if (!visible) return null
  const etiqueta = sinLeer > 0 ? `${ETIQUETA_LANZADOR}, ${sinLeer} ${sinLeer === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : ETIQUETA_LANZADOR
  return (
    <>
      <button type="button" className="chat-fab" aria-label={etiqueta} title={ETIQUETA_LANZADOR} aria-expanded={abierto}
        onClick={() => { setAbierto((v) => !v); if (!abierto) setSinLeer(0) }} data-testid="chat-fab">
        <Icon name="chat" />
        {sinLeer > 0 && <span className="chat-fab-badge" data-testid="chat-fab-badge">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>
      {abierto && (
        <div className="chat-drawer-wrap" onClick={() => setAbierto(false)} data-testid="chat-drawer">
          <aside className="chat-drawer" role="dialog" aria-modal="true" aria-label={ETIQUETA_LANZADOR} onClick={(e) => e.stopPropagation()}>
            <ChatCanonico embebido panel cliente={cliente} onSalir={() => setAbierto(false)} etiquetaSalir="Cerrar" onLeido={onLeido} />
          </aside>
        </div>
      )}
    </>
  )
}
