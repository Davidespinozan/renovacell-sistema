// UX V2-A · Estado de PRESENTACIÓN del chat flotante del doctor. Dueño de una sola cosa: "alguien pidió
// abrir el chat por un motivo". NO es autoridad de la conversación ni del carrito: el servidor decide si
// hubo handoff; aquí solo se transporta su respuesta hasta el lanzador. Sin persistencia de mensajes.
import { useSyncExternalStore } from 'react'
import type { Mutacion } from '../ops/carrito'

export type MotivoApertura = 'first_item_handoff'
export interface SolicitudApertura { id: number; motivo: MotivoApertura; conversationId: string | null; cartId: string; episodio: string }

/**
 * CI-2 · Identidad del EPISODIO comercial confirmado: la mutación del servidor que lo abrió (carrito + rev).
 * CI-1 garantiza un solo aviso NUEVO (no idempotente) por episodio, en una sola mutación; su `rev` es
 * asignado por el servidor y único por mutación. Un episodio posterior del mismo carrito trae otro `rev`.
 */
export const episodioDe = (cartId: string, rev: number): string => `${cartId}:${rev}`

let solicitud: SolicitudApertura | null = null
let contador = 0
const suscriptores = new Set<() => void>()
const avisar = () => { suscriptores.forEach((f) => f()) }

const CLAVE = 'rc_chat_handoff_abierto'
/** ¿Ya se abrió el chat por ESTE episodio en esta pestaña? (presentación; la autoridad es el servidor) */
export function yaAbiertoPara(episodio: string): boolean {
  try { return sessionStorage.getItem(`${CLAVE}:${episodio}`) === '1' } catch { return false }
}
export function marcarAbiertoPara(episodio: string): void {
  try { sessionStorage.setItem(`${CLAVE}:${episodio}`, '1') } catch { /* sin storage: solo dedupe en memoria */ }
}

/**
 * Decide, SOLO a partir de la respuesta del servidor a una mutación del carrito, si acaba de generarse
 * un handoff comercial nuevo. Nunca a partir de cantidades, estado local, polling, vendedor o texto.
 *  · `handoff` null → mutación ordinaria (segundo producto, cantidad, quitar).
 *  · `idempotente` → reintento/replay: ya se avisó la primera vez.
 *  · `ya_en_curso` → había un handoff en curso: no es una transición nueva.
 *  · estado 'pendiente' → el servidor no pudo completarlo todavía: no hay aviso que leer.
 */
export function handoffNuevoDe(m: Mutacion | null | undefined): { conversationId: string | null; cartId: string; episodio: string } | null {
  if (!m || m.idempotente) return null
  const h = m.handoff
  if (!h || h.estado !== 'solicitado' || h.ya_en_curso) return null
  if (!Number.isInteger(m.rev)) return null   // sin identidad del servidor no se inventa una
  return { conversationId: h.conversation_id ?? null, cartId: m.cart_id, episodio: episodioDe(m.cart_id, m.rev) }
}

export const chatUi = {
  subscribe(fn: () => void): () => void { suscriptores.add(fn); return () => { suscriptores.delete(fn) } },
  getSnapshot(): SolicitudApertura | null { return solicitud },
  /** Pide abrir el chat. Devuelve false si ya se abrió por este EPISODIO (no por el carrito). */
  solicitarApertura(s: Omit<SolicitudApertura, 'id'>): boolean {
    if (yaAbiertoPara(s.episodio)) return false
    solicitud = { id: ++contador, ...s }
    avisar()
    return true
  },
  /** El lanzador atendió (o descartó) la solicitud. */
  consumir(id: number): void { if (solicitud?.id === id) { solicitud = null; avisar() } },
  reset(): void { solicitud = null; avisar() },
}

export function useSolicitudApertura(): SolicitudApertura | null {
  return useSyncExternalStore(chatUi.subscribe, chatUi.getSnapshot, chatUi.getSnapshot)
}
