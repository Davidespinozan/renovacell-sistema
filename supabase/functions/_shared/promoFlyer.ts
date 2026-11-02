// PROMOCIÓN DESDE UN FLYER (2 nov 2026, dueño: "subir una imagen de un flyer y que la lea completa"). Puro (sin red ni
// Deno): arma la petición a Claude con la imagen y el catálogo vendible, y valida lo que responde. La herramienta es
// OBLIGATORIA (tool_choice) para que la respuesta siempre tenga la misma forma; nada se guarda aquí: la pantalla
// muestra lo leído en el formulario de siempre y Dirección lo revisa antes de guardar.
// (2 nov) tool_choice 'auto': los modelos 5.x piensan por defecto y la API rechaza (400) forzar una herramienta con
// pensamiento; la instrucción pide usarla y, si no la usa, la respuesta se rechaza abajo.
export interface ProductoCatalogo { id: string; nombre: string }
export interface LineaFlyer { producto_id: string | null; texto: string; min_qty: number; precio: number }
export interface PromoFlyer { nombre: string; desde: string | null; hasta: string | null; condiciones: string | null; lineas: LineaFlyer[]; sin_leer: string[] }

export const MODELO_FLYER = 'claude-opus-5-5'   // leer precios de una imagen densa: el más preciso; se usa pocas veces al mes
export const MAX_IMAGEN_FLYER = 5 * 1024 * 1024 // tope de Anthropic por imagen (en base64)
export const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

const HERRAMIENTA = {
  name: 'registrar_promocion',
  description: 'Registra la promoción que aparece en el flyer, tal como está escrita.',
  input_schema: {
    type: 'object', additionalProperties: false,
    required: ['nombre', 'lineas', 'sin_leer'],
    properties: {
      nombre: { type: 'string', description: 'Nombre corto de la promoción como aparece (p. ej. "Promo Allergan").' },
      desde: { type: ['string', 'null'], description: 'Inicio de vigencia YYYY-MM-DD, o null si el flyer no lo dice.' },
      hasta: { type: ['string', 'null'], description: 'Fin de vigencia YYYY-MM-DD, o null si el flyer no lo dice.' },
      condiciones: { type: ['string', 'null'], description: 'Condiciones o letra chica tal cual (hasta agotar existencias, solo transferencia, etc.).' },
      lineas: {
        type: 'array', description: 'Un renglón por producto y por escalón de cantidad con su precio por pieza.',
        items: {
          type: 'object', additionalProperties: false, required: ['texto', 'min_qty', 'precio', 'producto_id'],
          properties: {
            producto_id: { type: ['string', 'null'], description: 'id del producto del CATÁLOGO que corresponde, o null si no hay uno claro.' },
            texto: { type: 'string', description: 'El producto como aparece en el flyer.' },
            min_qty: { type: 'integer', description: 'Desde cuántas piezas aplica ese precio (1 si no dice).' },
            precio: { type: 'number', description: 'Precio por pieza en pesos, sin signos.' },
          },
        },
      },
      sin_leer: { type: 'array', items: { type: 'string' }, description: 'Lo que se ve en el flyer pero no pudiste interpretar con seguridad.' },
    },
  },
}

/** Petición a la API de mensajes de Anthropic (sin pensamiento: la herramienta va forzada). */
export function peticionFlyer(imagenB64: string, mediaType: string, catalogo: ProductoCatalogo[], hoy: string, modelo = MODELO_FLYER): Record<string, unknown> {
  const lista = catalogo.map((p) => `${p.id} | ${p.nombre}`).join('\n')
  return {
    model: modelo, max_tokens: 8000, tools: [HERRAMIENTA], tool_choice: { type: 'auto' },
    system: `Lees flyers de promociones de Renovacell (productos médicos y estéticos para profesionales). Hoy es ${hoy}. Transcribe EXACTAMENTE lo que dice el flyer: no inventes productos, precios ni fechas. Si una fecha no trae año, usa el año de hoy (o el siguiente si ya pasó). Cada escalón de precio por cantidad es un renglón distinto. Para producto_id elige del catálogo solo si es claramente el mismo producto (misma marca y presentación); si dudas, null.`,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imagenB64 } },
      { type: 'text', text: `CATÁLOGO (id | nombre):\n${lista}\n\nRegistra la promoción de este flyer con la herramienta registrar_promocion (úsala siempre, una sola vez).` },
    ] }],
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Valida y limpia la respuesta: solo ids del catálogo, cantidades enteras ≥ 1, precios > 0, fechas válidas. */
export function leerRespuestaFlyer(body: unknown, catalogo: ProductoCatalogo[]): { ok: true; promo: PromoFlyer } | { ok: false; error: string } {
  const b = body as { content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }>; stop_reason?: string } | null
  if (b?.stop_reason === 'refusal') return { ok: false, error: 'No se pudo leer ese flyer.' }
  const uso = b?.content?.find((c) => c?.type === 'tool_use' && c.name === HERRAMIENTA.name)
  const i = uso?.input
  if (!i) return { ok: false, error: 'No se pudo leer ese flyer.' }
  const ids = new Set(catalogo.map((p) => p.id))
  const txt = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const fecha = (v: unknown) => (typeof v === 'string' && FECHA.test(v) && !Number.isNaN(Date.parse(v)) ? v : null)
  const lineas: LineaFlyer[] = (Array.isArray(i.lineas) ? i.lineas : []).flatMap((l: Record<string, unknown>) => {
    const precio = Number(l?.precio); const min = Math.max(1, Math.round(Number(l?.min_qty) || 1)); const texto = txt(l?.texto, 200)
    if (!texto || !(precio > 0) || precio > 10_000_000) return []
    const pid = typeof l?.producto_id === 'string' && ids.has(l.producto_id) ? l.producto_id : null
    return [{ producto_id: pid, texto, min_qty: min, precio: Math.round(precio * 100) / 100 }]
  })
  let desde = fecha(i.desde), hasta = fecha(i.hasta)
  if (desde && hasta && hasta < desde) [desde, hasta] = [hasta, desde]
  return { ok: true, promo: { nombre: txt(i.nombre, 120) ?? 'Promoción', desde, hasta, condiciones: txt(i.condiciones, 500), lineas,
    sin_leer: (Array.isArray(i.sin_leer) ? i.sin_leer : []).map((s) => txt(s, 200)).filter((s): s is string => !!s).slice(0, 20) } }
}
