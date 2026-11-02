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
  | 'enlace_portal'   // LIVE C1 · URL pública oficial del portal (sin tokens ni datos): la ofrece a audiencias públicas y canales
  | 'registrar_contacto'   // CONTACTO CONVERSACIONAL · solo el visitante del enlace que aún no deja sus datos
  | 'cotizar' | 'recomendar_productos'   // IA-VENDEDORA · combinaciones con las reglas del pedido y recomendaciones con motivo
  | 'solicitar_verificacion'   // VERIFICACIÓN POR WHATSAPP (2 nov 2026) · un contacto aún no reconocido pide verificarse para comprar
  | 'guardar_direccion' | 'revisar_pedido' | 'confirmar_pedido'   // PEDIDO POR WHATSAPP (2 nov 2026) · solo con el doctor vinculado
export type Evidencia = 'PRICE_EVIDENCE' | 'STOCK_EVIDENCE' | 'KNOWLEDGE_EVIDENCE' | 'CLINICAL_EVIDENCE' | 'PEDIDO_CREADO_EVIDENCE' | 'ORDER_EVIDENCE' | 'HUMAN_REQUESTED' | 'CART_READ_EVIDENCE' | 'CART_MUTATION_EVIDENCE' | 'CHECKOUT_REVIEW_EVIDENCE' | 'PORTAL_LINK_EVIDENCE'
  // CC-7 · estado de la atención humana derivado del SERVIDOR (horario, ruteo, rechazo); el modelo no lo infiere
  | 'HANDOFF_SOLICITADO' | 'HANDOFF_EN_CURSO' | 'ASESOR_ASIGNADO' | 'ASESOR_SIN_ASIGNAR' | 'EN_HORARIO' | 'FUERA_DE_HORARIO' | 'HORARIO_DESCONOCIDO' | 'HANDOFF_RECHAZADO'
export interface DefinicionHerramienta { name: NombreHerramienta; description: string; input_schema: Record<string, unknown>; autoridad: 'cualquiera' | 'cuenta'; mutante: boolean }

// LIVE C1 · CANAL por el que habla el usuario. Solo 'portal' tiene sesión del portal; en los canales de Meta la IA
// opera SIEMPRE con audiencia pública (aunque el número/PSID coincida con un doctor) y sin herramientas de cuenta ni carrito.
export type CanalIA = 'portal' | 'whatsapp' | 'instagram' | 'messenger'
export const CANALES_IA: readonly CanalIA[] = ['portal', 'whatsapp', 'instagram', 'messenger']
/** Herramientas que SOLO existen con sesión en el portal (carrito, checkout, pedidos): nunca desde un canal de Meta. */
export const SOLO_PORTAL: readonly NombreHerramienta[] = ['ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito', 'preparar_checkout', 'obtener_estado_pedido']
/** URL pública y oficial del portal (misma que invitacion.ts URL_SISTEMA). Sin tokens, sin rutas privadas, sin datos del usuario. */
export const URL_PORTAL_PUBLICA = 'https://sistema.renovacell.mx'
export function ejecutarEnlacePortal(): { url: string; uso: string } {
  return { url: URL_PORTAL_PUBLICA, uso: 'Registro o acceso al portal de Renovacell. Ahí se verifica la cuenta del profesional; precios, disponibilidad, carrito y pedidos solo existen dentro del portal con sesión.' }
}
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
  // IA-VENDEDORA · la IA cotiza combinaciones con las reglas del pedido (lo que se cobraría) y recomienda con motivo.
  { name: 'cotizar', autoridad: 'cualquiera', mutante: false, description: 'Cotiza varios productos juntos con las reglas de precio del pedido (juntar piezas para medio mayoreo, todo a mayoreo si uno llega a mayoreo, promociones). Devuelve precio por línea, nivel aplicado, total, ahorro y OPORTUNIDADES (cuántas piezas faltan para el siguiente nivel y cuánto ahorraría). Úsala para "¿cuánto me queda si llevo…?", combinaciones y para proponer cómo ahorrar. Nunca calcules tú.',
    input_schema: { type: 'object', properties: { lineas: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { product_id: texto('product_id autorizado', 36), cantidad: { type: 'integer', minimum: 1, maximum: 999 } }, required: ['product_id', 'cantidad'], additionalProperties: false } } }, required: ['lineas'], additionalProperties: false } },
  { name: 'recomendar_productos', autoridad: 'cualquiera', mutante: false, description: 'Recomendaciones con motivo para este cliente: complementos curados por Renovacell, lo que otros compran junto, lo que usa su especialidad, recompra de lo que ya compró y similares del producto del que hablan. Excluye lo que ya lleva en su carrito. Solo puedes recomendar lo que regrese aquí o en candidatos_comerciales.',
    input_schema: { type: 'object', properties: { product_id: texto('product_id del producto del que hablan (opcional)', 36) }, additionalProperties: false } },
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
  { name: 'enlace_portal', autoridad: 'cualquiera', mutante: false, description: 'Enlace público oficial para registrarse o entrar al portal de Renovacell. Úsalo cuando el usuario quiera ver precios, comprar, consultar pedidos, usar un carrito o verificar su cuenta y no tenga sesión en el portal. No lleva datos del usuario.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'preparar_checkout', autoridad: 'cualquiera', mutante: false, description: 'Revisa si el carrito está listo para convertirse en pedido: total actual (si está autorizado), disponibilidad y problemas (cuenta, verificación, dirección). No crea el pedido: el usuario lo confirma con el botón "Confirmar pedido" de su carrito.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
]
export const NOMBRES = new Set<string>(HERRAMIENTAS.map((h) => h.name))

