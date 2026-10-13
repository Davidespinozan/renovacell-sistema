// PAQ-A · Rastreo de paquetería en el cliente. La paquetería se consulta SIEMPRE en el servidor (Edge `shipping`,
// acción `sync_tracking`): aquí solo se pide "ponlo al día" y se muestra. Neutral al proveedor (DHL hoy; T1 después).
// Si el rastreo aún no está disponible en el servidor (función sin desplegar, sin guía, sin red) se devuelve null y la
// pantalla simplemente no muestra la sección: nunca rompe el pedido ni la guía.
import { hasSupabase, supabase } from '../../lib/supabase'

export type EstadoRastreo = 'sin_eventos' | 'recolectado' | 'en_transito' | 'en_reparto' | 'entregado' | 'incidencia'
export interface EventoRastreo { at: string; codigo: string; descripcion: string; lugar: string | null }
export interface Rastreo {
  estado: EstadoRastreo
  descripcion: string | null
  firmadoPor: string | null
  entregadoAt: string | null
  actualizadoAt: string | null
  eventos: EventoRastreo[]
  aviso: string | null
  cierre: 'cerrado' | 'pendiente' | null
}

const ESTADOS: readonly EstadoRastreo[] = ['sin_eventos', 'recolectado', 'en_transito', 'en_reparto', 'entregado', 'incidencia']
export const ETIQUETA_RASTREO: Record<EstadoRastreo, { label: string; pill: string; cliente: string }> = {
  sin_eventos: { label: 'Guía generada · aún sin movimiento', pill: 'p-warn', cliente: 'Tu paquete está por salir' },
  recolectado: { label: 'Recolectado por la paquetería', pill: 'p-blue', cliente: 'La paquetería ya tiene tu paquete' },
  en_transito: { label: 'En tránsito', pill: 'p-blue', cliente: 'Tu paquete va en camino' },
  en_reparto: { label: 'En reparto', pill: 'p-blue', cliente: 'Tu paquete sale a entrega hoy' },
  entregado: { label: 'Entregado', pill: 'p-ok', cliente: 'Tu paquete fue entregado' },
  incidencia: { label: 'Incidencia en la paquetería', pill: 'p-dang', cliente: 'Hay un detalle con tu envío' },
}

// Lee la respuesta del servidor sin confiar en su forma: cualquier cosa rara ⇒ null (sin rastreo que mostrar).
export function leerRastreo(data: unknown): Rastreo | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const r = d.rastreo as Record<string, unknown> | null | undefined
  if (!r || typeof r !== 'object' || !ESTADOS.includes(r.estado as EstadoRastreo)) return null
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
  const eventos = (Array.isArray(d.eventos) ? d.eventos : []).flatMap((e): EventoRastreo[] => {
    const x = (e ?? {}) as Record<string, unknown>
    const at = str(x.ocurrido_at)
    return at ? [{ at, codigo: str(x.codigo) ?? '', descripcion: str(x.descripcion) ?? '', lugar: str(x.lugar) }] : []
  })
  return {
    estado: r.estado as EstadoRastreo, descripcion: str(r.descripcion), firmadoPor: str(r.firmado_por), entregadoAt: str(r.entregado_at),
    actualizadoAt: str(r.synced_at), eventos, aviso: str(d.aviso), cierre: d.cierre === 'cerrado' || d.cierre === 'pendiente' ? d.cierre : null,
  }
}

type Invocar = (body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (body) => supabase.functions.invoke('shipping', { body }) as Promise<{ data: unknown; error: unknown }>

// Pide al servidor poner al día el rastreo de la guía de un pedido (él decide si consulta a la paquetería o usa lo
// guardado: como mucho una consulta cada 10 min por envío). `forzar` solo lo respeta para logística.
export async function sincronizarRastreo(orderId: string, opts: { forzar?: boolean; invocar?: Invocar } = {}): Promise<Rastreo | null> {
  if (!hasSupabase && !opts.invocar) return null
  try {
    const { data, error } = await (opts.invocar ?? invocarPorDefecto)({ action: 'sync_tracking', order_id: orderId, ...(opts.forzar ? { force: true } : {}) })
    if (error) return null
    return leerRastreo(data)
  } catch { return null }
}
