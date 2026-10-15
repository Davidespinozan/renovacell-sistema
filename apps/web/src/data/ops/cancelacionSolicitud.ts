// CANCELACIÓN (migración 162) · solicitudes de cancelar un pedido. Vendedor, almacén, empaque y facturación SOLICITAN
// con motivo; Dirección aprueba (el servidor cancela con cancelar_pedido) o rechaza con nota. Se lee con RLS (quien ve
// el pedido); se escribe solo con los comandos. Un solo almacén en memoria para que todas las pantallas coincidan.
import { useSyncExternalStore } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import { reloadOrders } from '../store/ordersStore'

export interface SolicitudCancelacion { id: string; order_id: string; requester_role: string; reason: string; created_at: string }
export type Resultado = { ok: true } | { ok: false; mensaje: string }

export const ROL_SOLICITA: Record<string, string> = { pos: 'Ventas', warehouse: 'Almacén', packing: 'Empaque', billing: 'Facturación' }

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

let pendientes: SolicitudCancelacion[] = []
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())

export async function recargarSolicitudes(): Promise<void> {
  if (!hasSupabase) return
  const { data, error } = await supabase.from('order_cancel_requests').select('id, order_id, requester_role, reason, created_at').eq('status', 'pendiente').order('created_at', { ascending: false })
  if (error) return
  pendientes = (data ?? []) as SolicitudCancelacion[]
  avisar()
}

let cargado = false
export function useSolicitudesCancelacion(): SolicitudCancelacion[] {
  if (!cargado) { cargado = true; void recargarSolicitudes() }
  return useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => pendientes, () => pendientes)
}
export const solicitudDe = (lista: SolicitudCancelacion[], orderId: string) => lista.find((s) => s.order_id === orderId) ?? null

const MENSAJES: Array<[RegExp, string]> = [
  [/MOTIVO_REQUERIDO/, 'Escribe el motivo (al menos 5 letras).'],
  [/USAR_DEVOLUCION/, 'El pedido ya salió: registra una devolución en lugar de cancelar.'],
  [/ESTADO_INVALIDO/, 'Este pedido ya no se puede cancelar.'],
  [/PEDIDO_INEXISTENTE/, 'No tienes acceso a este pedido.'],
  [/NOTA_REQUERIDA/, 'Escribe por qué no se cancela.'],
  [/GUIA_ACTIVA/, 'El pedido tiene una guía activa: anúlala primero en Guías.'],
  [/NO_AUTORIZADO/, 'Tu rol no puede hacer esto.'],
]
const traducir = (m?: string): string => MENSAJES.find(([r]) => r.test(m ?? ''))?.[1] ?? 'No se pudo completar. Intenta de nuevo.'

export async function solicitarCancelacion(orderId: string, motivo: string): Promise<Resultado> {
  if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  const { error } = await rpc('solicitar_cancelacion', { p_order: orderId, p_reason: motivo.trim() })
  if (error) return { ok: false, mensaje: traducir(error.message) }
  await recargarSolicitudes(); return { ok: true }
}

export async function resolverSolicitud(id: string, aprobar: boolean, nota: string | null): Promise<Resultado> {
  if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  const { error } = await rpc('resolver_solicitud_cancelacion', { p_request: id, p_aprobar: aprobar, p_nota: nota?.trim() || null })
  if (error) return { ok: false, mensaje: traducir(error.message) }
  await recargarSolicitudes(); reloadOrders(); return { ok: true }
}
