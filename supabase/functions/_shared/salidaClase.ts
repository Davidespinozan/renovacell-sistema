// R4-B2-2 · clase del resultado de un envío por Meta (WhatsApp Cloud API y Send API de la página). Puro: se prueba en vitest.
//   definitivo   → Meta lo RECHAZÓ (4xx de validación/permiso/ventana): no salió; no se reintenta.
//   reintentable → Meta lo rechazó por CUPO (429 o códigos de límite): no salió; se reintenta (máx. 5 intentos).
//   incierto     → no se sabe si salió (timeout, red, 5xx, 2xx sin identificador, error genérico de Meta):
//                  NO se reintenta (evita duplicados); Dirección decide.
// La base recibe la clase como prefijo de p_error ('clase|detalle'); si faltara, la deduce del texto.
export type ClaseEnvio = 'definitivo' | 'reintentable' | 'incierto'
export type ResultadoEnvio = { ok: true; id: string } | { ok: false; clase: ClaseEnvio; detalle: string }

const CODIGOS_CUPO = new Set([4, 17, 32, 613, 80007, 130429, 131048, 131056])   // límites de tasa / pares: Meta no lo envió
const CODIGOS_AMBIGUOS = new Set([1, 2, 131000])                                // error desconocido o servicio no disponible

/** Clasifica la respuesta HTTP de Meta. `id` es el identificador del mensaje si la respuesta lo trae (wamid / message_id). */
export function clasificarEnvio(status: number, cuerpo: unknown, id: string | null | undefined): ResultadoEnvio {
  if (status >= 200 && status < 300 && id) return { ok: true, id }
  const e = ((cuerpo ?? {}) as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } }).error ?? {}
  const codigo = typeof e.code === 'number' ? e.code : undefined
  const detalle = `Meta ${status}${codigo !== undefined ? ` (${codigo}${e.error_subcode ? '/' + e.error_subcode : ''})` : ''}: `
    + `${String(e.message ?? 'sin detalle').replace(/\s+/g, ' ').slice(0, 160)}${e.fbtrace_id ? ` [trace ${String(e.fbtrace_id).slice(0, 40)}]` : ''}`
  const clase: ClaseEnvio =
    status === 429 || (codigo !== undefined && CODIGOS_CUPO.has(codigo)) ? 'reintentable'
    : status >= 500 || (status >= 200 && status < 300) || status < 200 || (codigo !== undefined && CODIGOS_AMBIGUOS.has(codigo)) ? 'incierto'
    : 'definitivo'
  return { ok: false, clase, detalle }
}

/** Excepción del fetch (timeout, red): no se sabe si Meta lo recibió. */
export function resultadoDeExcepcion(e: unknown): ResultadoEnvio {
  return { ok: false, clase: 'incierto', detalle: (e as Error)?.name === 'AbortError' ? 'sin respuesta de Meta (timeout)' : 'sin respuesta de Meta (red)' }
}

/** Texto para p_error del resolver: 'clase|detalle' (≤ 300). 'retener' = no se envió porque el canal se pausó antes del POST. */
export const lineaResolucion = (clase: ClaseEnvio | 'retener', detalle: string): string => `${clase}|${detalle}`.slice(0, 300)
