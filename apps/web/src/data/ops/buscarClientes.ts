// SEC-C4-B2 · Servicio de búsqueda SEGURA de clientes (descubrimiento mínimo) sobre la RPC `buscar_clientes_pos`
// (migración 145). Es la capa que usarán Caja, Clientes y Nuevo pedido en lugar de precargar `customers`.
//
// Lo que este módulo garantiza:
//   · UNA sola vía: la RPC. Nunca consulta tablas ni completa el resultado con otra lectura.
//   · Tres campos y nada más: customer_id, nombre y telefono_mascara (••••1234 o null). Una respuesta que no
//     cumpla esa forma se trata como fallo del servicio; no se muestra "a medias".
//   · La identidad es la de la sesión. No recibe ni envía un usuario.
//   · El resultado dice QUÉ pasó (estado HTTP real), sin leer textos de error: un 429 nunca se parece a "sin resultados".
//   · Nada de reintentos automáticos. Nada persistente: la caché vive en memoria, por usuario, y se borra al cambiar de sesión.
//
// Encontrar una cuenta NO autoriza su expediente: con el customer_id se puede vender o levantar un pedido; el expediente
// sigue pasando por su propia función autorizada (cliente_360).
import { currentUserId, hasSupabase, supabase } from '../../lib/supabase'

export interface ClienteBusqueda {
  customer_id: string
  nombre: string
  /** '••••' + últimos 4 dígitos, o null si la cuenta no tiene un teléfono mostrable. Nunca el número completo. */
  telefono_mascara: string | null
}

export type EstadoBusqueda =
  | 'ok'                // 200: la lista (puede venir vacía = no hay coincidencias)
  | 'entrada_invalida'  // la consulta no cumple la regla (rechazada aquí, o 400 del servidor)
  | 'no_autenticado'    // sin sesión (aquí, o 401)
  | 'sin_autorizacion'  // 403: el rol no puede buscar, o la cuenta está suspendida
  | 'cuota_excedida'    // 429: límite de frecuencia o presupuesto diario
  | 'error_red'         // no hubo respuesta
  | 'error_servidor'    // 5xx, estado inesperado o respuesta fuera de contrato
  | 'cancelada'         // la pantalla la descartó (o lanzó otra después)

export type ResultadoBusqueda =
  | { estado: 'ok'; clientes: ClienteBusqueda[]; desdeCache: boolean }
  | { estado: Exclude<EstadoBusqueda, 'ok'> }

// ── Validación ────────────────────────────────────────────────────────────────────────────────────
// Espejo EXACTO de la regla de la RPC (migración 145, paso 2). Mismas tablas de acentos, mismo orden:
//   nula o de más de 400 caracteres → inválida
//   se colapsan los espacios en blanco y se recortan los extremos
//   teléfono = exactamente 4 dígitos
//   si no: hasta 60 caracteres, sin "@", con alguna letra a-z tras quitar acentos, y 3+ caracteres sin contar espacios
// Si esta copia rechazara de menos, el servidor responde 400 y se informa igual; nunca decide ella la autorización.
const ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ'
const PLANOS = 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'
const MAPA_ACENTOS: ReadonlyMap<string, string> = new Map([...ACENTOS].map((c, i) => [c, PLANOS[i]] as const))
// El `\s` de la base de PRODUCCIÓN (PostgreSQL, en_US.UTF-8), carácter por carácter: los blancos ASCII, los separadores
// 1C–1F, NEL (85) y los espacios Unicode. No es el `\s` de JavaScript: aquel incluye FEFF y omite 1C–1F y 85.
// Como lo que se envía es la consulta YA normalizada (solo espacios simples), el resultado no depende del servidor.
const ESPACIOS = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g
const largo = (s: string): number => [...s].length  // caracteres, no unidades UTF-16 (como char_length)

/** Minúsculas y sin acentos, igual que hace la base antes de comparar. También es la clave de la caché. */
export function plegar(s: string): string {
  return [...s.toLowerCase()].map((c) => MAPA_ACENTOS.get(c) ?? c).join('')
}

export type ConsultaValida = { ok: true; tipo: 'nombre' | 'telefono'; q: string }
export type Consulta = ConsultaValida | { ok: false }

