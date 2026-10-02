// W3-C · C3 — capa de operaciones de la revisión fiscal del catálogo.
//
// TODA mutación pasa por los comandos canónicos de C1. Aquí no existe una sola
// escritura directa a product_fiscal, fiscal_category_defaults ni
// fiscal_price_evidence: la base las rechaza (FISCAL_PRODUCTO_SOLO_POR_COMANDO) y
// este módulo no lo intenta.
//
// La regla que ordena todo el módulo: la evidencia histórica es de PRECIO, nunca de
// impuesto. Ninguna función de aquí deduce un tratamiento fiscal de una relación
// aritmética entre precios, y la UI tampoco debe sugerirlo.
import { hasSupabase, supabase } from '../../lib/supabase'
import { AMBIGUO_MSG, constraintCode, isAmbiguous, newOpId, w1Code, w1Message } from './w1Command'
import type { Json } from '../database.types'

export type TratamientoIva = 'gravado' | 'tasa_cero' | 'exento' | 'no_objeto'
export type ObjetoImp = '01' | '02' | '03'
export type EvidenciaClase =
  | 'HISTORICAL_BASE_PLUS_16' | 'HISTORICAL_EQUALS_FINAL'
  | 'HISTORICAL_MISMATCH' | 'NO_PUBLIC_REFERENCE'
export type Procedencia = 'DIRECT_MATCH' | 'FAMILY_LEVEL_MATCH'

/** Una fila de la hoja de trabajo: producto vendible + su borrador fiscal. */
export interface FilaRevisionFiscal {
  product_id: string
  sku: string | null
  nombre: string
  categoria: string | null
  unidad_comercial: string | null
  precio_final: number | null
  clave_prod_serv: string | null
  clave_unidad: string | null
  objeto_imp: string | null
  tratamiento_iva: string | null
  iva_tasa: number | null
  descripcion_fiscal: string | null
  validado: boolean
  validado_at: string | null
  validado_por_nombre: string | null
  evidencia_historica: string | null
  precio_historico: number | null
  precio_publicado: number | null
  faltantes: string[]
  advertencias: string[]
}

/** Una observación histórica. EVIDENCIA DE PRECIO, no autoridad fiscal. */
export interface ObservacionEvidencia {
  id: string
  source_ref: string
  source_nombre: string
  source_referencia: string | null
  precio_historico: number | null
  precio_publicado: number | null
  clasificacion: EvidenciaClase
  procedencia: Procedencia | null
  familia_publicada: string | null
  product_id: string | null
  mapeo_estado: 'MAPEADO' | 'NO_MAPEADO'
  mapeo_metodo: string | null
  mapeo_motivo: string | null
  created_at: string
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string; ambiguous?: boolean }

const SIN_BACKEND = 'Sin conexión con el servidor: la configuración fiscal no se modificó.'

function falla(e: { message: string; code?: string } | null): Resultado<never> {
  if (!e) return { ok: false, error: 'No se pudo completar la operación.' }
  // Orden deliberado: si el mensaje trae un código o una restricción que sabemos
  // leer, el servidor YA respondió y respondió que no. Decirle "no se pudo
  // confirmar, reintenta" a un rechazo definitivo manda al operador a repetir algo
  // que nunca va a pasar; la ambigüedad se reserva para las fallas de transporte.
  const reconocido = constraintCode(e.message) ?? w1Code(e.message)
  if (!reconocido && isAmbiguous(e)) return { ok: false, error: AMBIGUO_MSG, ambiguous: true }
  return { ok: false, error: w1Message(e.message) }
}

// ── LECTURA ─────────────────────────────────────────────────────────────────────

export async function cargarRevisionFiscal(): Promise<FilaRevisionFiscal[]> {
  if (!hasSupabase) return []
  const { data, error } = await supabase.rpc('estado_validacion_fiscal')
  if (error || !data) return []
  return data as unknown as FilaRevisionFiscal[]
}

/** Observaciones históricas. Sin `productId` devuelve TODAS (incluidas las sin mapear). */
export async function cargarEvidencia(productId?: string): Promise<ObservacionEvidencia[]> {
  if (!hasSupabase) return []
  let q = supabase.from('fiscal_price_evidence')
    .select('id, source_ref, source_nombre, source_referencia, precio_historico, precio_publicado, clasificacion, procedencia, familia_publicada, product_id, mapeo_estado, mapeo_metodo, mapeo_motivo, created_at')
    .order('created_at', { ascending: false })
  q = productId ? q.eq('product_id', productId) : q.is('product_id', null)
  const { data, error } = await q
  if (error || !data) return []
  return data as unknown as ObservacionEvidencia[]
}

