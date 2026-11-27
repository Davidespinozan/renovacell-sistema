// PAGO A PROVEEDOR CON SUS DATOS (27 nov 2026, dueño: «al momento de pagar a proveedor hay que hacer mejor captura de
// datos de cómo se pagó y de qué banco se pagó»). Antes «Marcar pagado» solo ponía la compra como pagada, sin datos.
// Ahora se captura forma, cuenta de la empresa, banco del proveedor, referencia, fecha y notas; el servidor
// (`compra_registrar_pago`) valida, guarda y marca la compra pagada en una sola operación.
import { hasSupabase, supabase } from '../../lib/supabase'

export type FormaPagoProveedor = 'transferencia' | 'efectivo' | 'tarjeta' | 'cheque' | 'otro'
export const FORMAS_PAGO_PROVEEDOR: Array<{ key: FormaPagoProveedor; label: string }> = [
  { key: 'transferencia', label: 'Transferencia' }, { key: 'efectivo', label: 'Efectivo' }, { key: 'tarjeta', label: 'Tarjeta' },
  { key: 'cheque', label: 'Cheque' }, { key: 'otro', label: 'Otra' },
]
export const NOMBRE_FORMA: Record<FormaPagoProveedor, string> = Object.fromEntries(FORMAS_PAGO_PROVEEDOR.map((f) => [f.key, f.label])) as Record<FormaPagoProveedor, string>
export const pideCuenta = (f: FormaPagoProveedor): boolean => f === 'transferencia' || f === 'tarjeta' || f === 'cheque'
export const pideReferencia = (f: FormaPagoProveedor): boolean => f === 'transferencia' || f === 'cheque'

export interface CapturaPago { forma: FormaPagoProveedor | ''; cuentaId: string; fecha: string; referencia: string; bancoProveedor: string; notas: string }
export interface PagoProveedor { compra: string; monto: number; forma: FormaPagoProveedor; cuenta: string | null; banco_proveedor: string | null; referencia: string | null; fecha: string; notas: string | null; registro: string; registrado_at: string }

/** Lo que falta para poder registrar el pago, en palabras; null si está completo. Mismas reglas que el servidor. */
export function faltaEnPago(c: CapturaPago, hoy: string): string | null {
  if (!c.forma) return 'Elige cómo se pagó.'
  if (pideCuenta(c.forma) && !c.cuentaId) return 'Elige de qué cuenta de la empresa salió el pago.'
  if (pideReferencia(c.forma) && !c.referencia.trim()) return c.forma === 'cheque' ? 'Escribe el número de cheque.' : 'Escribe la referencia o folio de la transferencia.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) return 'Escribe la fecha del pago.'
  if (c.fecha > hoy) return 'La fecha del pago no puede ser futura.'
  return null
}

const limpio = (m: string | undefined) => { const t = (m ?? '').replace(/^[A-Z_]+:\s*/, '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudo registrar el pago.' }

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function registrarPagoProveedor(compraId: string, c: CapturaPago, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!c.forma) return { ok: false, error: 'Elige cómo se pagó.' }
  try {
    const { error } = await rpc('compra_registrar_pago', { p_compra: compraId, p_forma: c.forma, p_cuenta: c.cuentaId || null, p_fecha: c.fecha, p_referencia: c.referencia.trim() || null, p_banco_proveedor: c.bancoProveedor.trim() || null, p_notas: c.notas.trim() || null })
    if (error) return { ok: false, error: limpio(error.message) }
    return { ok: true }
  } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
}

export async function leerPagosProveedor(compras: string[], rpc: Rpc = rpcPorDefecto): Promise<PagoProveedor[]> {
  if ((!hasSupabase && rpc === rpcPorDefecto) || compras.length === 0) return []
  try {
    const { data, error } = await rpc('compra_pagos_ver', { p_compras: compras })
    return error || !Array.isArray(data) ? [] : (data as PagoProveedor[])
  } catch { return [] }
}

/** «Transferencia · Scotiabank · 9474 · ref SPEI 123 · 27 nov» */
export function resumenPago(p: PagoProveedor): string {
  const [a, m, d] = p.fecha.split('-').map(Number)
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return [NOMBRE_FORMA[p.forma] ?? p.forma, p.cuenta ? `desde ${p.cuenta}` : '', p.banco_proveedor ? `a ${p.banco_proveedor}` : '', p.referencia ? `ref ${p.referencia}` : '', `${d} ${MES[m - 1]} ${a}`].filter(Boolean).join(' · ')
}
