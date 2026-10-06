// CC-4 · VALIDACIÓN DE SALIDA (puro, sin imports). La autoridad por construcción es la defensa
// primaria (el modelo solo recibe evidencia autorizada); esto es la segunda capa: no persistir una
// respuesta vacía, desbordada, con sintaxis de herramientas filtrada, con afirmaciones de precio o
// existencias sin evidencia, con nombres de catálogo fuera del conjunto autorizado del turno, ni
// con lenguaje clínico individualizado.

export type MotivoRechazo = 'vacia' | 'larga' | 'fuga_herramientas' | 'fuga_sistema' | 'precio_sin_evidencia' | 'stock_sin_evidencia' | 'producto_no_autorizado' | 'clinico' | 'carrito_mutacion_sin_evidencia' | 'carrito_lectura_sin_evidencia' | 'pedido_sin_evidencia' | 'promesa_humano_sin_evidencia'
export interface ContextoValidacion { evidencia: readonly string[]; nombresAutorizados: readonly string[]; nombresCatalogo: readonly string[]; limiteClinico: boolean }
export type Validacion = { ok: true; texto: string } | { ok: false; motivo: MotivoRechazo; detalle?: string }

export const MAX_RESPUESTA = 2500
const RE_PRECIO = /(\$\s?\d[\d,]*(\.\d+)?)|(\b\d[\d,]*(\.\d+)?\s?(mxn|pesos|usd|d[oó]lares)\b)|(\bcuesta[n]?\s+\d)|(\bprecio (es|de|sería|seria) (de )?\$?\d)/i
const RE_STOCK = /\b(hay|tenemos|contamos con|queda[n]?|disponemos de)\b[^.!?]{0,40}\b(existencia|existencias|stock|inventario|piezas|unidades|en almac[eé]n)\b|\bagotad[oa]s?\b|\bsin (existencia|existencias|stock)\b|\ben (existencia|stock|inventario)\b|\bs[ií] (hay|tenemos) disponib|\best[aá] disponible (ahora|de inmediato|para env[ií]o)|\bno (hay|tenemos) disponib/i
const RE_HERRAMIENTAS = /tool_use|tool_result|"input_schema"|<\/?tool|<<<DATOS|DATOS>>>|\bfunction_call\b|\binput_schema\b/i
const RE_SISTEMA = /REGLAS NO NEGOCIABLES|POLITICA_SISTEMA|system prompt|mis instrucciones (son|dicen)|instrucciones del sistema/i
// CC-5 · afirmaciones de carrito: "ya lo agregué/quité/cambié/vacié" exige CART_MUTATION_EVIDENCE; "tu carrito tiene/llevas en el carrito" exige CART_READ_EVIDENCE (o mutación, que también devuelve estado).
// (sin `\b` tras vocales acentuadas: en JS `\b` es ASCII y no reconoce frontera después de é/í)
const RE_CART_MUT = /\b(ya (lo |la |los |las |te )?(agregu[eé]|a[ñn]ad[ií]|quit[eé]|elimin[eé]|cambi[eé]|actualic[eé]|vaci[eé]))(?=\W|$)|\b(agregado|a[ñn]adido|quitado|eliminado|actualizado|vaciado)\b[^.!?]{0,20}\bcarrito\b|\bcarrito\b[^.!?]{0,20}\b(agregado|a[ñn]adido|quitado|actualizado|vaciado|queda vac[ií]o)(?=\W|$)|\b(agregu[eé]|quit[eé]|vaci[eé])(?=\W|$)[^.!?]{0,30}\bcarrito\b/i
const RE_CART_READ = /\b(tu carrito (tiene|lleva|contiene|incluye|est[aá] vac[ií]o)|en tu carrito (hay|tienes|llevas)|llevas en (el|tu) carrito|tienes en (el|tu) carrito)\b/i
// CC-6 · la IA NUNCA crea pedidos: cualquier afirmación de pedido creado/confirmado/registrado se bloquea (no existe ORDER_CREATED_EVIDENCE para la IA).
const RE_PEDIDO_CREADO = /\b(pedido|orden|compra)\b[^.!?]{0,30}\b(creado|creada|confirmado|confirmada|registrado|registrada|levantado|levantada|generado|generada|listo|lista|hecho|hecha|realizado|realizada)\b|\b(ya (hice|cre[eé]|confirm[eé]|registr[eé]|levant[eé]|gener[eé])|acabo de (crear|confirmar|registrar|levantar))\b[^.!?]{0,20}\b(pedido|orden|compra)\b|\btu pedido (qued[oó]|est[aá]) (listo|registrado|confirmado|creado)\b/i
// CC-7 · promesas de atención humana INMEDIATA ("ya viene", "en un momento te atiende"): solo con evidencia del servidor
// de que hay horario de atención Y un asesor asignado. Fuera de horario o sin horario configurado nunca se permiten.
const RE_PROMESA_HUMANO = /\b(ahorita|ahora mismo|en (un )?momento|en breve|enseguida|de inmediato|inmediatamente|en unos minutos|en minutos)\b[^.!?]{0,50}\b(asesor|asesora|vendedor|vendedora|ejecutivo|ejecutiva|humano|alguien del equipo)\b|\b(asesor|asesora|vendedor|vendedora|ejecutivo|ejecutiva|alguien del equipo)\b[^.!?]{0,40}(\bya (viene|va en camino|est[aá] (aqu[ií]|conectad[oa]|en l[ií]nea|escribiendo))|\best[aá] (en camino|por (unirse|escribirte|responderte|contactarte))|\bte (atiende|atender[aá]|escribe|escribir[aá]|contacta|contactar[aá]|responde|responder[aá]) (ya|ahora|ahorita|en breve|enseguida|de inmediato|en un momento|en unos minutos))/i
const RE_CLINICO = /\b(apl[ií]ca(le|r)|iny[eé]cta(le|r)|adm[ií]nistra(le|r)|usa(r)? en (tu|el|la) paciente|col[oó]ca(le|r))\b[^.!?]{0,60}\b(\d+\s?(ml|mililitros|mg|unidades|u\b|jeringas?|viales?|sesiones?))|\b(\d+\s?(ml|mg|unidades|u\b))\b[^.!?]{0,40}\b(por (sesi[oó]n|zona|paciente|aplicaci[oó]n)|cada \d+\s?(semanas?|d[ií]as?|meses?))|\bdosis (recomendada|sugerida|habitual|es)\b|\bprotocolo (es|ser[ií]a|recomendado):/i

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export function validarRespuesta(texto: unknown, ctx: ContextoValidacion): Validacion {
  if (typeof texto !== 'string') return { ok: false, motivo: 'vacia' }
  const t = texto.replace(/\r\n?/g, '\n').trim()
  if (!t) return { ok: false, motivo: 'vacia' }
  if (t.length > MAX_RESPUESTA) return { ok: false, motivo: 'larga' }
  if (RE_HERRAMIENTAS.test(t)) return { ok: false, motivo: 'fuga_herramientas' }
  if (RE_SISTEMA.test(t)) return { ok: false, motivo: 'fuga_sistema' }
  if (!ctx.evidencia.includes('PRICE_EVIDENCE') && RE_PRECIO.test(t)) return { ok: false, motivo: 'precio_sin_evidencia' }
  if (!ctx.evidencia.includes('STOCK_EVIDENCE') && RE_STOCK.test(t)) return { ok: false, motivo: 'stock_sin_evidencia' }
  if (ctx.limiteClinico && RE_CLINICO.test(t)) return { ok: false, motivo: 'clinico' }
  if (RE_PEDIDO_CREADO.test(t)) return { ok: false, motivo: 'pedido_sin_evidencia' }
  if (!(ctx.evidencia.includes('EN_HORARIO') && ctx.evidencia.includes('ASESOR_ASIGNADO')) && RE_PROMESA_HUMANO.test(t)) return { ok: false, motivo: 'promesa_humano_sin_evidencia' }
  if (!ctx.evidencia.includes('CART_MUTATION_EVIDENCE') && RE_CART_MUT.test(t)) return { ok: false, motivo: 'carrito_mutacion_sin_evidencia' }
  if (!ctx.evidencia.includes('CART_READ_EVIDENCE') && !ctx.evidencia.includes('CART_MUTATION_EVIDENCE') && RE_CART_READ.test(t)) return { ok: false, motivo: 'carrito_lectura_sin_evidencia' }
  // Guarda anti-alucinación determinista: nombres del catálogo visible que NO salieron de una herramienta
  // en este turno no pueden aparecer (match exacto normalizado sobre nombres ≥ 4 caracteres; nunca fuzzy).
  const tn = ' ' + norm(t) + ' '
  const autorizados = new Set(ctx.nombresAutorizados.map(norm))
  for (const n of ctx.nombresCatalogo) {
    const nn = norm(n)
    if (nn.length < 4 || autorizados.has(nn)) continue
    // Un nombre autorizado puede contener a otro ("Hyalux" ⊂ "Hyalux Deep"): no se bloquea si está contenido en uno autorizado.
    if ([...autorizados].some((a) => a.includes(nn))) continue
    if (tn.includes(' ' + nn + ' ') || tn.includes(' ' + nn + ',') || tn.includes(' ' + nn + '.') || tn.includes(' ' + nn + '?') || tn.includes(' ' + nn + '!')) return { ok: false, motivo: 'producto_no_autorizado', detalle: n }
  }
  return { ok: true, texto: t }
}