/**
 * `fuente` y `notas` de la ficha fiscal. La hoja de trabajo no los devuelve, así que
 * se leen de la tabla — SOLO LECTURA; escribirlos sigue siendo del comando de C1.
 */
export interface FichaFiscal { fuente: string | null; notas: string | null }

export async function cargarFichaFiscal(productId: string): Promise<FichaFiscal | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.from('product_fiscal')
    .select('fuente, notas').eq('product_id', productId).maybeSingle()
  if (error || !data) return null
  return { fuente: data.fuente ?? null, notas: data.notas ?? null }
}

export interface DefaultCategoria {
  categoria: string
  clave_prod_serv: string | null
  clave_unidad: string | null
  objeto_imp: string | null
  tratamiento_iva: string | null
  iva_tasa: number | null
  notas: string | null
}

export async function cargarDefaults(): Promise<DefaultCategoria[]> {
  if (!hasSupabase) return []
  const { data, error } = await supabase.from('fiscal_category_defaults')
    .select('categoria, clave_prod_serv, clave_unidad, objeto_imp, tratamiento_iva, iva_tasa, notas')
    .order('categoria')
  if (error || !data) return []
  return data as unknown as DefaultCategoria[]
}

// ── MUTACIÓN · solo por comandos canónicos de C1 ────────────────────────────────

export interface CambiosFiscales {
  clave_prod_serv?: string | null
  clave_unidad?: string | null
  objeto_imp?: string | null
  tratamiento_iva?: string | null
  iva_tasa?: string | null
  descripcion_fiscal?: string | null
  notas?: string | null
  fuente?: string | null
}

export interface ResultadoEdicion {
  validado: boolean
  invalidado_por_el_cambio: boolean
  faltantes: string[]
}

/**
 * Edita el borrador fiscal. Solo viajan las claves presentes: así se distingue
 * "no toques este campo" de "ponlo en nulo", que en una configuración fiscal no
 * es lo mismo. Si el producto estaba validado y cambia un dato MATERIAL, la base
 * invalida la validación automáticamente — la semántica de C1 manda.
 */
export async function editarFiscal(
  productId: string, cambios: CambiosFiscales, motivo?: string,
): Promise<Resultado<ResultadoEdicion>> {
  if (!hasSupabase) return { ok: false, error: SIN_BACKEND }
  const { data, error } = await supabase.rpc('editar_fiscal_producto', {
    p_op_id: newOpId(), p_product_id: productId,
    p_cambios: cambios as unknown as Json, p_motivo: motivo ?? undefined,
  })
  if (error) return falla(error)
  const r = (data ?? {}) as Record<string, unknown>
  return { ok: true, data: {
    validado: r.validado === true,
    invalidado_por_el_cambio: r.invalidado_por_el_cambio === true,
    faltantes: (r.faltantes as string[]) ?? [],
  } }
}

/** Acto humano explícito. No existe validación en lote, por diseño. */
export async function validarFiscal(
  productId: string, fuente: string, notas?: string,
): Promise<Resultado<{ validado: boolean }>> {
  if (!hasSupabase) return { ok: false, error: SIN_BACKEND }
  const { data, error } = await supabase.rpc('validar_fiscal_producto', {
    p_op_id: newOpId(), p_product_id: productId, p_fuente: fuente, p_notas: notas ?? undefined,
  })
  if (error) return falla(error)
  return { ok: true, data: { validado: ((data ?? {}) as Record<string, unknown>).validado === true } }
}

export async function invalidarFiscal(productId: string, motivo: string): Promise<Resultado<null>> {
  if (!hasSupabase) return { ok: false, error: SIN_BACKEND }
  const { error } = await supabase.rpc('invalidar_fiscal_producto', {
    p_op_id: newOpId(), p_product_id: productId, p_motivo: motivo,
  })
  if (error) return falla(error)
  return { ok: true, data: null }
}