export function validarBusqueda(entrada: unknown): Consulta {
  if (typeof entrada !== 'string' || largo(entrada) > 400) return { ok: false }
  const q = entrada.replace(ESPACIOS, ' ').replace(/^ +| +$/g, '')
  if (/^[0-9]{4}$/.test(q)) return { ok: true, tipo: 'telefono', q }
  if (largo(q) > 60 || q.includes('@')) return { ok: false }
  if (!/[a-z]/.test(plegar(q)) || largo(q.replace(/ /g, '')) < 3) return { ok: false }
  return { ok: true, tipo: 'nombre', q }
}

// ── Límite ────────────────────────────────────────────────────────────────────────────────────────
export const LIMITE_POR_DEFECTO = 6
export const LIMITE_MAXIMO = 10
/** 6 si no se indica (o si no es un entero); siempre entre 1 y 10. La base vuelve a acotarlo. */
export function limiteEfectivo(limite?: unknown): number {
  if (typeof limite !== 'number' || !Number.isInteger(limite)) return LIMITE_POR_DEFECTO
  return Math.min(Math.max(limite, 1), LIMITE_MAXIMO)
}

// ── Respuesta ─────────────────────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MASCARA = /^••••[0-9]{4}$/

/** Solo los tres campos del contrato, o null si la respuesta no tiene la forma esperada (se trata como fallo). */
export function leerClientes(data: unknown): ClienteBusqueda[] | null {
  if (!Array.isArray(data) || data.length > LIMITE_MAXIMO) return null
  const out: ClienteBusqueda[] = []
  for (const fila of data) {
    if (typeof fila !== 'object' || fila === null) return null
    const f = fila as Record<string, unknown>
    if (typeof f.customer_id !== 'string' || !UUID.test(f.customer_id)) return null
    if (typeof f.nombre !== 'string' || f.nombre === '') return null
    const m = f.telefono_mascara ?? null
    if (m !== null && (typeof m !== 'string' || !MASCARA.test(m))) return null   // jamás un teléfono que no venga enmascarado
    out.push({ customer_id: f.customer_id, nombre: f.nombre, telefono_mascara: m })
  }
  return out
}

// ── Transporte ────────────────────────────────────────────────────────────────────────────────────
export interface RespuestaRpc { data: unknown; error: unknown; status?: number }
/** Llama a la RPC con la sesión vigente. Inyectable para pruebas; nunca recibe credenciales ni usuario. */
export type TransporteBusqueda = (args: { q: string; limite: number }, signal?: AbortSignal) => PromiseLike<RespuestaRpc>

const transportePorDefecto: TransporteBusqueda = (args, signal) => {
  type Constructor = PromiseLike<RespuestaRpc> & { abortSignal(s: AbortSignal): PromiseLike<RespuestaRpc> }
  const llamada = (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Constructor)('buscar_clientes_pos', args)
  return signal ? llamada.abortSignal(signal) : llamada
}

function estadoDe(r: RespuestaRpc): ResultadoBusqueda {
  const s = typeof r.status === 'number' ? r.status : 0
  if (s >= 200 && s < 300) {
    const clientes = leerClientes(r.data ?? [])
    return clientes ? { estado: 'ok', clientes, desdeCache: false } : { estado: 'error_servidor' }
  }
  if (s === 400) return { estado: 'entrada_invalida' }
  if (s === 401) return { estado: 'no_autenticado' }
  if (s === 403) return { estado: 'sin_autorizacion' }
  if (s === 429) return { estado: 'cuota_excedida' }
  if (s === 0) return { estado: 'error_red' }
  return { estado: 'error_servidor' }
}

// ── Servicio ──────────────────────────────────────────────────────────────────────────────────────
export interface OpcionesBuscador {
  transporte?: TransporteBusqueda
  /** Identidad de la sesión (para aislar la caché). Por defecto, la del cliente de Supabase. */
  identidad?: () => string | null
  ahora?: () => number
  /** Vida de una entrada de caché, en ms. 0 la desactiva. */
  vidaCacheMs?: number
  maxEntradasCache?: number
}
export interface OpcionesBusqueda { limite?: number; signal?: AbortSignal }

interface Entrada { clientes: ClienteBusqueda[]; hasta: number }

/**
 * Un buscador por pantalla. Cada `buscar` es UNA petición explícita (Enter o botón): este servicio no busca al teclear.
 * Lanzar una búsqueda nueva descarta la anterior de la misma instancia, así una respuesta vieja nunca pisa a la nueva.
 * Cancelar en el navegador no devuelve cuota: el servidor pudo haberla contado.
 */
