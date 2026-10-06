// CC-4 · REGISTRO CERRADO DE HERRAMIENTAS (puro, sin imports). El modelo solo puede pedir estos
// nombres con estos esquemas; cada llamada se valida y autoriza aquí (independiente del modelo)
// y la ejecuta el servidor contra la base. La salida se acota y se trata como DATA.
//
// Autoridad por herramienta:
//   cualquiera  → visitante o cuenta (la base además aplica la audiencia derivada);
//   cuenta      → requiere perfil (JWT): pedidos.
// Precio y disponibilidad se EXPONEN a todos para que el modelo pueda explicar que requieren
// verificación: la base devuelve PRICE_REQUIRES_VERIFICATION / AVAILABILITY_REQUIRES_VERIFICATION.

export type NombreHerramienta = 'buscar_productos' | 'obtener_ficha_producto' | 'comparar_productos' | 'buscar_conocimiento' | 'candidatos_comerciales' | 'obtener_precio' | 'obtener_disponibilidad' | 'obtener_estado_pedido' | 'solicitar_asesor'
  | 'ver_carrito' | 'agregar_al_carrito' | 'actualizar_carrito' | 'quitar_del_carrito' | 'vaciar_carrito' | 'declinar_asesor'   // CC-5
  | 'preparar_checkout'   // CC-6 (lectura; confirmar es SOLO por el botón del usuario)
export type Evidencia = 'PRICE_EVIDENCE' | 'STOCK_EVIDENCE' | 'KNOWLEDGE_EVIDENCE' | 'ORDER_EVIDENCE' | 'HUMAN_REQUESTED' | 'CART_READ_EVIDENCE' | 'CART_MUTATION_EVIDENCE' | 'CHECKOUT_REVIEW_EVIDENCE'
  // CC-7 · estado de la atención humana derivado del SERVIDOR (horario, ruteo, rechazo); el modelo no lo infiere
  | 'HANDOFF_SOLICITADO' | 'HANDOFF_EN_CURSO' | 'ASESOR_ASIGNADO' | 'ASESOR_SIN_ASIGNAR' | 'EN_HORARIO' | 'FUERA_DE_HORARIO' | 'HORARIO_DESCONOCIDO' | 'HANDOFF_RECHAZADO'
export interface DefinicionHerramienta { name: NombreHerramienta; description: string; input_schema: Record<string, unknown>; autoridad: 'cualquiera' | 'cuenta'; mutante: boolean }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_SALIDA_CHARS = 6000
export const MAX_RONDAS_DEFAULT = 4

