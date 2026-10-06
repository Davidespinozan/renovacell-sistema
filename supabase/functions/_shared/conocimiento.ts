// CC-3 · Lógica PURA del conocimiento comercial (sin Deno, sin supabase): la costura que CC-4
// (IA de ventas) usará para preguntar a la base y para armar el contexto del modelo.
//
// La AUTORIDAD vive en la base (cc_* + funciones cc_ficha_producto / cc_buscar_* / cc_comparar_* /
// cc_candidatos_recomendacion). Aquí NO se decide permiso alguno: solo se resuelve la audiencia
// que la Edge le pasará a la base (service_role), se formatea lo aprobado para el modelo y se
// filtra, por defensa en profundidad, cualquier campo que jamás debe llegar a un prompt
// (precio, costo, stock, fiscal, metadata cruda, ids internos).

export type Audiencia = 'public' | 'verified' | 'staff'
export type Nivel = 'T0' | 'T1' | 'T2'

export const SECCIONES: Record<string, Nivel> = {
  resumen: 'T0', presentacion: 'T0', diferenciadores: 'T0', caracteristicas: 'T0', uso_comercial: 'T0', faq: 'T0', marca: 'T0', fabricante: 'T0',
  composicion: 'T1', tecnologia: 'T1', certificaciones: 'T1', ficha_tecnica: 'T1', concentracion: 'T1', volumen: 'T1',
  indicaciones: 'T2', contraindicaciones: 'T2', protocolo: 'T2', advertencias: 'T2',
}
export const ETIQUETA_SECCION: Record<string, string> = {
  resumen: 'Resumen', presentacion: 'Presentación', diferenciadores: 'Diferenciadores', caracteristicas: 'Características', uso_comercial: 'Uso comercial', faq: 'Preguntas frecuentes',
  marca: 'Marca', fabricante: 'Fabricante', composicion: 'Composición', tecnologia: 'Tecnología', certificaciones: 'Certificaciones', ficha_tecnica: 'Ficha técnica',
  concentracion: 'Concentración', volumen: 'Volumen', indicaciones: 'Indicaciones', contraindicaciones: 'Contraindicaciones', protocolo: 'Protocolo', advertencias: 'Advertencias',
}
export const nivelDe = (seccion: string): Nivel | null => SECCIONES[seccion] ?? null

/** Espejo de `_cc_audiencia`: la Edge resuelve el JWT (rol + verificado) y la base recibe el resultado. La base manda. */
export function resolverAudiencia(quien: { role: string; verified: boolean } | null): Audiencia {
  if (!quien || !quien.role) return 'public'
  if (quien.role === 'admin') return 'staff'
  if (quien.role === 'doctor') return quien.verified ? 'verified' : 'public'
  return 'verified'   // personal: pos, billing, comm, warehouse, packing, driver
}

// Claves que NUNCA viajan al modelo, vengan de donde vengan (defensa en profundidad; la base ya no las devuelve).
const PROHIBIDAS = /^(price|precio|pvp|cost|costo|unit_cost|margin|margen|stock|existencia|qty|quantity|sat_|fiscal|iva|tax|import_hash|odoo_identity|metadata)/i
export function filtrarCamposProhibidos<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => filtrarCamposProhibidos(v)) as unknown as T
  if (valor && typeof valor === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) if (!PROHIBIDAS.test(k)) out[k] = filtrarCamposProhibidos(v)
    return out as T
  }
  return valor
}

export interface Ficha {
  product_id: string; nombre: string; linea?: string | null; categoria?: string | null; familia?: string | null; presentacion?: string | null; unidad?: string | null
  audiencia: Audiencia; es_familia?: boolean; variante_de?: { product_id: string; nombre: string } | null
  variantes?: { product_id: string; nombre: string; presentacion?: string | null }[]; misma_familia?: { product_id: string; nombre: string }[]
  conocimiento: Record<string, { nivel: Nivel; contenido: string; version: number; fuente?: { tipo: string; referencia: string; documento_url?: string | null; version?: string | null } | null }>
  relaciones?: { tipo: string; product_id: string; nombre: string }[]; disclaimers?: string[]; niveles_disponibles?: Nivel[]
}

