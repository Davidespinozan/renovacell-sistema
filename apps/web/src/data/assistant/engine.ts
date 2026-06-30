// MOTOR del Asistente IA del Portal (mock, sin LLM todavía).
//
// Este archivo es EL PUNTO DE SWAP: mañana `answer()` se reemplaza por una
// llamada al LLM real con exactamente el mismo contrato (texto del doctor +
// contexto = catálogo y SUS pedidos) y la UI no cambia. Por eso el alcance y los
// guardarraíles viven aquí: así es como se prompteará el modelo real.
//
// ALCANCE (concierge de PEDIDOS, no asesor clínico):
//   sí → descubrir productos del catálogo, armar/reordenar pedidos, ver estatus.
//   no → consejo médico/clínico, dosis, indicaciones de uso → SE DEFIERE.
// Todas las respuestas salen de data REAL (no se inventan productos ni claims).
import type { ProductSafe } from '../types'
import type { OrderWithItems } from '../store/ordersStore'

export type AssistantIntent =
  | 'greeting' | 'help' | 'discover' | 'professional'
  | 'status' | 'reorder' | 'clinical' | 'out_of_scope'

export interface AssistantReply {
  intent: AssistantIntent
  text: string
  products?: ProductSafe[]        // tarjetas de producto (descubrir / professional)
  statusOrders?: OrderWithItems[] // estatus de pedidos reales del doctor
  reorder?: OrderWithItems | null // último pedido para recrear
}

export interface AssistantContext {
  products: ProductSafe[]
  orders: OrderWithItems[] // SOLO los del doctor actual (useOrders)
}

const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const has = (h: string, needles: string[]): boolean => needles.some((n) => h.includes(n))

// Señales CLÍNICAS / fuera de alcance regulado → se defiere (no se aconseja).
const CLINICAL = [
  'dosis', 'dosific', 'cuanto me', 'cuanto debo', 'cuanta', 'cuantas unidades', 'cuantos ml', ' ml',
  'como se aplica', 'como aplico', 'como lo aplico', 'como usar', 'modo de uso', 'forma de uso',
  'aplicacion', 'aplicar', 'inyect', 'administr', 'frecuencia', 'cada cuanto', 'protocolo',
  'contraindic', 'efecto secundario', 'efectos secundarios', 'reaccion', 'es seguro', 'seguro usar',
  'puedo combinar', 'combinar con', 'mezclar con', 'embaraz', 'lactancia', 'alergi',
  'sirve para curar', 'cura el', 'cura la', 'para que enfermedad', 'enfermedad', 'diagnost',
  'receta', 'prescrib', 'tratamiento para', 'me lo pongo', 'cuanto tiempo', 'efectos',
]

const STATUS = ['estatus', 'estado', 'seguimiento', 'rastre', 'donde esta', 'donde va', 'va mi pedido',
  'llego', 'llega', 'mis pedidos', 'mi pedido', 'mi ultimo pedido', 'pedido voy', 'como va']
const REORDER = ['reorden', 'volver a pedir', 'repetir', 'otra vez', 'de nuevo', 'mismo pedido',
  'recompra', 'recrea', 'vuelve a pedir', 'mi ultima compra', 'pedir lo mismo']
const PRO = ['professional', 'profesional', 'inyectable', 'inyectables']
const GREET = ['hola', 'buenas', 'buenos dias', 'buen dia', 'hey', 'que tal', 'que onda']
const HELP = ['ayuda', 'que puedes', 'que haces', 'que sabes', 'opciones', 'como funciona']

const STOP = new Set(['para', 'con', 'que', 'los', 'las', 'una', 'uno', 'del', 'por', 'quiero',
  'busco', 'buscar', 'producto', 'productos', 'algo', 'sirve', 'linea', 'tienes', 'hay', 'necesito',
  'recomienda', 'recomiendame', 'dame', 'muestra', 'ver', 'mostrar', 'tengo', 'sobre', 'cual', 'cuales',
  'mejor', 'bueno', 'buena', 'unos', 'unas', 'algun', 'alguna', 'porfa', 'favor'])

// Sinónimos → término que SÍ existe en el catálogo (nombre/categoría/descripción).
// No agregan claims; solo acercan la búsqueda a lo que el catálogo ya dice.
const SYN: Record<string, string> = {
  pelo: 'capilar', cabello: 'capilar', capilar: 'capilar', calvicie: 'capilar', alopecia: 'capilar',
  labio: 'labial', labios: 'labial', boca: 'labial',
  arruga: 'antiedad', arrugas: 'antiedad', antiarrugas: 'antiedad', edad: 'antiedad',
  envejec: 'antiedad', rejuvenec: 'antiedad', antienvejecimiento: 'antiedad',
  mascarilla: 'mascarilla', placenta: 'placenta', suero: 'suero', booster: 'booster',
  facial: 'facial', cara: 'facial', rostro: 'facial', piel: 'facial',
}