const texto = (d: string, max = 200) => ({ type: 'string', description: d, maxLength: max })
export const HERRAMIENTAS: readonly DefinicionHerramienta[] = [
  { name: 'buscar_productos', autoridad: 'cualquiera', mutante: false, description: 'Busca productos del catálogo de Renovacell por nombre, familia, categoría o término. Devuelve candidatos autorizados (id, nombre, familia, categoría, presentación). Úsala antes de cualquier otra herramienta que necesite un product_id.',
    input_schema: { type: 'object', properties: { consulta: texto('Término de búsqueda (nombre, familia, categoría o palabra clave)', 120) }, required: ['consulta'], additionalProperties: false } },
  { name: 'obtener_ficha_producto', autoridad: 'cualquiera', mutante: false, description: 'Ficha aprobada de un producto (identidad, secciones de conocimiento aprobadas para esta audiencia con su fuente, relaciones curadas, avisos). Sin precio ni existencias.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id obtenido de buscar_productos o candidatos_comerciales', 36) }, required: ['product_id'], additionalProperties: false } },
  { name: 'comparar_productos', autoridad: 'cualquiera', mutante: false, description: 'Compara de 2 a 4 productos con su información aprobada e indica si la comparación está curada por Renovacell.',
    input_schema: { type: 'object', properties: { product_ids: { type: 'array', items: texto('product_id', 36), minItems: 2, maxItems: 4 } }, required: ['product_ids'], additionalProperties: false } },
  { name: 'buscar_conocimiento', autoridad: 'cualquiera', mutante: false, description: 'Busca en el conocimiento aprobado de productos y de la empresa (cómo comprar, envíos, pagos, verificación, certificaciones) por texto libre.',
    input_schema: { type: 'object', properties: { consulta: texto('Pregunta o términos', 160) }, required: ['consulta'], additionalProperties: false } },
  { name: 'candidatos_comerciales', autoridad: 'cualquiera', mutante: false, description: 'Candidatos comerciales (vendibles y visibles) por categoría, familia o términos de necesidad (p. ej. hidratación, labios, flacidez). Solo puedes recomendar productos que regresen aquí.',
    input_schema: { type: 'object', properties: { categoria: texto('Categoría', 80), familia: texto('Familia', 80), terminos: { type: 'array', items: texto('término', 40), maxItems: 5 } }, additionalProperties: false } },
  { name: 'obtener_precio', autoridad: 'cualquiera', mutante: false, description: 'Precio autorizado de un producto para este usuario (su lista y cantidad). Si el usuario no está verificado, devuelve que requiere verificación.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id autorizado', 36), cantidad: { type: 'integer', minimum: 1, maximum: 999, description: 'Cantidad (default 1)' } }, required: ['product_id'], additionalProperties: false } },
  { name: 'obtener_disponibilidad', autoridad: 'cualquiera', mutante: false, description: 'Disponibilidad comercial de un producto (disponible / no disponible) para usuarios verificados.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id autorizado', 36) }, required: ['product_id'], additionalProperties: false } },
  { name: 'obtener_estado_pedido', autoridad: 'cuenta', mutante: false, description: 'Estado de los pedidos del propio usuario (últimos 5 o por folio).',
    input_schema: { type: 'object', properties: { folio: texto('Folio del pedido (opcional)', 40) }, additionalProperties: false } },
  { name: 'solicitar_asesor', autoridad: 'cualquiera', mutante: true, description: 'Pide que un asesor humano de Renovacell atienda esta conversación. Idempotente.',
    input_schema: { type: 'object', properties: { motivo: texto('Motivo breve (opcional)', 120) }, additionalProperties: false } },
  // CC-5 · carrito canónico (mismos comandos que la UI; el servidor deriva dueño, precio y disponibilidad)
  { name: 'ver_carrito', autoridad: 'cualquiera', mutante: false, description: 'Muestra el carrito actual del usuario: productos, cantidades, disponibilidad y precio/total cuando están autorizados.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'agregar_al_carrito', autoridad: 'cualquiera', mutante: true, description: 'Agrega un producto (por product_id de buscar_productos/candidatos) al carrito con una cantidad. SOLO cuando el usuario lo pidió de forma explícita e inequívoca; si hay varios productos posibles, pregunta antes. Suma a lo que ya haya.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id autorizado', 36), cantidad: { type: 'integer', minimum: 1, maximum: 999, description: 'Cantidad a agregar (default 1)' } }, required: ['product_id'], additionalProperties: false } },
  { name: 'actualizar_carrito', autoridad: 'cualquiera', mutante: true, description: 'Fija la cantidad exacta de un producto que YA está en el carrito (0 = quitarlo). Solo a petición explícita.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id del carrito', 36), cantidad: { type: 'integer', minimum: 0, maximum: 999 } }, required: ['product_id', 'cantidad'], additionalProperties: false } },
  { name: 'quitar_del_carrito', autoridad: 'cualquiera', mutante: true, description: 'Quita un producto del carrito. Solo a petición explícita.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id del carrito', 36) }, required: ['product_id'], additionalProperties: false } },
  { name: 'vaciar_carrito', autoridad: 'cualquiera', mutante: true, description: 'Vacía el carrito. Solo a petición explícita e inequívoca.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'declinar_asesor', autoridad: 'cualquiera', mutante: true, description: 'Registra que el usuario NO quiere que un asesor humano lo atienda en esta compra (solo cuando lo diga de forma inequívoca). Tú sigues atendiéndolo.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  // CC-6 · preparar checkout = LECTURA: total actual, disponibilidad y lo que falta. NO existe herramienta para confirmar:
  // el pedido se crea solo cuando el usuario pulsa "Confirmar pedido" en su carrito (prueba explícita que el modelo no puede fabricar).
  { name: 'preparar_checkout', autoridad: 'cualquiera', mutante: false, description: 'Revisa si el carrito está listo para convertirse en pedido: total actual (si está autorizado), disponibilidad y problemas (cuenta, verificación, dirección). No crea el pedido: el usuario lo confirma con el botón "Confirmar pedido" de su carrito.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
]
export const NOMBRES = new Set<string>(HERRAMIENTAS.map((h) => h.name))

/** Herramientas expuestas al modelo según el actor (los pedidos solo con cuenta). */
export function herramientasPara(conCuenta: boolean): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return HERRAMIENTAS.filter((h) => h.autoridad === 'cualquiera' || conCuenta).map(({ name, description, input_schema }) => ({ name, description, input_schema }))
}

