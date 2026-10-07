// CC-2 · Cliente de la conversación canónica. Todo pasa por la Edge `chat`: sin sesión se
// identifica con el token de visitante (CC-1); con sesión, el JWT manda. El cliente NUNCA
// manda actor_type, actor_id, profile_id ni seller_profile_id: eso lo deriva el servidor.
// Idempotencia: cada envío lleva un client_message_id generado aquí, así un reintento no
// duplica. Transporte = polling acotado (realtime queda documentado para después).
import { hasSupabase, supabase } from '../../lib/supabase'
import { leerTokenVisitante } from './visitante'
import type { Atencion } from './atencionComercial'

export type ModoConversacion = 'ai_active' | 'human_offered' | 'human_requested' | 'human_assigned' | 'human_active' | 'human_ended'
export type ActorMensaje = 'visitor' | 'doctor' | 'seller' | 'admin' | 'ai' | 'system'
export interface Mensaje { id: string; seq: number; actor: ActorMensaje; content: string; created_at: string; propio: boolean }
export interface Conversacion {
  conversation_id: string; estado: 'abierta' | 'cerrada'; modo: ModoConversacion; rol?: 'dueno' | 'asesor' | 'supervisor'
  ultimo_seq: number; asesor_nombre?: string | null; asesor_soy_yo?: boolean; mensajes: Mensaje[]
  cart_id?: string | null              // CC-5 · carrito activo del dueño (la Edge chat lo adjunta en `leer`)
  handoff?: EstadoHandoff                // CC-7 · atención humana decidida por el servidor
  leido_hasta?: number                   // UX-1 · cursor de lectura del actor (cc_participants.last_read_seq): el badge del portal no inventa estado
  sesion?: SesionResumen | null          // Chat V2-C1 · la lectura activa es la sesión actual (o la última cerrada si no hay abierta)
}
// Chat V2-C1 · sesión = interacción temporal dentro de la conversación permanente (rango de mensajes).
export interface SesionResumen {
  id: string; ordinal: number; estado: 'abierta' | 'cerrada'; origen: string; first_seq?: number; last_seq?: number | null
  opened_at: string; closed_at: string | null; close_reason: string | null
}
export interface SesionListada extends SesionResumen { actual: boolean; last_activity_at: string; n_mensajes: number; asesor_nombre: string | null }
export interface EstadoHandoff { origen: 'carrito' | 'manual' | null; cart_id: string | null; fuera_horario: boolean | null; asignado: boolean; puede_rechazar: boolean }
export interface ColaItem {
  conversation_id: string; modo: ModoConversacion; seller_profile_id: string | null; asesoria_solicitada_at: string | null; last_message_at: string | null; es_mia: boolean; sin_leer: number; dueno: string
  // CC-7 · contexto comercial (servidor)
  handoff_origen?: 'carrito' | 'manual' | null; fuera_horario?: boolean | null; ruteo_motivo?: string | null; cart_id?: string | null; n_items?: number | null; edad_min?: number | null; iniciada?: boolean
  atencion?: Atencion | null             // CHV2-A · estado derivado del servidor (_cc_atencion); la UI no recalcula esperas
}
export type ErrorChat = { codigo: string; mensaje: string }

type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

export const ETIQUETA_MODO: Record<ModoConversacion, string> = {
  ai_active: 'Asistente', human_offered: 'Asistente', human_requested: 'Esperando asesor', human_assigned: 'Asesor asignado',
  human_active: 'Con asesor', human_ended: 'Asesoría terminada',
}
// CC-7 · la IA sigue hasta que el asesor inicia la sesión (asignado ≠ activo); espejo de _cc_ia_puede.
export const IA_PUEDE = (modo: ModoConversacion): boolean => modo === 'ai_active' || modo === 'human_offered' || modo === 'human_requested' || modo === 'human_assigned'

