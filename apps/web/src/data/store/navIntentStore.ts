// CHV2-B · Intención de navegación profunda: "abre ESTA conversación en Conversaciones" o "muestra ESTA
// solicitud en Atención comercial". Solo lleva un identificador; la pantalla destino decide con el
// servidor: abre únicamente si la conversación aparece en SU cola/pendientes autorizados (RLS). Un id
// ajeno o resuelto no revela nada: se informa que ya no está disponible.
import { useSyncExternalStore } from 'react'

export type DestinoIntento = 'asesorias' | 'av_atencion'
export interface Intento {
  id: number
  destino: DestinoIntento
  conversationId: string
  iniciar?: boolean      // "Atender ahora": usar el comando canónico de inicio (cc_iniciar_asesoria)
  reasignar?: boolean    // Dirección: abrir directamente "Reasignar esta solicitud"
  origen: 'inicio' | 'alerta' | 'campana' | 'bandeja' | 'atencion'
}

let actual: Intento | null = null
let seq = 0
const oyentes = new Set<() => void>()
const emitir = () => oyentes.forEach((l) => l())

export function pedirIntento(i: Omit<Intento, 'id'>): Intento {
  seq += 1
  actual = { ...i, id: seq }
  emitir()
  return actual
}
/** La pantalla destino lo consume una sola vez. */
export function consumirIntento(id: number) { if (actual?.id === id) { actual = null; emitir() } }
export const intentoActual = (): Intento | null => actual

export function useIntento(destino: DestinoIntento): Intento | null {
  const i = useSyncExternalStore((cb) => { oyentes.add(cb); return () => { oyentes.delete(cb) } }, intentoActual, intentoActual)
  return i && i.destino === destino ? i : null
}

/** Abre la conversación exacta en Conversaciones (la pantalla valida contra SU cola autorizada). */
export function irAConversacion(setScreen: (s: string) => void, conversationId: string, opts: { iniciar?: boolean; origen: Intento['origen'] }) {
  pedirIntento({ destino: 'asesorias', conversationId, iniciar: opts.iniciar, origen: opts.origen })
  setScreen('asesorias')
}
/** Dirección: muestra la solicitud en Atención comercial (opcionalmente con "Reasignar" abierto). */
export function irASolicitud(setScreen: (s: string) => void, conversationId: string, opts: { reasignar?: boolean; origen: Intento['origen'] }) {
  pedirIntento({ destino: 'av_atencion', conversationId, reasignar: opts.reasignar, origen: opts.origen })
  setScreen('av_atencion')
}