export type Validada = { ok: true; nombre: NombreHerramienta; args: Record<string, unknown>; ids: string[] } | { ok: false; motivo: 'desconocida' | 'no_autorizada' | 'argumentos' | 'id_no_autorizado' }

const str = (v: unknown, max: number): string | null => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
const uuid = (v: unknown): string | null => typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null

/** Valida nombre, forma y AUTORIDAD de una llamada del modelo. Los product_id deben venir de retrieval autorizado en este turno. */
export function validarLlamada(nombre: unknown, input: unknown, ctx: { conCuenta: boolean; idsAutorizados: Set<string> }): Validada {
  if (typeof nombre !== 'string' || !NOMBRES.has(nombre)) return { ok: false, motivo: 'desconocida' }
  const def = HERRAMIENTAS.find((h) => h.name === nombre)!
  if (def.autoridad === 'cuenta' && !ctx.conCuenta) return { ok: false, motivo: 'no_autorizada' }
  const i = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const n = nombre as NombreHerramienta
  switch (n) {
    case 'buscar_productos': { const q = str(i.consulta, 120); return q ? { ok: true, nombre: n, args: { consulta: q }, ids: [] } : { ok: false, motivo: 'argumentos' } }
    case 'buscar_conocimiento': { const q = str(i.consulta, 160); return q ? { ok: true, nombre: n, args: { consulta: q }, ids: [] } : { ok: false, motivo: 'argumentos' } }
    case 'obtener_ficha_producto': case 'obtener_disponibilidad': {
      const id = uuid(i.product_id); if (!id) return { ok: false, motivo: 'argumentos' }
      if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
      return { ok: true, nombre: n, args: { product_id: id }, ids: [id] }
    }
    case 'obtener_precio': {
      const id = uuid(i.product_id); if (!id) return { ok: false, motivo: 'argumentos' }
      if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
      const c = Number(i.cantidad ?? 1); const cantidad = Number.isInteger(c) && c >= 1 && c <= 999 ? c : (i.cantidad === undefined ? 1 : null)
      if (cantidad === null) return { ok: false, motivo: 'argumentos' }
      return { ok: true, nombre: n, args: { product_id: id, cantidad }, ids: [id] }
    }
    case 'comparar_productos': {
      const arr = Array.isArray(i.product_ids) ? i.product_ids.map(uuid) : []
      const ids = [...new Set(arr.filter((x): x is string => !!x))]
      if (ids.length < 2 || ids.length > 4 || ids.length !== arr.length) return { ok: false, motivo: 'argumentos' }
      if (ids.some((id) => !ctx.idsAutorizados.has(id))) return { ok: false, motivo: 'id_no_autorizado' }
      return { ok: true, nombre: n, args: { product_ids: ids }, ids }
    }
    case 'candidatos_comerciales': {
      const categoria = i.categoria === undefined ? null : str(i.categoria, 80); const familia = i.familia === undefined ? null : str(i.familia, 80)
      const terminos = Array.isArray(i.terminos) ? i.terminos.map((t) => str(t, 40)).filter((t): t is string => !!t).slice(0, 5) : []
      if (!categoria && !familia && terminos.length === 0) return { ok: false, motivo: 'argumentos' }
      return { ok: true, nombre: n, args: { categoria, familia, terminos }, ids: [] }
    }
    case 'obtener_estado_pedido': { const folio = i.folio === undefined || i.folio === null ? null : str(i.folio, 40); if (i.folio !== undefined && i.folio !== null && !folio) return { ok: false, motivo: 'argumentos' }; return { ok: true, nombre: n, args: { folio }, ids: [] } }
    case 'solicitar_asesor': return { ok: true, nombre: n, args: { motivo: i.motivo === undefined ? null : str(i.motivo, 120) }, ids: [] }
    case 'ver_carrito': case 'vaciar_carrito': case 'declinar_asesor': case 'preparar_checkout': return { ok: true, nombre: n, args: {}, ids: [] }
    case 'agregar_al_carrito': {
      const id = uuid(i.product_id); if (!id) return { ok: false, motivo: 'argumentos' }
      if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
      const c = Number(i.cantidad ?? 1); const cantidad = Number.isInteger(c) && c >= 1 && c <= 999 ? c : (i.cantidad === undefined ? 1 : null)
      if (cantidad === null) return { ok: false, motivo: 'argumentos' }
      return { ok: true, nombre: n, args: { product_id: id, cantidad }, ids: [id] }
    }
    case 'actualizar_carrito': {
      // El product_id puede venir del carrito leído en este turno (ver_carrito) o de una búsqueda: ambos son retrieval autorizado.
      const id = uuid(i.product_id); if (!id) return { ok: false, motivo: 'argumentos' }
      if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
      const c = Number(i.cantidad); if (!Number.isInteger(c) || c < 0 || c > 999) return { ok: false, motivo: 'argumentos' }
      return { ok: true, nombre: n, args: { product_id: id, cantidad: c }, ids: [id] }
    }
    case 'quitar_del_carrito': {
      const id = uuid(i.product_id); if (!id) return { ok: false, motivo: 'argumentos' }
      if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
      return { ok: true, nombre: n, args: { product_id: id }, ids: [id] }
    }
  }
}