/** Texto seguro cuando el modelo no produjo una respuesta válida: nunca inventa; usa la evidencia o se limita. */
export function respuestaSegura(motivo: string, ctx: { limiteClinico: boolean; evidencia: readonly string[]; textoLimiteClinico: string; textoGenerico: string }): string {
  if (ctx.limiteClinico || motivo === 'clinico') return ctx.textoLimiteClinico
  if (motivo === 'precio_sin_evidencia') return 'Para darte un precio necesito consultarlo con tu cuenta verificada. ¿Te confirmo el producto exacto y lo reviso?'
  if (motivo === 'stock_sin_evidencia') return 'La disponibilidad la consulto en el sistema para cuentas verificadas; si me confirmas el producto lo reviso.'
  if (motivo === 'producto_no_autorizado') return 'Prefiero no afirmar nada de un producto que no consulté. ¿Me dices el nombre exacto y lo busco en el catálogo?'
  if (motivo === 'carrito_mutacion_sin_evidencia') return 'No pude confirmar el cambio en tu carrito. ¿Me repites qué producto y cuántas piezas quieres?'
  if (motivo === 'pedido_sin_evidencia') return 'Yo no creo pedidos: cuando quieras, confirma el tuyo con el botón "Confirmar pedido" de tu carrito y ahí verás el total actual.'
  if (motivo === 'promesa_humano_sin_evidencia') return 'Tu solicitud de asesor quedó registrada y te avisaremos aquí cuando se una. Mientras tanto, sigo ayudándote con lo que necesites.'
  if (motivo === 'carrito_lectura_sin_evidencia') return 'Déjame revisar tu carrito antes de confirmarte su contenido. ¿Quieres que lo muestre?'
  return ctx.textoGenerico
}
