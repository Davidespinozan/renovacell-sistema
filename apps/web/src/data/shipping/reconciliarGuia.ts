// DHL D1 · Reconciliación de un intento de guía en estado desconocido (acción `reconciliar_guia` de la Edge `shipping`).
// El SERVIDOR consulta a DHL y decide con el comando `reconciliar_guia`; aquí solo se pide, se transporta la decisión de
// Dirección (resolución, motivo, confirmaciones) y se traducen los rechazos. Nunca se envía evidencia desde el cliente.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface GuiaHallada { tracking: string; referencias: string[]; producto: string | null; destino_cp: string | null; peso_total: number | null; piezas: number | null; eventos: number }
export interface ConsultaParcial { realizada: boolean; resultado: 'encontradas' | 'sin_resultados' | 'error' | 'no_realizada'; encontradas: GuiaHallada[]; http?: number; detalle?: string }
export interface ConsultaReconciliacion {
  intento: { id: string; creado: string; actualizado: string | null; horas: number; referencia: string; servicio: string | null; con_snapshot: boolean; costo: number | null; moneda: string | null }
  consulta: { consultado_en: string; referencia: string; por_referencia: ConsultaParcial; por_tracking?: ConsultaParcial & { tracking: string } }
  guias_distintas: string[]
  reglas: { minutos_minimos_sin_guia: number; minutos_vigencia_consulta: number; advertencia: string }
}
export type Resolucion = 'sin_guia' | 'guia_confirmada'
export interface DecisionReconciliacion { resolucion: Resolucion; motivo: string; opId: string; tracking?: string; portalRevisado: boolean; aceptaDuplicadoTardio: boolean }
export interface ResultadoReconciliacion { resultado: { status?: string; resolucion?: Resolucion; tracking?: string; order_status?: string; costo_pendiente?: boolean }; etiqueta: 'no_aplica' | 'guardada' | 'no_disponible' }

type Invocar = (body: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; context?: Response } | null }>
const invocarPorDefecto: Invocar = (body) => supabase.functions.invoke('shipping', { body }) as unknown as ReturnType<Invocar>

const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'Solo Dirección puede resolver un intento en estado desconocido.',
  solo_direccion: 'Solo Dirección puede resolver un intento en estado desconocido.',
  sin_intento_desconocido: 'Este pedido ya no tiene un intento en estado desconocido; recarga.',
  not_configured: 'DHL no está configurado en el servidor.',
  tracking_invalido: 'Una guía de DHL Express tiene 10 dígitos.',
  RESOLUCION_INVALIDA: 'Elige qué resolver: sin guía o guía confirmada.',
  MOTIVO_REQUERIDO: 'Explica la decisión (al menos 10 caracteres).',
  INTENTO_INEXISTENTE: 'El intento ya no existe; recarga.',
  ESTADO_INVALIDO: 'El intento ya no está en estado desconocido; recarga.',
  PEDIDO_NO_EMPACADO: 'El pedido ya no está empacado; revisa su estado antes de reconciliar.',
  ESTADO_INCONSISTENTE: 'El pedido ya tiene una guía registrada; revísalo con soporte.',
  CONSULTA_INCOMPLETA: 'La consulta a DHL no se completó. Vuelve a consultar y reintenta.',
  CONSULTA_CADUCA: 'La consulta a DHL es de hace más de 30 minutos. Vuelve a consultar.',
  CONSULTA_AJENA: 'La consulta no corresponde a este intento. Vuelve a consultar.',
  CIERRE_PREMATURO: 'Aún no pasaron 60 minutos desde el intento. Espera antes de resolver sin guía.',
  HALLAZGOS_EXISTEN: 'DHL devolvió alguna guía: no se puede resolver como "sin guía". Revisa los hallazgos.',
  REVISION_REQUERIDA: 'Confirma que revisaste el portal MyDHL sin encontrar la guía.',
  RIESGO_NO_ACEPTADO: 'Resolver sin guía exige aceptar el riesgo de duplicado tardío.',
  TRACKING_REQUERIDO: 'Indica el número de guía hallado (10 dígitos).',
  TRACKING_INVALIDO: 'Una guía de DHL Express tiene 10 dígitos.',
  SIN_SNAPSHOT: 'El intento no guardó la petición original; la guía no se puede registrar desde aquí.',
  AMBIGUO: 'DHL devolvió más de una guía para este intento; no se registra ninguna. Revisa el portal.',
  COINCIDENCIA_INSUFICIENTE: 'La guía hallada no coincide con el intento (referencia, servicio, destino, peso o piezas). No se registra.',
  GUIA_YA_REGISTRADA: 'Esa guía ya está registrada en otro envío.',
  OP_ID_REUTILIZADO: 'Esa operación ya se usó con otros datos. Vuelve a intentarlo.',
  CUENTA_SUSPENDIDA: 'Tu acceso fue suspendido por Dirección.',
}
export function mensajeReconciliar(codigo: string | undefined, detalle?: string): string {
  const base = MENSAJES[codigo ?? ''] ?? 'No se pudo completar la reconciliación. Intenta de nuevo.'
  const extra = /^COINCIDENCIA_INSUFICIENTE:\s*(.+)$/.exec(detalle ?? '')?.[1]
  return extra ? `${base} Detalle: ${extra}` : base
}

