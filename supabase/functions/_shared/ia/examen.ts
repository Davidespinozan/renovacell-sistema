// IA MEJOR QUE EL HUMANO · A (2 nov 2026) · EXAMEN de la IA (puro, sin imports de Deno: todo se inyecta).
// Corre el ORQUESTADOR REAL del portal con un caso: las lecturas van a la base de verdad (funciones STABLE: no pueden
// escribir) y todo lo que escribiría (turno, mensaje, carrito, asesor) se simula en memoria. Así se mide exactamente lo
// que el doctor recibiría, sin tocar conversaciones, turnos ni carritos. Luego un juez califica contra la rúbrica del caso
// viendo la respuesta Y lo que devolvieron las herramientas (los montos se comparan con eso, no con memoria).

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

/** Lecturas que el examen deja pasar a la base (todas STABLE: verificado en prod el 2 nov 2026). */
export const LECTURAS = new Set(['cc_ia_contexto_actor', 'cc_catalogo_para_ia', 'cc_buscar_productos', 'cc_ficha_producto', 'cc_comparar_productos', 'cc_buscar_conocimiento',
  'cc_candidatos_recomendacion', 'cc_ia_precio', 'cc_ia_cotizar', 'cc_ia_recomendaciones', 'cc_ia_disponibilidad', 'cc_ia_estado_pedido', 'cc_ia_perfil_comercial'])

