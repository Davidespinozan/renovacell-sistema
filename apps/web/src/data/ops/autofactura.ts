// AUTOFACTURA POR QR (27 nov 2026) · cliente de la Edge `autofactura` y el dibujo del código QR.
//   · El personal pide el ENLACE de una compra para pintarlo en el recibo y en la remisión.
//   · El cliente, sin sesión, abre el enlace, ve su compra y pide su factura con sus datos fiscales.
// La autoridad es del servidor: la regla del mes y la de la factura global viven en la base.
import { useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import { hasSupabase, supabase } from '../../lib/supabase'
import type { EstadoAutofactura, Receptor } from '../../../../../supabase/functions/_shared/autofactura'

type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

export interface EnlaceFactura { url: string; limite: string }
export interface VistaFactura {
  estado: EstadoAutofactura; mensaje: string; folio: string | null; fecha: string; total: number; limite: string; pagado: boolean
  receptor: { rfc: string; razon_social: string; regimen: string; cp: string; uso_cfdi: string; correo: string | null } | null
}
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string; estado?: string }

async function llamar<T>(body: Record<string, unknown>, invocar: Invocar): Promise<Res<T>> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  try {
    const { data, error } = await invocar('autofactura', { body })
    if (error) {
      try {
        const ctx = (error as { context?: Response }).context
        if (ctx) { const b = (await ctx.json()) as { message?: string; estado?: string }; return { ok: false, mensaje: b.message ?? 'No se pudo completar.', estado: b.estado } }
      } catch { /* sin detalle */ }
      return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' }
    }
    return { ok: true, data: data as T }
  } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
}

export const verFactura = (pedido: string, llave: string, invocar: Invocar = invocarPorDefecto) => llamar<VistaFactura>({ accion: 'ver', pedido, llave }, invocar)
export const pedirFactura = (pedido: string, llave: string, receptor: Receptor, invocar: Invocar = invocarPorDefecto) => llamar<VistaFactura>({ accion: 'solicitar', pedido, llave, receptor }, invocar)

// Enlaces ya pedidos en esta sesión: el recibo se abre varias veces y la llave de una compra no cambia.
const cache = new Map<string, EnlaceFactura>()
export async function enlacesFactura(ids: string[], invocar: Invocar = invocarPorDefecto): Promise<Record<string, EnlaceFactura>> {
  const faltan = [...new Set(ids)].filter((id) => !cache.has(id))
  if (faltan.length) {
    const r = await llamar<{ enlaces: Record<string, EnlaceFactura> }>({ accion: 'enlaces', pedidos: faltan }, invocar)
    if (r.ok) for (const [id, e] of Object.entries(r.data.enlaces ?? {})) cache.set(id, e)
  }
  return Object.fromEntries(ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)!]))
}
export const _olvidarEnlaces = (): void => cache.clear()   // solo pruebas

/** El enlace de UNA compra para pintarlo en su recibo; null mientras llega o si no se pudo (el recibo sale sin QR). */
export function useEnlaceFactura(pedidoId: string | null | undefined, invocar: Invocar = invocarPorDefecto): EnlaceFactura | null {
  const [enlace, setEnlace] = useState<EnlaceFactura | null>(() => (pedidoId ? cache.get(pedidoId) ?? null : null))
  useEffect(() => {
    if (!pedidoId) { setEnlace(null); return }
    let vivo = true
    setEnlace(cache.get(pedidoId) ?? null)
    void enlacesFactura([pedidoId], invocar).then((m) => { if (vivo) setEnlace(m[pedidoId] ?? null) })
    return () => { vivo = false }
  }, [pedidoId, invocar])
  return enlace
}

/** Los módulos oscuros del QR como UN trazo SVG, y cuántos módulos mide por lado. Corrección de errores media. */
export function trazoQR(texto: string): { d: string; lado: number } {
  const qr = qrcode(0, 'M')
  qr.addData(texto)
  qr.make()
  const lado = qr.getModuleCount()
  let d = ''
  for (let f = 0; f < lado; f++) for (let c = 0; c < lado; c++) if (qr.isDark(f, c)) d += `M${c} ${f}h1v1h-1z`
  return { d, lado }
}
