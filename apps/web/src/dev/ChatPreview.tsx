// Vista previa SOLO en desarrollo (import.meta.env.DEV y ?preview=chat): monta la conversación canónica con
// un cliente falso en estados fijos para revisarla visualmente (escritorio y móvil) sin tocar el servidor.
// No existe en el bundle de producción.
import React from 'react'
import { ChatCanonico } from '../screens/chat/ChatCanonico'
import { ClienteChat, type Conversacion, type Mensaje, type SesionListada, type SesionResumen } from '../data/ops/chat'
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

// Chat V2-C3 · sesiones de ejemplo (forma de cc_sesiones_listar / cc_sesion_leer).
type Detalle = { meta: SesionResumen & { asesor_nombre: string | null }; mensajes: Mensaje[] }
const sesion = (id: string, ordinal: number, desdeMin: number, hastaMin: number | null, motivo: string | null, asesor: string | null, primero: number, ultimo: number): SesionListada => ({
  id, ordinal, estado: hastaMin == null ? 'abierta' : 'cerrada', origen: 'cliente', first_seq: primero, last_seq: hastaMin == null ? null : ultimo, opened_at: hace(desdeMin), closed_at: hastaMin == null ? null : hace(hastaMin),
  close_reason: motivo, actual: hastaMin == null, last_activity_at: hace(hastaMin ?? 5), n_mensajes: ultimo - primero + 1, asesor_nombre: asesor })
const humana: Mensaje[] = [
  msg(1, 'doctor', 'Hola, quiero cotizar 3 cajas de Golden Placenta Mask.', true, 140), msg(2, 'system', 'Registramos tu solicitud para que un asesor personal te atienda.', false, 139),
  msg(3, 'ai', 'Mientras se une tu asesora: la mascarilla tiene precio por volumen desde 3 piezas.', false, 139), msg(4, 'system', 'Lucía se unió a la conversación.', false, 120),
  msg(5, 'seller', 'Hola doctor, soy Lucía. Con 3 cajas te aplica el precio por volumen. ¿Te preparo el pedido?', false, 119), msg(6, 'doctor', 'Sí, a Culiacán por favor.', true, 115),
  msg(7, 'seller', 'Listo, te lo dejo en el carrito para que lo confirmes cuando quieras.', false, 112), msg(8, 'doctor', 'Gracias.', true, 110), msg(9, 'system', 'La asesoría terminó. Puedes seguir escribiendo; te responde el asistente.', false, 100),
]
const soloIA: Mensaje[] = [msg(1, 'visitor', '¿Hacen envíos a Monterrey?', true, 1500), msg(2, 'ai', 'Sí, enviamos a todo México con paquetería; el tiempo estimado a Monterrey es de 2 a 3 días hábiles.', false, 1499)]
const largo: Mensaje[] = Array.from({ length: 150 }, (_, i) => msg(i + 1, i % 2 ? 'ai' : 'doctor', i % 2 ? `Respuesta del asistente ${i + 1}.` : `Pregunta ${i + 1}.`, i % 2 === 0, 3000 - i))
const S_HUM = sesion('S1', 1, 140, 100, 'asesor_finalizo', 'Lucía · Ventas', 1, 9)
const S_IA = sesion('S0', 1, 1500, 1260, 'inactividad', null, 1, 2)
const S_LARGA = sesion('SL', 1, 3000, 2800, 'inactividad', null, 1, 150)
const DETALLE: Record<string, Detalle> = {
  S1: { meta: { ...S_HUM, asesor_nombre: 'Lucía · Ventas' }, mensajes: humana },
  S0: { meta: { ...S_IA }, mensajes: soloIA },
  SL: { meta: { ...S_LARGA }, mensajes: largo },
}
const cerradaComoActual = conv({ ultimo_seq: 9, leido_hasta: 9, mensajes: humana, sesion: S_HUM })
const conActual = (desde: number) => { const a = sesion('S2', 2, 10, null, null, null, desde, desde + 1); return conv({ ultimo_seq: desde + 1, mensajes: [msg(desde, 'doctor', 'Hola de nuevo, ¿siguen las promociones?', true, 10), msg(desde + 1, 'ai', 'Sí, este mes la línea S2RM® tiene precio especial por volumen.', false, 9)], sesion: a }) }

