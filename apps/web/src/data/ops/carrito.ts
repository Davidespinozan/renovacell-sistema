// CC-5 · Cliente del carrito canónico. Todo pasa por la Edge `cart`: sin sesión se identifica con
// el token de visitante (CC-1); con sesión, el JWT manda. El cliente NUNCA manda precio, descuento,
// lista, profile_id ni seller. Cada mutación lleva un operation_id generado aquí (idempotencia).
import { hasSupabase, supabase } from '../../lib/supabase'
import { leerTokenVisitante } from './visitante'

export type EstadoPrecio = 'autorizado' | 'requiere_verificacion' | 'sin_precio'
export interface ItemCarrito {
  product_id: string; nombre: string; presentacion: string | null; imagen_url: string | null; cantidad: number; vendible: boolean; visible: boolean
  disponibilidad: 'disponible' | 'no_disponible' | 'no_vendible' | 'requiere_verificacion' | string
  precio: { estado: EstadoPrecio; unitario?: number; subtotal?: number; por_volumen?: boolean; moneda?: string; motivo?: string }
}
export interface Carrito {
  cart_id: string; estado: 'active' | 'merged' | 'closed' | 'converted'; rev: number; dueno: 'visitor' | 'profile'; audiencia: string; puede_precio: boolean
  conversation_id: string | null; items: ItemCarrito[]; n_items: number; cantidad_total: number
  total: { estado: 'vacio' | 'requiere_verificacion' | 'completo' | 'parcial'; monto?: number; moneda?: string }
  oferta_asesor?: { estado: 'ofrecida' | 'aceptada' | 'rechazada' | null; siguiente_at: string | null }; rol?: 'dueno' | 'asesor' | 'supervisor'
  handoff?: { estado: 'solicitado' | 'pendiente' | 'rechazado' | null; at: string | null }   // CC-7
}
export interface Mutacion { cart_id: string; accion: string; qty_antes: number; qty_despues: number; n_items: number; rev: number; idempotente: boolean; handoff?: { estado: string; fuera_horario?: boolean; asignado?: boolean } | null }
export interface Preparacion { cart_id: string; listo: boolean; problemas: Array<string | { product_id: string; problema: string }>; proyeccion: Carrito; lineas_crear_pedido: Array<{ product_id: string; qty: number }> }
export interface RevisionCheckout {
  listo: boolean; cart_id: string; cart_rev?: number; review_id?: string; expires_at?: string; total?: number; moneda?: string
  lineas?: Array<{ product_id: string; qty: number; nombre: string; precio_unitario: number; subtotal: number }>
  direccion?: { location_id: string; nombre?: string; address: { line1: string; colonia?: string; cp?: string; city?: string; state?: string } } | null
  problemas: Array<string | { product_id: string; problema: string }>; proyeccion?: Carrito; order_id?: string
}
export interface ResultadoCheckout {
  confirmado: boolean; idempotente?: boolean; motivo?: string; cart_id: string; order_id?: string; folio?: string; status?: string; total?: number; moneda?: string
  estado_pago?: string; saldo?: number; acciones_pago?: string[]; created_at?: string; total_revisado?: number; total_actual?: number
  problemas?: Array<string | { product_id: string; problema: string }>; proyeccion?: Carrito; cart_rev?: number
}
export type ErrorCarrito = { codigo: string; mensaje: string }
export interface DireccionSnapshot { line1: string; colonia?: string; cp?: string; city?: string; state?: string; refs?: string; phone?: string }
type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