// CONTACTO CONVERSACIONAL · sin formulario: la IA pide nombre, celular y correo platicando y los registra con esta
// herramienta. Solo existe para el visitante del portal (enlace del chat) que aún no los deja; la base valida igual que el
// formulario y un dato inválido regresa como `campo` para pedirlo de nuevo.
export const REGISTRAR_CONTACTO: DefinicionHerramienta = { name: 'registrar_contacto', autoridad: 'cualquiera', mutante: true,
  description: 'Guarda los datos de contacto que la persona te dio en ESTA conversación (nombre completo, celular a 10 dígitos y correo) para que su asesor la atienda. Úsala en cuanto tengas los tres, con lo que ella escribió (no inventes ni completes). Si responde registrado:false, pide de nuevo solo el dato indicado en `campo`.',
  input_schema: { type: 'object', properties: {
    nombre: texto('Nombre completo como lo escribió (nombre y apellido).', 120), telefono: texto('Celular como lo escribió.', 30), email: texto('Correo como lo escribió.', 160),
    es_medico: { type: 'boolean', description: 'true solo si dijo ser profesional de la salud.' }, cedula: texto('Cédula profesional, solo si la dio.', 40),
  }, required: ['nombre', 'telefono', 'email'], additionalProperties: false } }

// VERIFICACIÓN POR WHATSAPP (2 nov 2026, dueño: la IA atiende de punta a punta; precios solo a verificados). La IA junta
// los datos en el chat; el personal verifica y aprueba (la verificación sigue siendo manual).
export const SOLICITAR_VERIFICACION: DefinicionHerramienta = { name: 'solicitar_verificacion', autoridad: 'cualquiera', mutante: true,
  description: 'Registra la solicitud de verificación de un profesional que escribe por este canal y aún no está reconocido, para que el equipo la apruebe y puedas darle sus precios y venderle aquí mismo. Úsala cuando tengas su nombre completo, su número de cédula profesional y su correo (pídele también una foto de su cédula profesional; si ya la mandó, se adjunta sola). Si responde registrada:false, pide de nuevo solo el dato de `campo` (nombre: nombre y apellido; cedula: 7 u 8 dígitos; email: correo válido).',
  input_schema: { type: 'object', properties: {
    nombre: texto('Nombre completo como lo escribió.', 120), cedula: texto('Número de cédula profesional como lo escribió.', 40), email: texto('Correo como lo escribió.', 160),
    especialidad: texto('Especialidad o tipo de práctica, si la dijo.', 80), ciudad: texto('Ciudad, si la dijo.', 80),
  }, required: ['nombre', 'cedula', 'email'], additionalProperties: false } }

