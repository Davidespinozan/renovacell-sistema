// ALTA-DESDE-CONVERSACIÓN · fotos de la conversación elegidas como INE (frente/reverso) para el alta del cliente. Vive en
// memoria por conversación: el chat las marca debajo de cada foto ("Usar como INE…") y el formulario de alta las lee.
import { useSyncExternalStore } from 'react'

export type LadoIne = 'frente' | 'reverso'
type Sel = Partial<Record<LadoIne, string>>
let porConv: Record<string, Sel> = {}
const oyentes = new Set<() => void>()
const emitir = () => { porConv = { ...porConv }; oyentes.forEach((f) => f()) }

export function elegirIne(conv: string, lado: LadoIne, adjuntoId: string) { porConv[conv] = { ...porConv[conv], [lado]: adjuntoId }; emitir() }
export function olvidarIne(conv: string) { if (porConv[conv]) { delete porConv[conv]; emitir() } }
export const ineDe = (conv: string): Sel => porConv[conv] ?? {}
export function useIne(conv: string): Sel {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => porConv[conv] ?? VACIO, () => VACIO)
}
const VACIO: Sel = {}
