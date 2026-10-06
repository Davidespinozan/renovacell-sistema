// CC-2 · Superficie mínima de la conversación canónica. Sirve a tres entradas con el MISMO
// componente y el MISMO hilo: visitante en /chat (token CC-1), doctor en /chat o dentro del
// portal (JWT), y asesor/Dirección abriendo una conversación asignada (modo asesor).
// Historial, envío, estado, indicador IA/asesor y "Hablar con un asesor". Nada más todavía.
// Transporte: polling acotado y solo con la pestaña visible; la autoridad es el servidor.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chat as clientePorDefecto, ETIQUETA_MODO, IA_PUEDE, type ClienteChat, type Conversacion, type Mensaje, type ModoConversacion } from '../../data/ops/chat'
import { CarritoPanel } from './CarritoPanel'   // CC-5 · carrito canónico (dueño muta; asesor/Dirección solo lee)
import type { ClienteCarrito } from '../../data/ops/carrito'

interface Props {
  embebido?: boolean                 // dentro del portal (sin cabecera de página completa)
  conversationId?: string           // modo asesor: abrir una conversación concreta
  asesor?: boolean                  // controles de asesor (tomar/iniciar/terminar/liberar)
  cliente?: ClienteChat
  intervaloMs?: number
  onSalir?: () => void
  conCarrito?: boolean               // CC-5 · panel de carrito (default: sí)
  clienteCarrito?: ClienteCarrito
}

const NOMBRE_ACTOR: Record<Mensaje['actor'], string> = { visitor: 'Tú', doctor: 'Tú', seller: 'Asesor', admin: 'Renovacell', ai: 'Asistente', system: '' }