/** Herramientas expuestas al modelo según el actor (los pedidos solo con cuenta). */
// IA MEJOR QUE EL HUMANO · E + PEDIDO POR WHATSAPP · con el doctor vinculado, su carrito (el mismo del portal) y sus pedidos
// también se manejan aquí; el cierre va por revisar_pedido / confirmar_pedido (no por el botón del portal).
const SOLO_PORTAL_SIN_VINCULO: readonly NombreHerramienta[] = ['obtener_estado_pedido', 'ver_carrito', 'agregar_al_carrito', 'actualizar_carrito', 'quitar_del_carrito', 'vaciar_carrito']
const DIRECCION = { type: 'object', properties: {
  calle: texto('Calle.', 200), numero: texto('Número exterior.', 20), interior: texto('Número interior, si hay.', 20), colonia: texto('Colonia.', 120),
  cp: texto('Código postal (5 dígitos).', 10), ciudad: texto('Ciudad.', 120), estado: texto('Estado.', 120), referencias: texto('Referencias para encontrarlo, si las dio.', 300),
  recibe: texto('Quién recibe, si lo dijo.', 120), telefono: texto('Teléfono de quien recibe, si lo dio.', 20),
}, required: ['calle', 'numero', 'cp', 'ciudad', 'estado'], additionalProperties: false }
export const HERRAMIENTAS_PEDIDO_WA: DefinicionHerramienta[] = [
  { name: 'guardar_direccion', autoridad: 'cuenta', mutante: true, description: 'Guarda en su perfil la dirección de entrega que el doctor te dictó en ESTE chat (queda como su dirección predeterminada). Úsala solo con lo que él escribió; si regresa guardada:false, pide de nuevo solo el dato de `campo`.', input_schema: DIRECCION },
  { name: 'revisar_pedido', autoridad: 'cuenta', mutante: false, description: 'Revisa su carrito para cerrar el pedido, con la misma regla del portal: precio y total, disponibilidad, opciones de entrega con flete y fecha prometida (y horarios si es entrega local), y lo que falte. Llámala sin `entrega` para ver las opciones; luego con la opción que él eligió (id: recoge, local_chofer, foraneo_dhl…) y, si es local, el horario {fecha, inicio}.', input_schema: { type: 'object', properties: { entrega: texto('Id de la opción de entrega elegida.', 30), horario: { type: 'object', properties: { fecha: texto('AAAA-MM-DD', 10), inicio: texto('HH:MM', 5) }, required: ['fecha', 'inicio'], additionalProperties: false } }, additionalProperties: false } },
  { name: 'confirmar_pedido', autoridad: 'cuenta', mutante: true, description: 'Confirma el pedido de la última revisión (lista y vigente). SOLO después de que el doctor, en su último mensaje, confirmó con un sí claro el resumen que le diste (productos, total con envío y entrega). Regresa folio, total y datos de pago.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
]
const soloPortal = (n: NombreHerramienta, identificado: boolean) => SOLO_PORTAL.includes(n) && !(identificado && SOLO_PORTAL_SIN_VINCULO.includes(n))
export function herramientasPara(conCuenta: boolean, canal: CanalIA = 'portal', contactoPendiente = false, identificado = false): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return [...HERRAMIENTAS, ...(contactoPendiente && !conCuenta && canal === 'portal' ? [REGISTRAR_CONTACTO] : []), ...(canal !== 'portal' && !identificado && !conCuenta ? [SOLICITAR_VERIFICACION] : []), ...(canal === 'whatsapp' && identificado ? HERRAMIENTAS_PEDIDO_WA : [])]
    .filter((h) => h.autoridad === 'cualquiera' || conCuenta)
    .filter((h) => canal === 'portal' || !soloPortal(h.name, identificado))          // LIVE C1 · sin carrito/checkout/pedidos fuera del portal (pedidos sí con vínculo)
    .filter((h) => h.name !== 'enlace_portal' || !conCuenta || canal !== 'portal')   // el enlace solo tiene sentido sin sesión en el portal
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }))
}

export type Validada = { ok: true; nombre: NombreHerramienta; args: Record<string, unknown>; ids: string[] } | { ok: false; motivo: 'desconocida' | 'no_autorizada' | 'argumentos' | 'id_no_autorizado' }

