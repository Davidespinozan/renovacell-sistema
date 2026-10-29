// PAGOS EN LÍNEA · interruptor de Dirección (pagos_config, mig 20270202). Apagado = el portal no ofrece "Tarjeta" y las
// Edges de cobro con tarjeta se niegan; transferencia, efectivo y tarjeta en sucursal siguen igual.
import { useEffect, useSyncExternalStore } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'

export interface PagosConfig { tarjeta_en_linea: boolean; updated_at: string | null }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function verPagosConfig(rpc: Rpc = rpcPorDefecto): Promise<{ ok: true; data: PagosConfig } | { ok: false; error: string }> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: true, data: { tarjeta_en_linea: false, updated_at: null } }
  try {
    const { data, error } = await rpc('pagos_config_ver')
    if (error || !data) return { ok: false, error: 'No se pudo leer la configuración de pagos.' }
    return { ok: true, data: data as PagosConfig }
  } catch { return { ok: false, error: 'No hay conexión con el servidor.' } }
}
export async function guardarPagosConfig(tarjeta: boolean, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true; data: PagosConfig } | { ok: false; error: string }> {
  try {
    const { data, error } = await rpc('pagos_config_guardar', { p_tarjeta_en_linea: tarjeta })
    if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message ?? '') ? 'Solo Dirección cambia los pagos en línea.' : 'No se pudo guardar. Intenta de nuevo.' }
    return { ok: true, data: data as PagosConfig }
  } catch { return { ok: false, error: 'No hay conexión con el servidor.' } }
}

// Estado compartido del portal: mientras no se sabe, se asume APAGADO (nunca se ofrece algo que podría no existir).
let actual: boolean = false
let cargado = false
const subs = new Set<() => void>()
const emitir = () => subs.forEach((f) => f())
export async function recargarPagosEnLinea(): Promise<void> {
  const r = await verPagosConfig()
  actual = r.ok ? r.data.tarjeta_en_linea : false
  cargado = true
  emitir()
}
export function _fijarPagosEnLinea(v: boolean) { actual = v; cargado = true; emitir() }   // pruebas
/** ¿El portal ofrece pagar con tarjeta en línea? (falso mientras carga o si falla la lectura) */
export function useTarjetaEnLinea(): boolean {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => actual, () => false)
  useEffect(() => { if (!cargado) void recargarPagosEnLinea() }, [])
  return v
}