export class BuscadorClientes {
  private transporte: TransporteBusqueda
  private identidad: () => string | null
  private ahora: () => number
  private vida: number
  private max: number
  private cache = new Map<string, Entrada>()
  private usuarioCache: string | null = null
  private enCurso: AbortController | null = null
  private turno = 0

  constructor(o: OpcionesBuscador = {}) {
    this.transporte = o.transporte ?? transportePorDefecto
    this.identidad = o.identidad ?? currentUserId
    this.ahora = o.ahora ?? Date.now
    this.vida = o.vidaCacheMs ?? 60_000
    this.max = o.maxEntradasCache ?? 20
  }

  /** Olvida lo guardado y descarta la búsqueda en curso. Llamar al cerrar sesión o al desmontar la pantalla. */
  limpiar(): void { this.cache.clear(); this.usuarioCache = null; this.cancelar() }
  cancelar(): void { this.turno++; this.enCurso?.abort(); this.enCurso = null }

  async buscar(entrada: unknown, opciones: OpcionesBusqueda = {}): Promise<ResultadoBusqueda> {
    const c = validarBusqueda(entrada)
    if (!c.ok) return { estado: 'entrada_invalida' }                 // sin red: no gasta cuota
    const usuario = this.identidad()
    if (!usuario) return { estado: 'no_autenticado' }
    if (this.transporte === transportePorDefecto && !hasSupabase) return { estado: 'error_red' }
    if (usuario !== this.usuarioCache) { this.cache.clear(); this.usuarioCache = usuario }   // otra sesión: nada de lo anterior sirve

    const limite = limiteEfectivo(opciones.limite)
    const clave = `${c.tipo}|${plegar(c.q)}|${limite}`

    // Esta búsqueda reemplaza a la anterior de la instancia.
    this.cancelar()
    const mio = this.turno
    if (opciones.signal?.aborted) return { estado: 'cancelada' }

    const guardada = this.cache.get(clave)
    if (guardada && guardada.hasta > this.ahora()) return { estado: 'ok', clientes: guardada.clientes.map((x) => ({ ...x })), desdeCache: true }
    if (guardada) this.cache.delete(clave)

    const control = new AbortController()
    this.enCurso = control
    const alCancelar = () => control.abort()
    opciones.signal?.addEventListener('abort', alCancelar, { once: true })

    let r: ResultadoBusqueda
    try {
      r = estadoDe(await this.transporte({ q: c.q, limite }, control.signal))
    } catch {
      r = { estado: 'error_red' }
    } finally {
      opciones.signal?.removeEventListener('abort', alCancelar)
      if (this.enCurso === control) this.enCurso = null
    }

    // Lo que llegó ya se consumió en el servidor: se guarda aunque la pantalla ya no lo quiera, y solo para ESTE usuario.
    if (r.estado === 'ok' && this.vida > 0 && this.identidad() === usuario && this.usuarioCache === usuario) this.guardar(clave, r.clientes)
    if (control.signal.aborted || mio !== this.turno) return { estado: 'cancelada' }
    if (this.identidad() !== usuario) return { estado: 'cancelada' }   // la sesión cambió mientras se esperaba: no se entrega
    return r
  }

  private guardar(clave: string, clientes: ClienteBusqueda[]): void {
    this.cache.delete(clave)
    this.cache.set(clave, { clientes: clientes.map((x) => ({ ...x })), hasta: this.ahora() + this.vida })
    while (this.cache.size > this.max) { const vieja = this.cache.keys().next().value; if (vieja === undefined) break; this.cache.delete(vieja) }
  }
}

/** Textos para la pantalla, por estado. No dependen de mensajes del servidor. */
export function mensajeBusqueda(estado: Exclude<EstadoBusqueda, 'ok' | 'cancelada'>): string {
  switch (estado) {
    case 'entrada_invalida': return 'Escribe al menos 3 letras del nombre, o los últimos 4 dígitos del teléfono.'
    case 'no_autenticado': return 'Tu sesión terminó. Vuelve a iniciar sesión.'
    case 'sin_autorizacion': return 'No tienes acceso a la búsqueda de clientes.'
    case 'cuota_excedida': return 'Alcanzaste el límite de búsquedas. Espera un momento o pide apoyo a Dirección.'
    case 'error_red': return 'No hay conexión con el servidor. Intenta de nuevo.'
    case 'error_servidor': return 'No se pudo completar la búsqueda. Intenta de nuevo.'
  }
}
