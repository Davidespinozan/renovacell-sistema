// W4 · ESCRITURA CONFIRMADA — una escritura no "salió bien" hasta que el servidor lo dijo.
//
// Lo que este módulo cierra: los stores actualizaban la pantalla, avisaban al
// personal y escribían la bitácora ANTES de que el servidor respondiera, y si la
// respuesta era un rechazo lo único que quedaba era un `console.warn`. El operador
// veía un éxito que no existía.
//
// Dos reglas:
//   1. `confirmar()` NUNCA calla un fallo: además de devolverlo, lo publica en un
//      canal global que el shell pinta en pantalla. Aunque quien llama ignore el
//      resultado, el rechazo se ve.
//   2. Distingue RECHAZADO de DESCONOCIDO. Un corte de red no es un "no": puede que
//      el servidor sí haya guardado. Para una escritura directa —que no lleva
//      identificador de operación— eso significa "verifica antes de repetir", no
//      "reintenta tranquilo".
import { codigoConocido, isAmbiguous, w1Message } from '../ops/w1Command'
import { atenderSuspension } from '../../auth/suspension'

export type Escritura = { ok: true } | { ok: false; error: string; ambiguous: boolean }

export interface Fallo {
  id: number
  que: string        // qué intentaba hacer el operador, en sus palabras
  error: string      // por qué no quedó, en lenguaje de operador
  ambiguous: boolean // true = no sabemos si el servidor lo aplicó
  at: string
}

// Resultado DESCONOCIDO de una escritura directa: no se puede prometer que repetir
// sea inocuo, porque estas escrituras no llevan identificador de operación.
export const DESCONOCIDO_MSG =
  'No se pudo confirmar si el cambio se guardó. Antes de repetirlo, recarga y verifica cómo quedó.'

// Resultado DESCONOCIDO de una operación que el servidor SÍ sabe repetir sin duplicar.
export const REINTENTO_SEGURO_MSG =
  'No se pudo confirmar con el servidor. Inténtalo de nuevo: esta operación no se duplica.'

type ErrorServidor = { message: string; code?: string; status?: number }
type Respuesta = { error: ErrorServidor | null }

// Errores crudos de Postgres/PostgREST que NO traen código de negocio. Se traducen
// aquí para que nunca lleguen al operador tal cual.
const CRUDOS: [RegExp, string][] = [
  [/row-level security|permission denied|not authorized|JWT/i, 'No tienes permiso para esta operación.'],
  [/duplicate key|already exists/i, 'Ya existe un registro con esos datos.'],
  [/foreign key/i, 'No se puede: hay otros registros que dependen de éste.'],
  [/violates not-null|null value in column/i, 'Falta un dato obligatorio.'],
  [/invalid input syntax|out of range/i, 'Uno de los datos no tiene el formato esperado.'],
]

export function mensajeDeError(e: ErrorServidor, origen: 'tabla' | 'comando' = 'tabla'): string {
  // W6-A1: una cuenta suspendida no sigue operando en esta pestaña.
  atenderSuspension(e.message)
  // Un código de negocio o una restricción que sabemos leer manda sobre todo lo demás.
  if (codigoConocido(e.message)) return w1Message(e.message)
  for (const [re, texto] of CRUDOS) if (re.test(e.message)) return texto
  // Un COMANDO del servidor redacta sus rechazos para el operador; una escritura
  // directa a tabla solo devuelve texto de Postgres, que no se muestra.
  return origen === 'comando' ? w1Message(e.message) : 'No se pudo guardar el cambio.'
}

// ── Canal global de fallos ────────────────────────────────────────────────────
let fallos: Fallo[] = []
let snap: Fallo[] = fallos
let seq = 0
const listeners = new Set<() => void>()
const emit = () => { snap = fallos; listeners.forEach((l) => l()) }

export const subscribeFallos = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } }
export const getFallosSnapshot = (): Fallo[] => snap

export function reportarFallo(que: string, error: string, ambiguous = false, opciones: { unico?: boolean } = {}): Fallo {
  seq += 1
  const f: Fallo = { id: seq, que, error, ambiguous, at: new Date().toISOString() }
  // `unico`: un mismo aviso (p. ej. "no se pudo cargar los pedidos") no se apila una
  // vez por cada recarga; reemplaza al anterior con el mismo `que`.
  const resto = opciones.unico ? fallos.filter((x) => x.que !== que) : fallos
  // Se conservan los más recientes; el operador los descarta a mano.
  fallos = [f, ...resto].slice(0, 6)
  emit()
  return f
}
/** Retira un aviso por su `que` cuando la condición que lo causó ya no existe. */
export function limpiarAviso(que: string) {
  if (!fallos.some((f) => f.que === que)) return
  fallos = fallos.filter((f) => f.que !== que)
  emit()
}
export function descartarFallo(id: number) { fallos = fallos.filter((f) => f.id !== id); emit() }
export function limpiarFallos() { fallos = []; emit() }

/**
 * Espera la respuesta del servidor y dice la verdad sobre ella. Nunca lanza.
 * `que` describe la intención del operador ("marcar el pedido como enviado") y es
 * lo que se muestra si falla.
 */
export interface OpcionesConfirmar {
  // 'comando' = función del servidor que redacta sus propios rechazos.
  origen?: 'tabla' | 'comando'
  // true SOLO si el servidor garantiza que repetir la operación no la duplica
  // (lleva identificador de operación o es idempotente por construcción).
  reintentoSeguro?: boolean
}

export async function confirmar(que: string, op: PromiseLike<Respuesta>, opciones: OpcionesConfirmar = {}): Promise<Escritura> {
  const desconocido = opciones.reintentoSeguro ? REINTENTO_SEGURO_MSG : DESCONOCIDO_MSG
  let res: Respuesta
  try {
    res = await op
  } catch {
    // La promesa reventó sin respuesta: el resultado es desconocido, no un rechazo.
    reportarFallo(que, desconocido, true)
    return { ok: false, error: desconocido, ambiguous: true }
  }
  if (!res.error) return { ok: true }
  const reconocido = codigoConocido(res.error.message)
  const ambiguous = !reconocido && isAmbiguous(res.error) && !CRUDOS.some(([re]) => re.test(res.error!.message))
  const error = ambiguous ? desconocido : mensajeDeError(res.error, opciones.origen ?? 'tabla')
  reportarFallo(que, error, ambiguous)
  return { ok: false, error, ambiguous }
}

/**
 * Para lo que es deliberadamente optimista (un comentario, una reacción): el cambio
 * ya se ve, y si el servidor lo rechaza se REVIERTE y se AVISA. Lo que no puede
 * pasar es que el rechazo se quede en la consola.
 */
export function trasEscribir(que: string, op: PromiseLike<Respuesta>, alFallar: () => void): void {
  void confirmar(que, op).then((r) => { if (!r.ok) alFallar() })
}
