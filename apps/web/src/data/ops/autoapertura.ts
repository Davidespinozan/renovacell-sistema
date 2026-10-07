// Chat V2-C4 · AUTO-APERTURA REACTIVA del chat flotante del doctor (solo presentación; nunca autoridad).
// Una FRONTERA por conversación (F = máximo seq ya observado/consumido/descartado) decide si una lectura del
// lanzador trae actividad genuinamente nueva. Sin backend: usa lo que ya devuelve `leer` (seq monótono por
// conversación, actor, propio, modo, sesión). Persistencia: sessionStorage (sobrevive recarga/remontaje en la
// pestaña y muere con ella), aislada por conversation_id (cada conversación tiene un solo dueño).
import type { Conversacion, Mensaje } from './chat'

export type LecturaC4 = Pick<Conversacion, 'ultimo_seq' | 'leido_hasta' | 'modo' | 'sesion' | 'mensajes'>

/**
 * ¿Este mensaje amerita abrir el chat? Solo actividad ajena de la SESIÓN ABIERTA:
 *  · asesor (seller) o Dirección (admin) escribiendo;
 *  · respuesta del asistente (ai);
 *  · aviso del sistema con la atención humana ACTIVA (hoy: "X se unió a la conversación").
 * Lo demás (cola, fin, inactividad, expiración, asignación sin mensaje, sesión cerrada) es silencioso.
 */
export function esElegible(m: Pick<Mensaje, 'seq' | 'actor' | 'propio'>, l: Pick<LecturaC4, 'modo' | 'sesion'>): boolean {
  if (m.propio) return false
  const s = l.sesion
  if (!s || s.estado !== 'abierta') return false
  if (s.first_seq != null && m.seq < s.first_seq) return false
  if (m.actor === 'seller' || m.actor === 'admin' || m.actor === 'ai') return true
  return m.actor === 'system' && l.modo === 'human_active'
}

/** Máximo seq elegible posterior a la frontera y al cursor de lectura; null si no hay nada nuevo. */
export function actividadNueva(l: LecturaC4, f: number): number | null {
  const piso = Math.max(f, l.leido_hasta ?? 0)
  let max: number | null = null
  for (const m of l.mensajes) if (m.seq > piso && esElegible(m, l) && (max === null || m.seq > max)) max = m.seq
  return max
}

export type MotivoDecision = 'linea_base' | 'absorber' | 'abrir' | 'diferir' | 'nada'
export interface DecisionC4 { abrir: boolean; frontera: number; motivo: MotivoDecision }

/**
 * Una decisión por lectura del lanzador (cajón cerrado):
 *  · sin frontera → línea base = ultimo_seq, SIN abrir (lo no leído antiguo conserva el badge);
 *  · tras un cierre manual → absorbe todo lo existente (F = ultimo_seq), SIN abrir;
 *  · actividad nueva + interacción crítica → difiere (F no se mueve; se reintenta en el siguiente tick);
 *  · actividad nueva → abre UNA vez y F = máximo seq que la provocó (varios eventos, una apertura).
 */
export function decidir(p: { lectura: LecturaC4; frontera: number | null; descartar: boolean; diferir: boolean }): DecisionC4 {
  const ult = Math.max(0, p.lectura.ultimo_seq ?? 0)
  if (p.frontera === null) return { abrir: false, frontera: ult, motivo: 'linea_base' }
  const f = Math.min(p.frontera, ult)   // el seq nunca retrocede; una F mayor sería ajena o inválida
  if (p.descartar) return { abrir: false, frontera: Math.max(f, ult), motivo: 'absorber' }
  const nueva = actividadNueva(p.lectura, f)
  if (nueva === null) return { abrir: false, frontera: f, motivo: 'nada' }
  if (p.diferir) return { abrir: false, frontera: f, motivo: 'diferir' }
  return { abrir: true, frontera: Math.max(f, nueva), motivo: 'abrir' }
}

// ── Persistencia (sessionStorage, por conversación) ───────────────────────────────────────────────────
export const claveC4 = (conversationId: string) => `rc_c4:${conversationId}`
export function leerFrontera(conversationId: string): number | null {
  try {
    const raw = sessionStorage.getItem(claveC4(conversationId))
    if (!raw) return null
    const f = (JSON.parse(raw) as { f?: unknown }).f
    return typeof f === 'number' && Number.isInteger(f) && f >= 0 ? f : null
  } catch { return null }
}
export function guardarFrontera(conversationId: string, f: number): void {
  try { sessionStorage.setItem(claveC4(conversationId), JSON.stringify({ f })) } catch { /* sin storage: solo memoria */ }
}

// ── Interacción crítica: no abrir encima de un modal/hoja, con la pestaña oculta o mientras se escribe ──
export function debeDiferir(doc: Document = document): boolean {
  if (doc.visibilityState === 'hidden') return true
  if (doc.querySelector('.overlay, .sheet-wrap')) return true
  const a = doc.activeElement as HTMLElement | null
  if (!a || a === doc.body || a.closest('.chat-drawer')) return false
  const tag = a.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable
}