// Claves que nunca viajan al modelo (defensa en profundidad; la base ya no las devuelve).
const PROHIBIDAS = /^(price|precio_base|pvp|cost|costo|unit_cost|margin|margen|stock_|existencia_|qty_|sat_|fiscal|iva|tax|import_hash|odoo_identity|metadata|notas)/i
export function filtrarProhibidas<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => filtrarProhibidas(v)) as unknown as T
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) if (!PROHIBIDAS.test(k)) out[k] = filtrarProhibidas(v)
    return out as T
  }
  return valor
}

/** Acota la salida de una herramienta a texto JSON para el modelo. */
export function acotarSalida(valor: unknown, max = MAX_SALIDA_CHARS): string {
  let s: string
  try { s = JSON.stringify(filtrarProhibidas(valor) ?? null) } catch { s = 'null' }
  return s.length <= max ? s : s.slice(0, max - 20) + '…"truncado":true}'
}

/** Ids de producto presentes en una salida (para autorizar herramientas posteriores). */
export function idsDe(salida: unknown): string[] {
  const ids = new Set<string>()
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visitar); return }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if ((k === 'product_id' || k === 'id') && typeof x === 'string' && UUID_RE.test(x)) ids.add(x.toLowerCase()); else visitar(x) }
  }
  visitar(salida); return [...ids]
}

/** Nombres de producto presentes en una salida (conjunto autorizado del turno para la guarda anti-alucinación). */
export function nombresDe(salida: unknown): string[] {
  const out = new Set<string>()
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visitar); return }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k === 'nombre' && typeof x === 'string' && x.trim()) out.add(x.trim()); else visitar(x) }
  }
  visitar(salida); return [...out]
}