async function cuerpoError(error: { message?: string; context?: Response }): Promise<{ error?: string; message?: string } | null> {
  try { return await error.context?.clone().json() } catch { return null }
}
function codigoDe(e: { error?: string; message?: string } | null, fallback?: string): string | undefined {
  if (e?.error && /^[A-Za-z_]{3,}$/.test(e.error)) return e.error
  return /^([A-Z_]{4,})\b/.exec(e?.message ?? fallback ?? '')?.[1]
}

export async function consultarReconciliacion(orderId: string, tracking?: string, invocar: Invocar = invocarPorDefecto): Promise<{ ok: true; datos: ConsultaReconciliacion } | { ok: false; error: string }> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, error: 'Reconciliar requiere conexión con el servidor.' }
  try {
    const { data, error } = await invocar({ action: 'reconciliar_guia', sub: 'consultar', order_id: orderId, ...(tracking ? { tracking } : {}) })
    if (error) { const e = await cuerpoError(error); return { ok: false, error: mensajeReconciliar(codigoDe(e, error.message), e?.message) } }
    const d = data as ConsultaReconciliacion | { error?: string; message?: string }
    if ((d as { error?: string }).error) return { ok: false, error: mensajeReconciliar((d as { error?: string }).error, (d as { message?: string }).message) }
    return { ok: true, datos: d as ConsultaReconciliacion }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Vuelve a intentarlo.' } }
}

export async function resolverReconciliacion(orderId: string, dec: DecisionReconciliacion, invocar: Invocar = invocarPorDefecto): Promise<{ ok: true; datos: ResultadoReconciliacion } | { ok: false; error: string; ambiguo: boolean }> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, error: 'Reconciliar requiere conexión con el servidor.', ambiguo: false }
  try {
    const { data, error } = await invocar({
      action: 'reconciliar_guia', sub: 'resolver', order_id: orderId, op_id: dec.opId, resolucion: dec.resolucion, motivo: dec.motivo,
      ...(dec.tracking ? { tracking: dec.tracking } : {}), portal_revisado: dec.portalRevisado === true, acepta_duplicado_tardio: dec.aceptaDuplicadoTardio === true,
    })
    if (error) {
      const e = await cuerpoError(error)
      const codigo = codigoDe(e, error.message)
      // Sin código de negocio (red, 5xx) el resultado es DESCONOCIDO: reintentar con el mismo opId es seguro (no se aplica dos veces).
      return { ok: false, error: codigo ? mensajeReconciliar(codigo, e?.message) : 'No se pudo confirmar la reconciliación. Vuelve a intentarlo: no se aplicará dos veces.', ambiguo: !codigo }
    }
    const d = data as ResultadoReconciliacion & { error?: string; message?: string }
    if (d?.error) return { ok: false, error: mensajeReconciliar(d.error, d.message), ambiguo: false }
    if (d?.resultado?.status === 'applied' || d?.resultado?.status === 'already_applied') return { ok: true, datos: d }
    return { ok: false, error: 'El servidor no confirmó la reconciliación.', ambiguo: true }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Vuelve a intentarlo: no se aplicará dos veces.', ambiguo: true } }
}
