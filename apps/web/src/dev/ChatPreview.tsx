// Vista previa SOLO en desarrollo (import.meta.env.DEV y ?preview=chat): monta la conversación canónica con
// un cliente falso en estados fijos para revisarla visualmente (escritorio y móvil) sin tocar el servidor.
// No existe en el bundle de producción.
import React from 'react'
import { ChatCanonico } from '../screens/chat/ChatCanonico'
import { ClienteChat, type Conversacion, type Mensaje } from '../data/ops/chat'
import { ClienteCarrito, type Carrito } from '../data/ops/carrito'

// Instantes relativos a ahora (sin partes de calendario del dispositivo: la guarda temporal de W5).
const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const msg = (seq: number, actor: Mensaje['actor'], content: string, propio = false, minutos = 30): Mensaje => ({ id: 'm' + seq, seq, actor, content, created_at: hace(minutos), propio })
const ayer = (seq: number, actor: Mensaje['actor'], content: string, propio = false): Mensaje => msg(seq, actor, content, propio, 26 * 60)
const base: Mensaje[] = [
  ayer(1, 'doctor', '¿Qué productos tienen para rejuvenecimiento facial?', true),
  ayer(2, 'ai', 'Para rejuvenecimiento facial manejamos la línea S2RM®: Golden Placenta Mask, el sérum de factores de crecimiento y el protocolo de bioestimulación. ¿Buscas algo para consultorio o para que el paciente use en casa?'),
  msg(3, 'doctor', 'Para consultorio. ¿La mascarilla tiene registro COFEPRIS?', true, 20),
  msg(4, 'ai', 'Sí. Golden Placenta Mask cuenta con registro COFEPRIS y certificación CE. Se aplica en cabina tras limpieza profunda; el protocolo completo son 6 sesiones.', false, 20),
]
const conv = (x: Partial<Conversacion>): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: 4, leido_hasta: 4, mensajes: base, asesor_nombre: null, handoff: { origen: null, cart_id: null, fuera_horario: null, asignado: false, puede_rechazar: false }, ...x })

const ESTADOS: Record<string, { conv: Conversacion; cart: Carrito | null; pendiente?: boolean }> = {
  ia_vacio: { conv: conv({}), cart: null },
  ia_carrito: { conv: conv({}), cart: cartDe(1) },
  asignado: { conv: conv({ modo: 'human_assigned', asesor_nombre: 'Lucía', ultimo_seq: 5, handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: null, asignado: true, puede_rechazar: true }, mensajes: [...base, msg(5, 'system', 'Registramos tu solicitud para que un asesor personal de Renovacell te atienda; te avisaremos aquí en cuanto se una. Mientras tanto, el asistente sigue aquí para ayudarte.', false, 20)] }), cart: cartDe(1) },
  activo: { conv: conv({ modo: 'human_active', asesor_nombre: 'Lucía', ultimo_seq: 7, handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: false, asignado: true, puede_rechazar: false }, mensajes: [...base, msg(5, 'system', 'Lucía se unió a la conversación.', false, 20), msg(6, 'seller', 'Hola doctor, soy Lucía. Vi que agregaste la Golden Placenta Mask: con 3 piezas te aplica el precio por volumen. ¿Te preparo el pedido?', false, 20), msg(7, 'doctor', 'Sí, por favor. ¿Llega esta semana a Culiacán?', true, 20)] }), cart: cartDe(1) },
  escribiendo: { conv: conv({}), cart: null, pendiente: true },
}
function cartDe(n: number): Carrito {
  return { cart_id: 'K', estado: 'active', rev: 2, dueno: 'profile', audiencia: 'verified', puede_precio: true, conversation_id: 'C1', n_items: 1, cantidad_total: n, total: { estado: 'completo', monto: 350 * n },
    items: [{ product_id: 'P', nombre: 'Golden Placenta Mask', presentacion: 'Caja 5 pzas', imagen_url: null, cantidad: n, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 350, subtotal: 350 * n } }] }
}

export function ChatPreview() {
  const params = new URLSearchParams(window.location.search)
  const estado = ESTADOS[params.get('estado') ?? 'ia_vacio'] ?? ESTADOS.ia_vacio
  const expandir = params.get('carrito') === '1'
  const cliente = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: estado.conv.modo, nuevo: false }, error: null }
    if (a === 'leer') { const desde = Number(body.desde_seq ?? 0); return { data: { ...estado.conv, mensajes: estado.conv.mensajes.filter((m) => m.seq > desde) }, error: null } }
    if (a === 'enviar') { if (estado.pendiente) return new Promise(() => {}) as never; return { data: { id: 'n', seq: 9, idempotente: false, modo: estado.conv.modo, ia: 'respondio' }, error: null } }
    return { data: { ok: true }, error: null }
  }, () => null)
  const carrito = new ClienteCarrito(async () => ({ data: estado.cart, error: estado.cart ? null : { message: 'sin carrito' } }), () => null)
  React.useEffect(() => {
    if (expandir) { let n = 0; const t = setInterval(() => { const b = document.querySelector('[data-testid="carrito-toggle"]') as HTMLButtonElement | null; if (b || ++n > 40) { clearInterval(t); b?.click() } }, 100) }
    if (estado.pendiente) setTimeout(() => {
      const ta = document.querySelector('textarea') as HTMLTextAreaElement | null
      if (!ta) return
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '¿Cuál es el precio por volumen?'); ta.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => ta.closest('form')?.requestSubmit(), 150)
    }, 400)
  }, [expandir, estado])
  const panel = params.get('panel') !== '0'
  return (
    <div style={{ height: '100dvh', display: 'flex', justifyContent: 'flex-end', background: 'var(--hueso)' }}>
      <div className="chat-drawer" style={{ animation: 'none' }}>
        <ChatCanonico embebido panel={panel} cliente={cliente} clienteCarrito={carrito} onSalir={() => {}} etiquetaSalir="Cerrar" intervaloMs={600_000} />
      </div>
    </div>
  )
}