/** Precio por millón de tokens (USD), página oficial de Anthropic consultada el 2 nov 2026. */
// USD por millón de tokens. CACHÉ (docs oficiales, 2 nov 2026): escribir 1.25× la entrada; leer 0.1× (0.05× en Sonnet/Opus 5.5).
export const PRECIOS: Record<string, { entrada: number; salida: number; lectura: number }> = {
  'claude-haiku-4-5-20251001': { entrada: 1, salida: 5, lectura: 0.1 },
  'claude-haiku-5-5': { entrada: 0.10, salida: 0.50, lectura: 0.1 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, lectura: 0.05 },
  'claude-opus-5-5': { entrada: 4, salida: 20, lectura: 0.05 },
}
export const costoUsd = (modelo: string, uso: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number | null => {
  const p = PRECIOS[modelo]; if (!p) return null
  const leido = uso.cacheRead ?? 0, escrito = uso.cacheWrite ?? 0, normal = Math.max(0, uso.input - leido - escrito)
  return Math.round(((normal * p.entrada + escrito * p.entrada * 1.25 + leido * p.entrada * p.lectura + uso.output * p.salida) / 1e6) * 1e6) / 1e6
}

export interface Caso { id: string; categoria: string; historial: Array<{ actor: string; content: string }>; pregunta: string; debe: string[]; no_debe: string[]; ideal?: string | null }
export interface Traza { herramienta: string; args: Record<string, unknown>; salida: unknown }

/** RPC del examen: lecturas reales, escrituras simuladas (carrito en memoria cotizado con la autoridad real). */
export function rpcExamen(real: Rpc, perfil: string) {
  const traza: Traza[] = []
  const capturado = { respuesta: null as string | null, motivo: null as string | null, falla: null as string | null }
  const lineas = new Map<string, number>()
  const CART = 'examen-carrito'
  const carrito = async () => {
    const ls = [...lineas.entries()].map(([product_id, cantidad]) => ({ product_id, cantidad }))
    const cot = ls.length ? (await real('cc_ia_cotizar', { p_profile: perfil, p_lineas: ls })).data as Record<string, unknown> | null : null
    const items = ls.map((l) => ({ ...l, precio: { estado: cot ? 'autorizado' : 'sin_precio' }, disponibilidad: 'disponible' }))
    return { cart_id: CART, items, puede_precio: !!cot, cotizacion: cot }
  }
  const rpc: Rpc = async (fn, args) => {
    if (LECTURAS.has(fn)) {
      const r = await real(fn, args)
      if (fn !== 'cc_ia_contexto_actor' && fn !== 'cc_catalogo_para_ia') traza.push({ herramienta: fn, args, salida: r.error ? { error: r.error.message ?? 'error' } : r.data })
      return r
    }
    switch (fn) {
      case 'cc_ia_turno_reclamar': return { data: { estado: 'reclamado', turn_id: 'examen-turno' }, error: null }
      case 'cc_ia_turno_responder': capturado.respuesta = String(args.p_content ?? ''); return { data: { persistido: true }, error: null }
      case 'cc_ia_turno_fallar': capturado.falla = String(args.p_error_class ?? 'fallo'); return { data: null, error: null }
      case 'cc_ia_herramienta_registrar': {
        const d = args.p_detalle as Record<string, unknown> | null
        if (args.p_tool === 'validacion_salida' && d?.motivo) capturado.motivo = String(d.motivo)
        return { data: null, error: null }
      }
      case 'cc_ia_aviso_no_disponible': return { data: null, error: null }
      case 'cc_ia_estado_handoff': return { data: { modo: 'ai_active', horario_configurado: true, en_horario: true }, error: null }   // el examen se mide en horario
      case 'cc_carrito_abrir': return { data: { cart_id: CART }, error: null }
      case 'cc_carrito_ver': case 'cc_carrito_preparar_checkout': {
        const c = await carrito()
        const salida = fn === 'cc_carrito_ver' ? c : { cart_id: CART, proyeccion: { puede_precio: c.puede_precio, items: c.items, total: { estado: c.cotizacion ? 'completo' : 'incompleto', ...(c.cotizacion ?? {}) } }, problemas: [] }
        traza.push({ herramienta: fn, args, salida }); return { data: salida, error: null }
      }
      case 'cc_carrito_agregar': case 'cc_carrito_actualizar': {
        const id = String(args.p_product); const q = Number(args.p_qty) || 1
        lineas.set(id, fn === 'cc_carrito_agregar' ? (lineas.get(id) ?? 0) + q : q)
        const c = await carrito(); traza.push({ herramienta: fn, args, salida: c }); return { data: { ...c, ok: true }, error: null }
      }
      case 'cc_carrito_quitar': lineas.delete(String(args.p_product)); return { data: { ...(await carrito()), ok: true }, error: null }
      case 'cc_carrito_vaciar': lineas.clear(); return { data: { ...(await carrito()), ok: true }, error: null }
      case 'cc_solicitar_asesor': traza.push({ herramienta: fn, args, salida: { modo: 'handoff_solicitado' } }); return { data: { modo: 'handoff_solicitado', asesor: false, idempotente: false }, error: null }
      case 'cc_handoff_rechazar': return { data: { rechazado: true }, error: null }
      case 'cc_ia_registrar_contacto': return { data: { registrado: true }, error: null }
      case '_cc_canal_transferir': return { data: true, error: null }
      default: return { data: null, error: { message: 'examen: ' + fn + ' no disponible' } }
    }
  }
  return { rpc, traza, capturado }
}

/** El historial del caso + la pregunta, como lo leería el orquestador de la base. */
export function mensajesDelCaso(c: Caso): Array<{ actor: string; content: string }> {
  return [...(c.historial ?? []).map((m) => ({ actor: m.actor === 'ai' ? 'ai' : 'doctor', content: m.content })), { actor: 'doctor', content: c.pregunta }]
}

export const SISTEMA_JUEZ = [
  'Eres el evaluador más exigente de asesores comerciales de Renovacell (distribuidor de medicina estética en Culiacán que vende solo a médicos verificados).',
  'Calificas UNA respuesta de su asesora de IA a un médico, contra la rúbrica del caso y contra lo que el mejor asesor humano respondería.',
  'Tienes las salidas reales de las herramientas que la IA consultó y los DATOS DEL NEGOCIO que la IA recibe en cada turno (entrega, horario, manual de ventas aprobado, promociones vigentes): todo monto, escalón, dato técnico, clínico o del negocio debe coincidir con ellos; un dato que no esté en ninguno de los dos es inventado.',
  'Criterios: (1) exactitud y apego a lo que devolvieron las herramientas; (2) cumple cada punto de "debe" y ninguno de "no_debe"; (3) calidad de venta: resuelve lo que preguntó, propone el siguiente paso, una sugerencia útil como mucho, sin presionar; (4) tono: cálido, breve, español de México natural.',
  'Puntaje de 0 a 10 (10 = mejor que el mejor asesor humano). Aprobado si puntaje ≥ 7 y no viola ningún "no_debe". Una cifra inventada o un dato clínico fuera de la ficha = máximo 3.',
  'Responde SOLO un objeto JSON, sin texto alrededor: {"puntaje": número, "aprobado": booleano, "cumple": [..], "falla": [..], "comentario": "una o dos frases"}.',
].join('\n')

export function mensajeJuez(c: Caso, respuesta: string, traza: Traza[], negocio = ''): string {
  const corta = (v: unknown) => { const s = JSON.stringify(v); return s.length > 6000 ? s.slice(0, 6000) + '…' : s }
  return [
    `CASO ${c.id} (${c.categoria})`,
    c.historial?.length ? 'HISTORIAL:\n' + c.historial.map((m) => `${m.actor === 'ai' ? 'IA' : 'Médico'}: ${m.content}`).join('\n') : '',
    `PREGUNTA DEL MÉDICO: ${c.pregunta}`,
    `DEBE: ${JSON.stringify(c.debe)}`, `NO DEBE: ${JSON.stringify(c.no_debe)}`, c.ideal ? `RESPUESTA IDEAL (referencia, los [..] los llena la herramienta): ${c.ideal}` : '',
    negocio ? 'DATOS DEL NEGOCIO QUE LA IA RECIBE:\n' + negocio.slice(0, 8000) : '',
    'HERRAMIENTAS CONSULTADAS (salida real):\n' + (traza.length ? traza.map((t) => `- ${t.herramienta} ${JSON.stringify(t.args)} → ${corta(t.salida)}`).join('\n') : '(ninguna)'),
    `RESPUESTA DE LA IA:\n${respuesta || '(sin respuesta)'}`,
  ].filter(Boolean).join('\n\n')
}

export interface Juicio { puntaje: number; aprobado: boolean; cumple: string[]; falla: string[]; comentario: string }
export function parsearJuicio(texto: string): Juicio | null {
  const m = (texto ?? '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>
    const puntaje = Math.max(0, Math.min(10, Number(o.puntaje)))
    if (!Number.isFinite(puntaje)) return null
    const lista = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 12) : [])
    return { puntaje: Math.round(puntaje * 10) / 10, aprobado: o.aprobado === true && puntaje >= 7, cumple: lista(o.cumple), falla: lista(o.falla), comentario: String(o.comentario ?? '').slice(0, 600) }
  } catch { return null }
}

/** El examen guarda POR QUÉ falló el proveedor (estado HTTP y tipo de error de la API; sin llaves ni contenido). */
export function capturarErrores(f: typeof fetch): { fetch: typeof fetch; ultimo: () => string | null } {
  let ultimo: string | null = null
  const envuelto = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const r = await f(url, init)
    if (!r.ok) {
      const cuerpo = await r.clone().json().catch(() => null) as { error?: { type?: string; message?: string } } | null
      ultimo = `${r.status} ${cuerpo?.error?.type ?? ''}: ${String(cuerpo?.error?.message ?? '').slice(0, 180)}`.trim()
    }
    return r
  }) as typeof fetch
  return { fetch: envuelto, ultimo: () => ultimo }
}
/** ¿Vale la pena reintentar? Saturación, límite o caída sí; una petición inválida o un modelo sin acceso no. */
export const reintentable = (detalle: string | null): boolean => !detalle || /^(429|5\d\d)\b/.test(detalle)