const str = (v: unknown, max: number): string | null => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null
const uuid = (v: unknown): string | null => typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null

/** Valida nombre, forma y AUTORIDAD de una llamada del modelo. Los product_id deben venir de retrieval autorizado en este turno. */
export function validarLlamada(nombre: unknown, input: unknown, ctx: { conCuenta: boolean; idsAutorizados: Set<string>; canal?: CanalIA; contactoPendiente?: boolean; identificado?: boolean }): Validada {
  if (nombre === 'registrar_contacto') {
    if (!ctx.contactoPendiente || ctx.conCuenta || (ctx.canal ?? 'portal') !== 'portal') return { ok: false, motivo: 'no_autorizada' }
    const i = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
    const nom = str(i.nombre, 120); const tel = str(i.telefono, 30); const email = str(i.email, 160)
    if (!nom || !tel || !email || (i.es_medico !== undefined && typeof i.es_medico !== 'boolean')) return { ok: false, motivo: 'argumentos' }
    const cedula = i.cedula === undefined || i.cedula === null || i.cedula === '' ? null : str(i.cedula, 40)
    return { ok: true, nombre: 'registrar_contacto', args: { nombre: nom, telefono: tel, email, es_medico: i.es_medico === true, cedula }, ids: [] }
  }
  if (nombre === 'solicitar_verificacion') {
    if ((ctx.canal ?? 'portal') === 'portal' || ctx.identificado || ctx.conCuenta) return { ok: false, motivo: 'no_autorizada' }
    const i = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
    const nom = str(i.nombre, 120); const ced = str(i.cedula, 40); const email = str(i.email, 160)
    if (!nom || !ced || !email) return { ok: false, motivo: 'argumentos' }
    return { ok: true, nombre: 'solicitar_verificacion', args: { nombre: nom, cedula: ced, email, especialidad: str(i.especialidad, 80), ciudad: str(i.ciudad, 80) }, ids: [] }
  }
  if (nombre === 'guardar_direccion' || nombre === 'revisar_pedido' || nombre === 'confirmar_pedido') {
    if (ctx.canal !== 'whatsapp' || !ctx.identificado) return { ok: false, motivo: 'no_autorizada' }
    const i = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
    if (nombre === 'confirmar_pedido') return { ok: true, nombre, args: {}, ids: [] }
    if (nombre === 'revisar_pedido') {
      const ent = i.entrega === undefined || i.entrega === null ? null : (typeof i.entrega === 'string' && /^[a-z_]{3,30}$/.test(i.entrega) ? i.entrega : undefined)
      if (ent === undefined) return { ok: false, motivo: 'argumentos' }
      const h = i.horario as { fecha?: unknown; inicio?: unknown } | undefined
      const horario = h && typeof h.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h.fecha) && typeof h.inicio === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.inicio) ? { fecha: h.fecha, inicio: h.inicio } : null
      return { ok: true, nombre, args: { entrega: ent, horario }, ids: [] }
    }
    const d: Record<string, string> = {}
    for (const [k, max] of [['calle', 200], ['numero', 20], ['interior', 20], ['colonia', 120], ['cp', 10], ['ciudad', 120], ['estado', 120], ['referencias', 300], ['recibe', 120], ['telefono', 20]] as const) { const v = str(i[k], max); if (v) d[k] = v }
    if (!d.calle || !d.numero || !d.cp || !d.ciudad || !d.estado) return { ok: false, motivo: 'argumentos' }
    return { ok: true, nombre, args: d, ids: [] }
  }
  if (typeof nombre !== 'string' || !NOMBRES.has(nombre)) return { ok: false, motivo: 'desconocida' }
  const def = HERRAMIENTAS.find((h) => h.name === nombre)!
  if (def.autoridad === 'cuenta' && !ctx.conCuenta) return { ok: false, motivo: 'no_autorizada' }
  if ((ctx.canal ?? 'portal') !== 'portal' && soloPortal(def.name, !!ctx.identificado)) return { ok: false, motivo: 'no_autorizada' }   // LIVE C1 · defensa aunque el modelo la pida
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
    case 'cotizar': {
      const arr = Array.isArray(i.lineas) ? i.lineas : []
      if (arr.length < 1 || arr.length > 20) return { ok: false, motivo: 'argumentos' }
      const lineas: Array<{ product_id: string; cantidad: number }> = []
      for (const l of arr) {
        const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
        const id = uuid(x.product_id); const c = Number(x.cantidad)
        if (!id || !Number.isInteger(c) || c < 1 || c > 999) return { ok: false, motivo: 'argumentos' }
        if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
        lineas.push({ product_id: id, cantidad: c })
      }
      return { ok: true, nombre: n, args: { lineas }, ids: [...new Set(lineas.map((l) => l.product_id))] }
    }
    case 'recomendar_productos': {
      if (i.product_id === undefined || i.product_id === null || i.product_id === '') return { ok: true, nombre: n, args: { product_id: null }, ids: [] }
      const id = uuid(i.product_id); if (!id) return { ok: false, motivo: 'argumentos' }
      if (!ctx.idsAutorizados.has(id)) return { ok: false, motivo: 'id_no_autorizado' }
      return { ok: true, nombre: n, args: { product_id: id }, ids: [id] }
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
    case 'ver_carrito': case 'vaciar_carrito': case 'declinar_asesor': case 'preparar_checkout': case 'enlace_portal': return { ok: true, nombre: n, args: {}, ids: [] }
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
// IA-CLÍNICA · una ficha completa (general, técnica y clínica, con sus fuentes) mide hasta ~9k: con el tope general se
// cortaban secciones enteras. La ficha y la comparación tienen su propio tope; lo demás sigue igual.
export const MAX_SALIDA_FICHA = 20_000
export const limiteSalida = (nombre: string): number => (nombre === 'obtener_ficha_producto' || nombre === 'comparar_productos' ? MAX_SALIDA_FICHA : MAX_SALIDA_CHARS)
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
    case 'obtener_precio': case 'cotizar': return o.autorizado === true ? ['PRICE_EVIDENCE'] : []
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
    case 'enlace_portal': return o.url === URL_PORTAL_PUBLICA ? ['PORTAL_LINK_EVIDENCE'] : []
    case 'registrar_contacto': case 'solicitar_verificacion': case 'guardar_direccion': return []   // datos: no son evidencia comercial
    // PEDIDO POR WHATSAPP · la revisión trae total del servidor; la confirmación, el pedido creado (solo entonces puede decirlo)
    case 'revisar_pedido': return o.review_id || o.total ? (['CHECKOUT_REVIEW_EVIDENCE', 'PRICE_EVIDENCE'] as Evidencia[]) : []
    case 'confirmar_pedido': return o.confirmado === true ? (['PEDIDO_CREADO_EVIDENCE', 'PRICE_EVIDENCE', 'ORDER_EVIDENCE'] as Evidencia[]) : []
    case 'preparar_checkout': {
      const proy = (o.proyeccion && typeof o.proyeccion === 'object' ? o.proyeccion : {}) as Record<string, unknown>
      const conPrecio = proy.puede_precio === true && (proy.total as Record<string, unknown> | undefined)?.estado === 'completo'
      return o.cart_id ? (['CHECKOUT_REVIEW_EVIDENCE', ...(conPrecio ? ['PRICE_EVIDENCE', 'STOCK_EVIDENCE'] : [])] as Evidencia[]) : []
    }
    // IA-CLÍNICA · una sección T2 aprobada en la salida (la base solo la entrega a quien puede verla) sostiene cifras clínicas
    default: return noVacia ? (['KNOWLEDGE_EVIDENCE', ...(JSON.stringify(salida).includes('"nivel":"T2"') ? ['CLINICAL_EVIDENCE'] : [])] as Evidencia[]) : []
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
  no_autorizada: 'Esta herramienta requiere que el usuario tenga sesión iniciada en el portal. Si no la tiene, ofrece el enlace oficial con enlace_portal.',
  argumentos: 'Argumentos inválidos para la herramienta.',
  id_no_autorizado: 'Ese product_id no proviene de una búsqueda de este turno. Usa buscar_productos primero.',
}