export function nuevaOperacion(): string {
  try { return 'k:' + crypto.randomUUID() } catch { return 'k:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) }
}
async function leerError(error: unknown): Promise<ErrorCarrito> {
  try {
    const ctx = (error as { context?: Response }).context
    if (ctx) { const b = (await ctx.json()) as { error?: string; message?: string }; return { codigo: b.error ?? 'error', mensaje: b.message ?? 'No se pudo completar.' } }
  } catch { /* sin detalle */ }
  return { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' }
}

export class ClienteCarrito {
  constructor(private invocar: Invocar = invocarPorDefecto, private token: () => string | null = leerTokenVisitante) {}
  private async llamar<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: ErrorCarrito }> {
    if (!hasSupabase && this.invocar === invocarPorDefecto) return { ok: false, error: { codigo: 'sin_backend', mensaje: 'El carrito requiere conexión con el servidor.' } }
    try {
      const { data, error } = await this.invocar('cart', { body: { ...body, token: this.token() } })
      if (error) return { ok: false, error: await leerError(error) }
      return { ok: true, data: data as T }
    } catch { return { ok: false, error: { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } } }
  }
  abrir(conversation_id?: string | null) { return this.llamar<Carrito>({ action: 'abrir', conversation_id: conversation_id ?? null }) }
  ver(cart_id: string) { return this.llamar<Carrito>({ action: 'ver', cart_id }) }
  agregar(cart_id: string, product_id: string, cantidad = 1, operation_id = nuevaOperacion()) { return this.llamar<Mutacion>({ action: 'agregar', cart_id, product_id, cantidad, operation_id }) }
  actualizar(cart_id: string, product_id: string, cantidad: number, operation_id = nuevaOperacion()) { return this.llamar<Mutacion>({ action: 'actualizar', cart_id, product_id, cantidad, operation_id }) }
  quitar(cart_id: string, product_id: string, operation_id = nuevaOperacion()) { return this.llamar<Mutacion>({ action: 'quitar', cart_id, product_id, operation_id }) }
  vaciar(cart_id: string, operation_id = nuevaOperacion()) { return this.llamar<Mutacion>({ action: 'vaciar', cart_id, operation_id }) }
  prepararCheckout(cart_id: string) { return this.llamar<Preparacion>({ action: 'preparar_checkout', cart_id }) }
  // CC-6 · el cliente manda SOLO cart_id/location_id para revisar y review_id/operation_id/expected_cart_rev para confirmar.
  // CC-7 · el Catálogo puede mandar el snapshot de dirección elegido (sin location registrada) y la intención de factura.
  revisarCheckout(cart_id: string, location_id?: string | null, direccion?: DireccionSnapshot | null) { return this.llamar<RevisionCheckout>({ action: 'revisar_checkout', cart_id, location_id: location_id ?? null, direccion: location_id ? null : direccion ?? null }) }
  confirmarCheckout(review_id: string, expected_cart_rev: number, operation_id = nuevaOperacion(), factura = false) { return this.llamar<ResultadoCheckout>({ action: 'confirmar_checkout', review_id, operation_id, expected_cart_rev, factura }) }
}
export const carrito = new ClienteCarrito()

export const ETIQUETA_DISPONIBILIDAD: Record<string, string> = { disponible: 'Disponible', no_disponible: 'Sin disponibilidad', no_vendible: 'No disponible', requiere_verificacion: 'Al verificar tu cuenta' }
export const formatoMXN = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)
// Etiquetas de problemas/rechazos del checkout (compartidas por el panel del chat y el Catálogo).
export const ETIQUETA_PROBLEMA: Record<string, string> = { REQUIERE_CUENTA: 'crea tu cuenta', REQUIERE_VERIFICACION: 'verifica tu cédula', CARRITO_VACIO: 'el carrito está vacío', CARRITO_CERRADO: 'carrito cerrado', NO_VENDIBLE: 'ya no está disponible', SIN_PRECIO: 'precio por confirmar', SIN_DISPONIBILIDAD: 'sin existencia ahora', REQUIERE_DIRECCION: 'registra una dirección de entrega en tu perfil', YA_CONVERTIDO: 'este carrito ya es un pedido', CANTIDAD_INVALIDA: 'cantidad no válida' }
export const ETIQUETA_MOTIVO: Record<string, string> = { CARRITO_CAMBIO: 'Tu carrito cambió después de revisarlo.', PRECIO_CAMBIO: 'El precio cambió después de revisarlo.', REVISION_EXPIRADA: 'La revisión venció.', REVISION_CONSUMIDA: 'Esa revisión ya se usó.', NO_LISTO: 'Algo cambió en la disponibilidad o en los productos.' }
/** Texto legible de los problemas de una revisión (sin códigos internos). */
export function textoProblemas(problemas: Array<string | { product_id: string; problema: string }>, nombre: (id: string) => string = () => 'producto'): string {
  return problemas.map((x) => (typeof x === 'string' ? ETIQUETA_PROBLEMA[x] ?? x : `${nombre(x.product_id)}: ${ETIQUETA_PROBLEMA[x.problema] ?? x.problema}`)).join(' · ')
}
