// EXPEDIENTE EN EL CHAT · qué hoja de trabajo está abierta dentro de la conversación (vincular, alta, verificar, pago,
// recibo, acceso…). Vive en memoria por conversación: la abre el menú «+» del redactor o una foto del hilo («Usar como
// comprobante» abre el pago) y la cierra quien la trabaja. Una sola hoja abierta a la vez.
import { useSyncExternalStore } from 'react'

let porConv: Record<string, string | null> = {}
const oyentes = new Set<() => void>()
const emitir = () => { porConv = { ...porConv }; oyentes.forEach((f) => f()) }

export function abrirHoja(conv: string, clave: string) { if (porConv[conv] !== clave) { porConv[conv] = clave; emitir() } }
export function cerrarHoja(conv: string) { if (porConv[conv]) { porConv[conv] = null; emitir() } }
export const hojaDe = (conv: string): string | null => porConv[conv] ?? null
export function useHoja(conv: string): string | null {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => porConv[conv] ?? null, () => null)
}
