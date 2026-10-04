// W4-02 · LECTURA ACOTADA — ninguna lista se trunca en silencio.
//
// PostgREST devuelve como máximo 1,000 filas por petición y NO avisa cuando corta.
// Un store que hacía `.select()` a secas mostraba los primeros 1,000 pedidos como si
// fueran todos: las colas, los totales y las cuentas por cobrar quedaban mal sin
// ninguna señal. `customers` ya rebasa ese tope (2,570 filas).
//
// Tres reglas:
//   1. Se lee por páginas con ORDEN ESTABLE (siempre con una llave única de
//      desempate). Sin ella, dos filas con la misma fecha pueden repetirse o perderse
//      entre una página y la siguiente.
//   2. Hay un TOPE explícito. Si se alcanza, se dice en pantalla cuántas filas se
//      cargaron: no se finge que el historial está completo.
//   3. Una lectura que FALLA no se presenta como "lista vacía": se avisa.
import { limpiarAviso, mensajeDeError, reportarFallo } from './escritura'

/** Filas por petición: el tope de PostgREST. */
export const PAGINA = 1000
/** Filas máximas que un store carga al navegador. Más allá, hace falta filtrar en servidor. */
export const TOPE = 20_000

type Respuesta<T> = { data: T[] | null; error: { message: string; code?: string } | null }

export interface Lectura<T> {
  data: T[]
  error: { message: string } | null
  /** true si había más filas que el tope: `data` trae solo las primeras según el orden. */
  truncada: boolean
}

/**
 * Lee TODAS las páginas de una consulta, hasta `tope` filas.
 * `pagina(desde, hasta)` debe devolver la consulta con `.range(desde, hasta)` y con un
 * orden estable. Devuelve la misma forma `{ data, error }` que una consulta normal,
 * para que el store que la usa no cambie su manejo.
 */
export async function leerTodo<T>(
  nombre: string,
  pagina: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
  opciones: { tope?: number } = {},
): Promise<Lectura<T>> {
  const tope = opciones.tope ?? TOPE
  const QUE = `cargar ${nombre}`
  const VOL = `mostrar todo el historial de ${nombre}`
  const out: T[] = []
  for (let desde = 0; desde < tope; desde += PAGINA) {
    const hasta = Math.min(desde + PAGINA, tope) - 1
    let res: Respuesta<T>
    try {
      res = await pagina(desde, hasta)
    } catch {
      res = { data: null, error: { message: 'Failed to fetch' } }
    }
    if (res.error) {
      // Se avisa una sola vez por lista (no una vez por recarga) y se devuelve el error:
      // el store conserva lo que ya tenía en vez de pintar una lista vacía.
      reportarFallo(QUE, 'No se pudo cargar. Lo que ves puede estar desactualizado: recarga la página.', true, { unico: true })
      return { data: out, error: { message: mensajeDeError(res.error) }, truncada: false }
    }
    // Defensivo: si la respuesta no trae una lista, no hay filas (no se intenta recorrerla).
    const filas = Array.isArray(res.data) ? res.data : []
    out.push(...filas)
    if (filas.length < hasta - desde + 1) {
      limpiarAviso(QUE); limpiarAviso(VOL)
      return { data: out, error: null, truncada: false }
    }
  }
  // Se llegó al tope y la última página vino llena: hay más filas de las que se cargaron.
  limpiarAviso(QUE)
  reportarFallo(VOL,
    `Se cargaron ${tope.toLocaleString('es-MX')} registros, los más recientes. Los anteriores no aparecen en esta pantalla.`,
    false, { unico: true })
  return { data: out, error: null, truncada: true }
}