function haystack(p: ProductSafe): string {
  const lineWords = p.line === 'prof' ? 'professional profesional inyectable' : 'home care cosmetico facial'
  return norm(`${p.name} ${p.category ?? ''} ${p.description ?? ''} ${lineWords}`)
}

function search(query: string, products: ProductSafe[]): ProductSafe[] {
  const tokens = norm(query)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
  const expanded = new Set<string>()
  tokens.forEach((t) => {
    expanded.add(t)
    Object.entries(SYN).forEach(([k, v]) => { if (t.includes(k)) expanded.add(v) })
  })
  if (expanded.size === 0) return []
  const terms = [...expanded]
  return products.filter((p) => { const h = haystack(p); return terms.some((t) => h.includes(t)) })
}

const SCOPE_NUDGE = '¿Te ayudo a encontrar un producto, ver el estatus de un pedido o reordenar?'

// answer(): contrato estable. Mañana → llamada al LLM con (text, ctx) y misma forma de salida.
export function answer(text: string, ctx: AssistantContext): AssistantReply {
  const q = norm(text.trim())
  if (!q) return { intent: 'help', text: helpText() }

  // 1) Guardarraíl clínico PRIMERO (cliente regulado): no se aconseja, se defiere.
  if (has(q, CLINICAL)) {
    return {
      intent: 'clinical',
      text:
        'Soy un asistente de pedidos, no clínico, así que no puedo darte dosis, indicaciones de uso ' +
        'ni consejo médico. Para uso clínico revisa la ficha técnica del producto o consúltalo ' +
        'directamente con Renovacell. ' + SCOPE_NUDGE,
    }
  }

  // 2) Reordenar (antes que estatus, porque suele decir "pedido").
  if (has(q, REORDER)) {
    const last = ctx.orders[0] ?? null // useOrders ya viene ordenado por fecha desc
    if (!last) return { intent: 'reorder', text: noOrdersText(), reorder: null }
    return {
      intent: 'reorder',
      text: `Tu pedido más reciente es ${last.external_ref} (${last.items.length} renglón(es)). ¿Lo recreo tal cual?`,
      reorder: last,
    }
  }

  // 3) Estatus de pedidos (data real del doctor).
  if (has(q, STATUS)) {
    if (ctx.orders.length === 0) return { intent: 'status', text: noOrdersText(), statusOrders: [] }
    return {
      intent: 'status',
      text: 'Estos son tus pedidos y su estatus actual:',
      statusOrders: ctx.orders.slice(0, 6),
    }
  }

  // 4) Línea Professional.
  if (has(q, PRO)) {
    const pro = ctx.products.filter((p) => p.line === 'prof')
    return {
      intent: 'professional',
      text:
        'Línea Professional (inyectables). Puedo agregarlos a tu pedido; la indicación de ' +
        'uso la ves con Renovacell o en la ficha técnica:',
      products: pro,
    }
  }

  // 5) Saludo / ayuda.
  if (has(q, HELP)) return { intent: 'help', text: helpText() }
  if (has(q, GREET) && q.length <= 18) {
    return {
      intent: 'greeting',
      text: '¡Hola! Soy tu asistente de pedidos de Renovacell. ' + SCOPE_NUDGE,
    }
  }

  // 6) Descubrir producto en el catálogo real.
  const found = search(text, ctx.products)
  if (found.length > 0) {
    return {
      intent: 'discover',
      text: `Esto encontré en el catálogo (${found.length}):`,
      products: found.slice(0, 6),
    }
  }

  // 7) Fallback honesto: no inventa.
  return {
    intent: 'out_of_scope',
    text:
      'No encontré eso en el catálogo y prefiero no inventar. Puedo ayudarte con: buscar un ' +
      "producto (por nombre o tipo, p. ej. “capilar”, “labial”, “antiedad”), ver la línea " +
      'Professional, el estatus de tus pedidos o reordenar el último.',
  }
}

function helpText(): string {
  return (
    'Soy tu asistente de pedidos de Renovacell. Te ayudo a:\n' +
    '• Descubrir productos del catálogo\n' +
    '• Armar o reordenar un pedido\n' +
    '• Ver el estatus de tus pedidos\n' +
    'No doy consejo clínico ni indicaciones de uso. ' + SCOPE_NUDGE
  )
}

function noOrdersText(): string {
  return 'No encuentro pedidos a tu nombre todavía. Cuando crees uno desde el catálogo aparecerá aquí con su estatus.'
}