/** Texto compacto y citable para el prompt de la IA. Solo lo aprobado y visible para la audiencia ya resuelta. */
export function fichaParaIA(entrada: Ficha | null): string {
  if (!entrada) return ''
  const f = filtrarCamposProhibidos(entrada)
  const lineas: string[] = []
  lineas.push(`PRODUCTO: ${f.nombre}${f.familia ? ` · familia ${f.familia}` : ''}${f.categoria ? ` · ${f.categoria}` : ''}`)
  if (f.presentacion) lineas.push(`Presentación: ${f.presentacion}${f.unidad ? ` (${f.unidad})` : ''}`)
  if (f.variante_de) lineas.push(`Variante de: ${f.variante_de.nombre}`)
  if (f.variantes?.length) lineas.push(`Variantes: ${f.variantes.map((v) => v.nombre + (v.presentacion ? ` [${v.presentacion}]` : '')).join('; ')}`)
  const orden = Object.keys(SECCIONES)
  for (const s of orden) {
    const k = f.conocimiento?.[s]; if (!k) continue
    const fuente = k.fuente ? ` (fuente: ${k.fuente.tipo} · ${k.fuente.referencia}${k.fuente.version ? ` ${k.fuente.version}` : ''})` : ''
    lineas.push(`[${k.nivel}] ${ETIQUETA_SECCION[s] ?? s}: ${k.contenido}${fuente}`)
  }
  if (f.relaciones?.length) lineas.push(`Relaciones curadas: ${f.relaciones.map((r) => `${r.tipo} → ${r.nombre}`).join('; ')}`)
  if (f.disclaimers?.length) lineas.push(`Avisos: ${f.disclaimers.join(' | ')}`)
  const faltan = (['T1', 'T2'] as Nivel[]).filter((n) => !(f.niveles_disponibles ?? []).includes(n))
  if (faltan.length) lineas.push(`Sin información ${faltan.join('/')} disponible para esta audiencia: no la inventes; ofrece verificación o asesor.`)
  return lineas.join('\n')
}

export interface Candidato { product_id: string; nombre: string; familia?: string | null; categoria?: string | null; presentacion?: string | null; coincidencia?: string; motivo?: string }
export function candidatosParaIA(filas: Candidato[] | null | undefined, max = 12): string {
  if (!filas?.length) return 'Sin candidatos en el catálogo para esos criterios. No propongas productos que no estén en esta lista.'
  return filas.slice(0, max).map((c) => filtrarCamposProhibidos(c)).map((c) => `- ${c.nombre}${c.presentacion ? ` [${c.presentacion}]` : ''}${c.familia ? ` · ${c.familia}` : ''}${c.categoria ? ` · ${c.categoria}` : ''}${c.motivo ? ` (${c.motivo})` : c.coincidencia ? ` (${c.coincidencia})` : ''} · id ${c.product_id}`).join('\n')
}

/** Reglas que CC-4 inyecta al sistema del modelo: la IA informa SOLO desde lo aprobado. */
export const REGLAS_IA = [
  'Responde únicamente con la información de producto y empresa que se te entrega (conocimiento aprobado). No inventes composición, indicaciones, certificaciones ni comparaciones.',
  'Si una pregunta requiere información técnica (T1) o clínica (T2) que no se te entregó, dilo y ofrece verificación de la cuenta o un asesor humano.',
  'Nunca afirmes precio, existencia, costo ni condiciones fiscales desde el conocimiento: esos datos vienen de su propia fuente autorizada o no se afirman.',
  'Cuando cites un dato técnico, menciona la fuente que acompaña al dato.',
  'Las relaciones entre productos solo son las curadas (alternativa comercial, complemento, reemplazo, comparable) o la pertenencia a la misma familia. "Relacionado" no significa "sustituto".',
  'No afirmes que un producto cura, garantiza resultados o carece de riesgos.',
] as const

// Errores de la base → HTTP controlado (para la Edge de CC-4 y para la administración).
export function mapearErrorConocimiento(mensaje: string | undefined): { status: number; body: { error: string; message: string } } {
  const m = mensaje ?? ''
  const r = (status: number, error: string, message: string) => ({ status, body: { error, message } })
  if (/NO_AUTORIZADO|permission denied/.test(m)) return r(403, 'no_autorizado', 'Solo Dirección administra el conocimiento.')
  if (/T2_BLOQUEADO/.test(m)) return r(409, 't2_bloqueado', 'El contenido clínico requiere habilitación de Dirección y confirmación explícita.')
  if (/FUENTE_REQUERIDA/.test(m)) return r(409, 'fuente_requerida', 'Este nivel exige una fuente documentada.')
  if (/CLAIM_PROHIBIDO/.test(m)) return r(409, 'claim_prohibido', 'El texto contiene afirmaciones no permitidas.')
  if (/CLAIM_REQUIERE_T2/.test(m)) return r(409, 'claim_requiere_t2', 'El texto contiene lenguaje clínico: corresponde a una sección clínica.')
  if (/REV_DESACTUALIZADA/.test(m)) return r(409, 'rev_desactualizada', 'El borrador cambió; recarga y vuelve a intentar.')
  if (/DRAFT_EXISTE/.test(m)) return r(409, 'draft_existe', 'Ya hay un borrador de esa sección.')
  if (/CONOCIMIENTO_INMUTABLE/.test(m)) return r(409, 'inmutable', 'Una versión aprobada o retirada no se edita; crea una nueva versión.')
  if (/ALIAS_AMBIGUO/.test(m)) return r(409, 'alias_ambiguo', 'Ese término ya apunta a otro producto.')
  if (/SECCION_INVALIDA|AUDIENCIA_INVALIDA|RELACION_INVALIDA|COMPARACION_INVALIDA|ALIAS_INVALIDO|MOTIVO_REQUERIDO|ck_c/.test(m)) return r(400, 'invalido', 'La solicitud no es válida.')
  if (/PRODUCTO_INEXISTENTE|CONOCIMIENTO_INEXISTENTE/.test(m)) return r(404, 'inexistente', 'No existe.')
  return r(503, 'no_disponible', 'No se pudo completar la operación. Intenta más tarde.')
}
