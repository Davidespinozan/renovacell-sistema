// ALTA-DESDE-CONVERSACIÓN · fotos de la conversación elegidas como INE (frente/reverso) para el alta del cliente. Vive en
// memoria por conversación: el chat las marca debajo de cada foto ("Usar como INE…") y el formulario de alta las lee.
// PAGO-DESDE-CONVERSACIÓN · también la foto elegida como comprobante de pago; y si la conversación ya está ligada a una
// ficha (lo publica el panel del cliente), debajo de cada foto se ofrece "comprobante" en lugar de "INE".
import { useSyncExternalStore } from 'react'

export type LadoIne = 'frente' | 'reverso'
export type UsoFoto = LadoIne | 'comprobante'
type Sel = Partial<Record<UsoFoto, string>> & { vinculada?: boolean }
let porConv: Record<string, Sel> = {}
const oyentes = new Set<() => void>()
const emitir = () => { porConv = { ...porConv }; oyentes.forEach((f) => f()) }

export function elegirIne(conv: string, lado: UsoFoto, adjuntoId: string) { porConv[conv] = { ...porConv[conv], [lado]: adjuntoId }; emitir() }
export function olvidarIne(conv: string) {
  const s = porConv[conv]
  if (s && (s.frente || s.reverso)) { porConv[conv] = { vinculada: s.vinculada, comprobante: s.comprobante }; emitir() }
}
export function olvidarComprobante(conv: string) { const s = porConv[conv]; if (s?.comprobante) { porConv[conv] = { ...s, comprobante: undefined }; emitir() } }
export function marcarVinculada(conv: string, vinculada: boolean) { if (!!porConv[conv]?.vinculada !== vinculada) { porConv[conv] = { ...porConv[conv], vinculada }; emitir() } }
export const ineDe = (conv: string): Sel => porConv[conv] ?? {}
export function useIne(conv: string): Sel {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => porConv[conv] ?? VACIO, () => VACIO)
}
const VACIO: Sel = {}