/** Evidencia que aporta la salida de una herramienta (para el grounding de precio/stock/conocimiento). */
export function evidenciaDe(nombre: string, salida: unknown): Evidencia[] {
  const o = (salida && typeof salida === 'object' ? salida : {}) as Record<string, unknown>
  const noVacia = Array.isArray(salida) ? salida.length > 0 : !!salida && (Array.isArray(o.productos) ? o.productos.length > 0 : Object.keys(o).length > 0)
  switch (nombre) {
    case 'obtener_precio': return o.autorizado === true ? ['PRICE_EVIDENCE'] : []
    case 'obtener_disponibilidad': return o.autorizado === true ? ['STOCK_EVIDENCE'] : []
    case 'obtener_estado_pedido': return o.autorizado === true ? ['ORDER_EVIDENCE'] : []
    case 'solicitar_asesor': return o.modo ? (['HUMAN_REQUESTED', 'HANDOFF_EN_CURSO', ...(o.asesor === true ? ['ASESOR_ASIGNADO'] : ['ASESOR_SIN_ASIGNAR'])] as Evidencia[]) : []
    case 'ver_carrito': {
      // La proyección trae precio/disponibilidad calculados por la MISMA autoridad de CC-4 (solo si el lector puede verlos).
      const items = Array.isArray(o.items) ? (o.items as Array<Record<string, unknown>>) : []
      const conPrecio = o.puede_precio === true && items.some((i) => (i.precio as Record<string, unknown> | undefined)?.estado === 'autorizado')
      const conStock = o.puede_precio === true && items.some((i) => ['disponible', 'no_disponible', 'no_vendible'].includes(String(i.disponibilidad)))
      return o.cart_id ? (['CART_READ_EVIDENCE', ...(conPrecio ? ['PRICE_EVIDENCE'] : []), ...(conStock ? ['STOCK_EVIDENCE'] : [])] as Evidencia[]) : []
    }
    case 'agregar_al_carrito': case 'actualizar_carrito': case 'quitar_del_carrito': case 'vaciar_carrito':
      return o.cart_id ? (['CART_MUTATION_EVIDENCE', ...evidenciaDeHandoffMutacion(o.handoff)] as Evidencia[]) : []
    case 'declinar_asesor': return o.rechazado === true ? ['HANDOFF_RECHAZADO'] : []
    case 'preparar_checkout': {
      const proy = (o.proyeccion && typeof o.proyeccion === 'object' ? o.proyeccion : {}) as Record<string, unknown>
      const conPrecio = proy.puede_precio === true && (proy.total as Record<string, unknown> | undefined)?.estado === 'completo'
      return o.cart_id ? (['CHECKOUT_REVIEW_EVIDENCE', ...(conPrecio ? ['PRICE_EVIDENCE', 'STOCK_EVIDENCE'] : [])] as Evidencia[]) : []
    }
    default: return noVacia ? ['KNOWLEDGE_EVIDENCE'] : []
  }
}

/** CC-7 · evidencia del handoff que disparó una mutación de carrito (lo decide el servidor, no el modelo). */
function evidenciaDeHandoffMutacion(h: unknown): Evidencia[] {
  const x = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>
  if (x.estado !== 'solicitado') return []
  const out: Evidencia[] = ['HANDOFF_SOLICITADO', 'HANDOFF_EN_CURSO']
  if (x.horario_configurado === false) out.push('HORARIO_DESCONOCIDO'); else out.push(x.fuera_horario === true ? 'FUERA_DE_HORARIO' : 'EN_HORARIO')
  if (x.asignado === true) out.push('ASESOR_ASIGNADO'); else if (x.ya_en_curso !== true) out.push('ASESOR_SIN_ASIGNAR')
  return out
}

/** CC-7 · evidencia del estado de atención humana al iniciar el turno (cc_ia_estado_handoff, servidor). */
export function evidenciaHandoff(estado: unknown): Evidencia[] {
  const x = (estado && typeof estado === 'object' ? estado : {}) as Record<string, unknown>
  const out: Evidencia[] = []
  if (x.horario_configurado !== true) out.push('HORARIO_DESCONOCIDO'); else out.push(x.en_horario === true ? 'EN_HORARIO' : 'FUERA_DE_HORARIO')
  if (x.modo === 'human_requested' || x.modo === 'human_assigned') out.push('HANDOFF_EN_CURSO', x.asignado === true ? 'ASESOR_ASIGNADO' : 'ASESOR_SIN_ASIGNAR')
  if (x.rechazado_carrito === true) out.push('HANDOFF_RECHAZADO')
  return out
}

/** Mensaje DATA que recibe el modelo cuando una llamada se rechaza (nunca detalles internos). */
export const RECHAZO: Record<string, string> = {
  desconocida: 'Herramienta no disponible.',
  no_autorizada: 'Esta herramienta requiere que el usuario tenga sesión iniciada.',
  argumentos: 'Argumentos inválidos para la herramienta.',
  id_no_autorizado: 'Ese product_id no proviene de una búsqueda de este turno. Usa buscar_productos primero.',
}