export async function definirDefaults(
  categoria: string, cambios: CambiosFiscales,
): Promise<Resultado<null>> {
  if (!hasSupabase) return { ok: false, error: SIN_BACKEND }
  const { error } = await supabase.rpc('definir_defaults_categoria', {
    p_op_id: newOpId(), p_categoria: categoria, p_cambios: cambios as unknown as Json,
  })
  if (error) return falla(error)
  return { ok: true, data: null }
}

/**
 * Aplica la PROPUESTA de la categoría: rellena huecos de los productos NO validados.
 * Jamás valida y jamás pisa un valor existente ni un producto ya validado. El
 * servidor devuelve `validados_por_esta_operacion: 0` siempre, a propósito.
 */
export async function aplicarPropuestaCategoria(
  categoria: string,
): Promise<Resultado<{ prellenados: number; validados: number }>> {
  if (!hasSupabase) return { ok: false, error: SIN_BACKEND }
  const { data, error } = await supabase.rpc('aplicar_defaults_categoria', {
    p_op_id: newOpId(), p_categoria: categoria,
  })
  if (error) return falla(error)
  const r = (data ?? {}) as Record<string, unknown>
  return { ok: true, data: {
    prellenados: Number(r.productos_prellenados ?? 0),
    validados: Number(r.validados_por_esta_operacion ?? 0),
  } }
}

// ── TEXTOS · lo que la evidencia significa, y lo que NO ─────────────────────────

/**
 * Etiqueta y advertencia de cada clasificación. La advertencia es obligatoria en la
 * UI: sin ella, un operador podría leer "histórico × 1.16" como "IVA 16% aprobado".
 */
export const EVIDENCIA: Record<EvidenciaClase, { etiqueta: string; advertencia: string; tono: 'neu' | 'warn' | 'dang' }> = {
  HISTORICAL_BASE_PLUS_16: {
    etiqueta: 'Histórico +16%',
    advertencia: 'El precio publicado parece incluir 16%. Es evidencia sobre el PRECIO: no autoriza tratar este producto como gravado al 16%.',
    tono: 'neu',
  },
  HISTORICAL_EQUALS_FINAL: {
    etiqueta: 'Histórico = final',
    advertencia: 'El precio histórico coincide con el final. Eso NO significa exento, tasa cero ni no objeto: la aritmética no distingue "el Excel ya traía el precio final" de "no es gravado al 16%".',
    tono: 'warn',
  },
  HISTORICAL_MISMATCH: {
    etiqueta: 'No reconcilia',
    advertencia: 'Los precios históricos NO reconcilian con el listado publicado. No hay candidato de precio en el que apoyarse; la identidad del producto sí está determinada.',
    tono: 'dang',
  },
  NO_PUBLIC_REFERENCE: {
    etiqueta: 'Sin referencia pública',
    advertencia: 'Sin referencia en el listado público: no hay precio publicado con el que comparar.',
    tono: 'dang',
  },
}

export const TRATAMIENTOS: { valor: TratamientoIva; etiqueta: string; llevaTasa: boolean }[] = [
  { valor: 'gravado', etiqueta: 'Gravado', llevaTasa: true },
  { valor: 'tasa_cero', etiqueta: 'Tasa 0%', llevaTasa: true },
  { valor: 'exento', etiqueta: 'Exento', llevaTasa: false },
  { valor: 'no_objeto', etiqueta: 'No objeto', llevaTasa: false },
]

export const OBJETOS: { valor: ObjetoImp; etiqueta: string }[] = [
  { valor: '01', etiqueta: '01 · No objeto de impuesto' },
  { valor: '02', etiqueta: '02 · Sí objeto de impuesto' },
  { valor: '03', etiqueta: '03 · Sí objeto, no obligado al desglose' },
]

export const PROCEDENCIA_TEXTO: Record<Procedencia, string> = {
  DIRECT_MATCH: 'Coincidencia directa con el listado publicado',
  FAMILY_LEVEL_MATCH: 'Coincidencia a nivel de FAMILIA: el listado publicado traía una entrada familiar, no una fila por producto',
}

/** Estado de la fila para pastillas y filtros. */
export type EstadoFila = 'validado' | 'pendiente' | 'incompleto'
export function estadoDeFila(f: FilaRevisionFiscal): EstadoFila {
  if (f.validado) return 'validado'
  return f.faltantes.length > 0 ? 'incompleto' : 'pendiente'
}
