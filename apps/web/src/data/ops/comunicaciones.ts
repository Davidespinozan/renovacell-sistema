// W4-05 · Comunicación transaccional al cliente — lectura del buzón y sus acciones.
//
// El navegador NO envía correos ni decide qué se le dice al cliente: los mensajes los
// encola la base a partir de hechos del negocio, y el envío lo hace una función de
// servidor. Aquí solo se lee el buzón, se pide despachar y se decide un reintento.
import { hasSupabase, supabase } from '../../lib/supabase'
import { mensajeDeError } from '../store/escritura'

export type EstadoMensaje = 'pendiente' | 'enviando' | 'enviado' | 'fallido' | 'incierto' | 'sin_destinatario'

export interface MensajeCliente {
  id: string
  event_key: string
  plantilla: string
  order_id: string | null
  to_address: string | null
  to_name: string | null
  status: EstadoMensaje
  attempts: number
  last_error: string | null
  sent_at: string | null
  created_at: string
  payload: Record<string, unknown>
}

// La tabla y sus comandos aún no están en `database.types.ts` (se regenera al aplicar la
// migración). Estos dos accesos concentran el tipado manual para retirarlo en un solo lugar.
type Fila = Record<string, unknown>
const tabla = () => (supabase.from as unknown as (t: string) => {
  select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => PromiseLike<{ data: Fila[] | null; error: { message: string } | null }> } }
})('comm_outbox')
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: unknown) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>)(fn, args)

/** Los mensajes más recientes. Acotado: el buzón crece con cada operación. */
export const MENSAJES_VISIBLES = 300

export async function cargarMensajes(): Promise<{ data: MensajeCliente[]; error: string | null }> {
  if (!hasSupabase) return { data: [], error: null }
  const { data, error } = await tabla()
    .select('id, event_key, plantilla, order_id, to_address, to_name, status, attempts, last_error, sent_at, created_at, payload')
    .order('created_at', { ascending: false }).limit(MENSAJES_VISIBLES)
  if (error) return { data: [], error: 'No se pudo cargar el buzón de mensajes.' }
  return { data: (data ?? []) as unknown as MensajeCliente[], error: null }
}

export type Despacho =
  | { ok: true; procesados: number; enviado: number; fallido: number; incierto: number }
  | { ok: false; error: string; noConfigurado: boolean }

/** Pide al servidor que envíe lo pendiente. Si el correo no está activado, lo dice. */
export async function despacharMensajes(): Promise<Despacho> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.', noConfigurado: false }
  const { data, error } = await supabase.functions.invoke('comm-dispatch', { body: {} })
  if (error) {
    let cuerpo: { error?: string; message?: string } = {}
    try { cuerpo = (await (error as { context?: { json?: () => Promise<typeof cuerpo> } })?.context?.json?.()) ?? {} } catch { /* sin cuerpo */ }
    if (cuerpo.error === 'not_configured') {
      return { ok: false, noConfigurado: true,
        error: 'El correo al cliente todavía no está activado. Los mensajes siguen pendientes: no se envió ninguno.' }
    }
    return { ok: false, noConfigurado: false, error: cuerpo.error ?? 'No se pudo contactar al servicio de envío. No se sabe si algún mensaje salió: revisa el buzón.' }
  }
  const d = (data ?? {}) as Record<string, number>
  return { ok: true, procesados: d.procesados ?? 0, enviado: d.enviado ?? 0, fallido: d.fallido ?? 0, incierto: d.incierto ?? 0 }
}

export type Reintento = { ok: true } | { ok: false; error: string; pideConfirmarDuplicado: boolean }

export async function reintentarMensaje(id: string, aceptoPosibleDuplicado = false): Promise<Reintento> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.', pideConfirmarDuplicado: false }
  const { error } = await rpc('comm_reintentar', { p_id: id, p_acepto_posible_duplicado: aceptoPosibleDuplicado })
  if (!error) return { ok: true }
  // El servidor pide una decisión explícita: no se sabe si el correo llegó.
  if (/COMM_POSIBLE_DUPLICADO/.test(error.message)) {
    return { ok: false, pideConfirmarDuplicado: true,
      error: 'No se sabe si este mensaje llegó al cliente. Si lo reenvías, podría recibirlo dos veces.' }
  }
  return { ok: false, pideConfirmarDuplicado: false, error: mensajeDeError(error, 'comando') }
}

export const ESTADO_MENSAJE: Record<EstadoMensaje, { etiqueta: string; tono: 'p-ok' | 'p-warn' | 'p-dang' | 'p-neu'; explica: string }> = {
  pendiente: { etiqueta: 'Por enviar', tono: 'p-neu', explica: 'Está en la cola. Todavía no se ha enviado.' },
  enviando: { etiqueta: 'Enviando', tono: 'p-neu', explica: 'Un envío lo tomó y aún no reporta el resultado.' },
  enviado: { etiqueta: 'Enviado', tono: 'p-ok', explica: 'El proveedor de correo confirmó que lo recibió.' },
  fallido: { etiqueta: 'No se envió', tono: 'p-dang', explica: 'El proveedor lo rechazó. Revisa el correo del cliente y decide si reintentar.' },
  incierto: { etiqueta: 'Sin confirmar', tono: 'p-warn', explica: 'No se sabe si llegó: el envío se cortó antes de la respuesta.' },
  sin_destinatario: { etiqueta: 'Sin correo', tono: 'p-warn', explica: 'El cliente no tiene correo registrado. Captúralo y reintenta.' },
}

export const PLANTILLA_TEXTO: Record<string, string> = {
  pedido_recibido: 'Pedido recibido', pago_recibido: 'Pago recibido', pedido_enviado: 'Pedido en camino',
  pedido_entregado: 'Pedido entregado', pedido_cancelado: 'Pedido cancelado', reembolso_realizado: 'Reembolso realizado',
}

/** Los estados que requieren que una persona haga algo. */
export const requiereAccion = (m: MensajeCliente): boolean =>
  m.status === 'fallido' || m.status === 'incierto' || m.status === 'sin_destinatario'