export function ChatCanonico({ embebido = false, conversationId, asesor = false, cliente = clientePorDefecto, intervaloMs = 4000, onSalir, conCarrito = true, clienteCarrito }: Props) {
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [convId, setConvId] = useState<string | null>(conversationId ?? null)
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fin = useRef<HTMLDivElement | null>(null)
  const ultimoSeq = useRef(0)

  const cargar = useCallback(async (id: string, desde = 0) => {
    const r = await cliente.leer(id, desde)
    if (!r.ok) { setError(r.error.mensaje); return }
    setError(null)
    setConv((prev) => {
      if (!prev || desde === 0 || prev.conversation_id !== id) return r.data
      const vistos = new Set(prev.mensajes.map((m) => m.seq))
      return { ...r.data, mensajes: [...prev.mensajes, ...r.data.mensajes.filter((m) => !vistos.has(m.seq))] }
    })
    const max = r.data.mensajes.reduce((s, m) => Math.max(s, m.seq), desde)
    if (max > ultimoSeq.current) { ultimoSeq.current = max; void cliente.leido(id, max) }
  }, [cliente])

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

  useEffect(() => { fin.current?.scrollIntoView?.({ block: 'end' }) }, [conv?.mensajes.length])

  const modo: ModoConversacion = conv?.modo ?? 'ai_active'
  const cerrada = conv?.estado === 'cerrada'
  const soyAsesor = asesor && (conv?.rol === 'asesor' || conv?.rol === 'supervisor')
  const puedoEscribir = !!conv && !cerrada && (soyAsesor ? modo === 'human_active' || conv.rol === 'supervisor' : true)

  const enviar = async () => {
    const t = texto.trim()
    if (!convId || !t || enviando) return
    setEnviando(true); setError(null)
    const r = await cliente.enviar(convId, t)
    if (!r.ok) setError(r.error.mensaje)
    else { setTexto(''); await cargar(convId, ultimoSeq.current) }
    setEnviando(false)
  }
  const accion = async (fn: () => Promise<{ ok: boolean; error?: { mensaje: string } }>) => {
    if (!convId) return
    setError(null)
    const r = await fn()
    if (!r.ok && r.error) setError(r.error.mensaje)
    await cargar(convId, 0)
  }

  const mensajes = useMemo(() => conv?.mensajes ?? [], [conv])

  return (
    <div className={embebido ? 'card' : undefined} style={embebido ? { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 420 } : estilos.pagina} data-testid="chat-canonico">
      <header style={estilos.cabecera}>
        <div>
          <div style={{ fontWeight: 700 }}>{asesor ? 'Asesoría' : 'Chat Renovacell'}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3, #667)' }} data-testid="chat-modo">
            {cerrada ? 'Conversación cerrada' : ETIQUETA_MODO[modo]}{conv?.asesor_nombre && modo !== 'ai_active' ? ` · ${conv.asesor_nombre}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!asesor && !cerrada && conv && (modo === 'ai_active' || modo === 'human_offered') && (
            <button type="button" className="btn" onClick={() => accion(() => cliente.solicitarAsesor(convId!))} data-testid="btn-asesor">Hablar con un asesor</button>
          )}
          {!asesor && !cerrada && conv && modo === 'human_ended' && (
            <button type="button" className="btn" onClick={() => accion(() => cliente.reanudarIA(convId!))}>Seguir con el asistente</button>
          )}
          {soyAsesor && conv && modo === 'human_assigned' && conv.asesor_soy_yo && (
            <button type="button" className="btn" onClick={() => accion(() => cliente.iniciar(convId!))} data-testid="btn-iniciar">Iniciar asesoría</button>
          )}
          {soyAsesor && conv && (modo === 'human_active' || modo === 'human_assigned') && (conv.asesor_soy_yo || conv.rol === 'supervisor') && (
            <button type="button" className="btn" onClick={() => accion(() => cliente.terminar(convId!))} data-testid="btn-terminar">Terminar asesoría</button>
          )}
          {conv?.rol === 'supervisor' && conv && modo !== 'ai_active' && !cerrada && (
            <button type="button" className="btn" onClick={() => accion(() => cliente.liberar(convId!))}>Devolver a la cola</button>
          )}
          {onSalir && <button type="button" className="btn" onClick={onSalir}>Volver</button>}
        </div>
      </header>

      {conCarrito && convId && conv && (
        // Dueño: su carrito activo ligado a esta conversación. Asesor/Dirección: el carrito del dueño, solo lectura (el servidor lo decide).
        <CarritoPanel conversationId={asesor ? null : convId} cartId={asesor ? conv.cart_id ?? null : null} soloLectura={asesor} cliente={clienteCarrito} />
      )}

      <div style={estilos.hilo} aria-live="polite">
        {cargando && <div style={{ color: 'var(--ink-3, #667)' }}>Cargando conversación…</div>}
        {!cargando && mensajes.length === 0 && !error && (
          <div style={{ color: 'var(--ink-3, #667)' }}>{asesor ? 'Sin mensajes todavía.' : 'Hola, soy el asistente de Renovacell. ¿En qué te ayudo?'}</div>
        )}
        {mensajes.map((m) => m.actor === 'system'
          ? <div key={m.id} style={estilos.sistema} data-testid="msg-system">{m.content}</div>
          : (
            <div key={m.id} style={{ ...estilos.burbuja, ...(m.propio ? estilos.propio : {}), ...(m.actor === 'ai' ? estilos.ia : {}) }} data-testid={`msg-${m.actor}`}>
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{m.propio ? 'Tú' : NOMBRE_ACTOR[m.actor]}</div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
            </div>
          ))}
        <div ref={fin} />
      </div>

      {error && <div role="alert" style={estilos.error}>{error}</div>}

      <form style={estilos.pie} onSubmit={(e) => { e.preventDefault(); void enviar() }}>
        <input
          aria-label="Escribe tu mensaje" value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4000}
          disabled={!puedoEscribir || enviando}
          placeholder={cerrada ? 'La conversación está cerrada' : soyAsesor && modo !== 'human_active' && conv?.rol !== 'supervisor' ? 'Inicia la asesoría para escribir' : 'Escribe tu mensaje…'}
          style={estilos.input}
        />
        <button type="submit" className="btn btn-primary" disabled={!puedoEscribir || enviando || !texto.trim()} data-testid="btn-enviar">{enviando ? 'Enviando…' : 'Enviar'}</button>
      </form>
      {!asesor && conv && !cerrada && IA_PUEDE(modo) && modo === 'human_requested' && (
        <div style={{ fontSize: 12, color: 'var(--ink-3, #667)', padding: '4px 12px' }}>Un asesor te atenderá en breve; el asistente sigue disponible mientras tanto.</div>
      )}
    </div>
  )
}

const estilos: Record<string, React.CSSProperties> = {
  pagina: { display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 760, margin: '0 auto', background: 'var(--bg, #fff)', color: 'var(--ink, #111)', fontFamily: 'system-ui, sans-serif' },
  cabecera: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line, #e5e7eb)' },
  hilo: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  burbuja: { alignSelf: 'flex-start', maxWidth: '85%', background: 'var(--bg-2, #f3f4f6)', borderRadius: 12, padding: '8px 12px', fontSize: 14 },
  propio: { alignSelf: 'flex-end', background: 'var(--brand-soft, #d1fae5)' },
  ia: { background: 'var(--bg-2, #eef2ff)' },
  sistema: { alignSelf: 'center', fontSize: 12, color: 'var(--ink-3, #667)', fontStyle: 'italic' },
  pie: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--line, #e5e7eb)' },
  input: { flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line, #d1d5db)', fontSize: 14 },
  error: { margin: '0 12px', padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 },
}