export function nuevoClientId(): string {
  try { return 'c:' + crypto.randomUUID() } catch { return 'c:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) }
}

async function leerError(error: unknown): Promise<ErrorChat> {
  try {
    const ctx = (error as { context?: Response }).context
    if (ctx) { const b = (await ctx.json()) as { error?: string; message?: string }; return { codigo: b.error ?? 'error', mensaje: b.message ?? 'No se pudo completar.' } }
  } catch { /* sin detalle */ }
  return { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' }
}

export class ClienteChat {
  constructor(private invocar: Invocar = invocarPorDefecto, private token: () => string | null = leerTokenVisitante) {}
  private async llamar<T>(body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: ErrorChat }> {
    if (!hasSupabase && this.invocar === invocarPorDefecto) return { ok: false, error: { codigo: 'sin_backend', mensaje: 'El chat requiere conexión con el servidor.' } }
    try {
      const { data, error } = await this.invocar('chat', { body: { ...body, token: this.token() } })
      if (error) return { ok: false, error: await leerError(error) }
      return { ok: true, data: data as T }
    } catch { return { ok: false, error: { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } } }
  }
  abrir() { return this.llamar<{ conversation_id: string; estado: string; modo: ModoConversacion; nuevo: boolean }>({ action: 'abrir' }) }
  leer(conversation_id: string, desde_seq = 0) { return this.llamar<Conversacion>({ action: 'leer', conversation_id, desde_seq }) }
  enviar(conversation_id: string, content: string, client_message_id = nuevoClientId()) {
    return this.llamar<{ id: string; seq: number; idempotente: boolean; modo: ModoConversacion; ia: string }>({ action: 'enviar', conversation_id, content, client_message_id })
  }
  leido(conversation_id: string, seq: number) { return this.llamar<{ ok: true }>({ action: 'leido', conversation_id, seq }) }
  solicitarAsesor(conversation_id: string) { return this.llamar<{ modo: ModoConversacion; asesor: boolean }>({ action: 'solicitar_asesor', conversation_id }) }
  rechazarAsesor(conversation_id: string) { return this.llamar<{ rechazado: boolean; modo: ModoConversacion; motivo?: string }>({ action: 'rechazar_asesor', conversation_id }) }   // CC-7
  // CC-7 · solo Dirección asigna (la base rechaza a cualquier otro); para doctores la asignación persistente es la cartera.
  asignar(conversation_id: string, seller: string) { return this.llamar<{ modo: ModoConversacion; seller: string | null }>({ action: 'asignar', conversation_id, seller }) }
  liberar(conversation_id: string) { return this.llamar<{ modo: ModoConversacion; seller: string | null }>({ action: 'asignar', conversation_id, seller: null }) }
  iniciar(conversation_id: string) { return this.llamar<{ modo: ModoConversacion }>({ action: 'iniciar', conversation_id }) }
  terminar(conversation_id: string) { return this.llamar<{ modo: ModoConversacion }>({ action: 'terminar', conversation_id }) }
  reanudarIA(conversation_id: string) { return this.llamar<{ modo: ModoConversacion }>({ action: 'reanudar_ia', conversation_id }) }
  cerrar(conversation_id: string) { return this.llamar<{ estado: string }>({ action: 'cerrar', conversation_id }) }
  cola() { return this.llamar<{ cola: ColaItem[] }>({ action: 'cola' }) }
  // Chat V2-C1 · autoridad de historial lista para C3 (sin UI todavía): la base decide quién ve qué.
  sesiones(conversation_id: string) { return this.llamar<{ conversation_id: string; sesiones: SesionListada[] }>({ action: 'sesiones', conversation_id }) }
  leerSesion(session_id: string, desde_seq = 0) { return this.llamar<{ sesion: SesionResumen & { asesor_nombre: string | null }; rol: string; solo_lectura: boolean; mensajes: Mensaje[] }>({ action: 'leer_sesion', session_id, desde_seq }) }
}

export const chat = new ClienteChat()