const ESTADOS: Record<string, { conv: Conversacion; cart: Carrito | null; pendiente?: boolean; sesiones?: SesionListada[]; auto?: string; nuevo?: Mensaje; visor?: 'personal' }> = {
  // Chat V2-C3
  sin_abierta: { conv: cerradaComoActual, cart: null, sesiones: [S_HUM] },
  lista: { conv: conActual(10), cart: null, sesiones: [sesion('S2', 2, 10, null, null, null, 10, 11), S_HUM, S_IA], auto: 'btn-historial' },
  hist_ia: { conv: conActual(3), cart: null, sesiones: [sesion('S2', 2, 10, null, null, null, 3, 4), S_IA], auto: 'btn-historial>hist-sesion' },
  hist_humana: { conv: cerradaComoActual, cart: null, sesiones: [S_HUM], auto: 'tarjeta-anterior-ver' },
  hist_personal: { conv: { ...cerradaComoActual, rol: 'supervisor' }, cart: null, sesiones: [S_HUM], auto: 'tarjeta-anterior-ver', visor: 'personal' },
  aviso: { conv: conActual(10), cart: null, sesiones: [sesion('S2', 2, 10, null, null, null, 10, 11), S_HUM], auto: 'btn-historial>hist-sesion', nuevo: msg(12, 'seller', 'Doctor, ya quedó su pedido.', false, 0) },
  hist_100: { conv: conActual(151), cart: null, sesiones: [sesion('S2', 2, 10, null, null, null, 151, 152), S_LARGA], auto: 'btn-historial>hist-sesion' },

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
  const lecturas = React.useRef(0)
  const cliente = React.useMemo(() => new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string
    if (a === 'sesiones') return { data: { conversation_id: 'C1', sesiones: estado.sesiones ?? [] }, error: null }
    if (a === 'leer_sesion') {
      const d = DETALLE[body.session_id as string]; const desde = Number(body.desde_seq ?? 0)
      if (!d) return { data: null, error: { context: new Response(JSON.stringify({ error: 'no_autorizado', message: 'x' })) } }
      await new Promise((r) => setTimeout(r, 250))
      // Para el personal, los mensajes del doctor NO son propios (así los marca el servidor).
      const vistos = estado.visor === 'personal' ? d.mensajes.map((m) => ({ ...m, propio: false })) : d.mensajes
      return { data: { sesion: d.meta, rol: 'dueno', solo_lectura: true, mensajes: vistos.filter((m) => m.seq > desde).slice(0, 100) }, error: null }
    }
    if (a === 'leer' && estado.nuevo && ++lecturas.current > 1) {
      const desde = Number(body.desde_seq ?? 0); const c = { ...estado.conv, mensajes: [...estado.conv.mensajes, estado.nuevo] }
      return { data: { ...c, ultimo_seq: estado.nuevo.seq, mensajes: c.mensajes.filter((m) => m.seq > desde) }, error: null }
    }
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: estado.conv.modo, nuevo: false }, error: null }
    if (a === 'leer') { const desde = Number(body.desde_seq ?? 0); return { data: { ...estado.conv, mensajes: estado.conv.mensajes.filter((m) => m.seq > desde) }, error: null } }
    if (a === 'enviar') { if (estado.pendiente) return new Promise(() => {}) as never; return { data: { id: 'n', seq: 9, idempotente: false, modo: estado.conv.modo, ia: 'respondio' }, error: null } }
    return { data: { ok: true }, error: null }
  }, () => null), [estado])
  const carrito = new ClienteCarrito(async () => ({ data: estado.cart, error: estado.cart ? null : { message: 'sin carrito' } }), () => null)
  React.useEffect(() => {
    let auto: ReturnType<typeof setInterval> | undefined
    if (expandir) { let n = 0; const t = setInterval(() => { const b = document.querySelector('[data-testid="carrito-toggle"]') as HTMLButtonElement | null; if (b || ++n > 40) { clearInterval(t); b?.click() } }, 100) }
    if (estado.pendiente) setTimeout(() => {
      const ta = document.querySelector('textarea') as HTMLTextAreaElement | null
      if (!ta) return
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, '¿Cuál es el precio por volumen?'); ta.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => ta.closest('form')?.requestSubmit(), 150)
    }, 400)
    if (estado.auto) {
      // Chat V2-C3 · recorre la navegación pedida (p. ej. "btn-historial>hist-sesion") cuando cada control aparece.
      const pasos = estado.auto.split('>'); let n = 0
      auto = setInterval(() => {
        const b = document.querySelector(`[data-testid="${pasos[0]}"]`) as HTMLButtonElement | null
        if (b) { b.click(); pasos.shift() }
        if (!pasos.length || ++n > 60) clearInterval(auto)
      }, 150)
    }
    return () => clearInterval(auto)   // StrictMode monta dos veces: un solo recorrido
  }, [expandir, estado])
  const panel = params.get('panel') !== '0'
  return (
    <div style={{ height: '100dvh', display: 'flex', justifyContent: 'flex-end', background: 'var(--hueso)' }}>
      <div className="chat-drawer" style={{ animation: 'none' }}>
        <ChatCanonico embebido panel={panel} cliente={cliente} clienteCarrito={carrito} onSalir={() => {}} etiquetaSalir="Cerrar" intervaloMs={estado.nuevo ? 2500 : 600_000}
          asesor={estado.visor === 'personal'} nombreCliente={estado.visor === 'personal' ? 'david espinoza' : null} />
      </div>
    </div>
  )
}
