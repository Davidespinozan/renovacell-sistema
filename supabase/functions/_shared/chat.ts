// CC-2 · Lógica PURA de la conversación canónica (sin Deno, sin supabase): derivar el actor
// desde la identidad resuelta por el servidor, acotar el contenido, mapear errores de la
// base a respuestas controladas y armar el contexto reciente para el adaptador de IA.
// La autoridad vive en la base (cc_*); aquí no se decide nada de permisos.

export type ActorChat = 'visitor' | 'doctor' | 'seller' | 'admin'
export const MAX_CONTENIDO = 4000
export const MAX_CLIENT_ID = 80

/** El actor lo fija el servidor: perfil del JWT → rol; sin JWT → visitante (si trae token válido). */
export function derivarActor(quien: { uid: string; role: string } | null, hashVisitante: string | null): { actor: ActorChat; profile: string | null } | null {
  if (quien) {
    if (quien.role === 'doctor') return { actor: 'doctor', profile: quien.uid }
    if (quien.role === 'admin') return { actor: 'admin', profile: quien.uid }
    if (quien.role === 'pos' || quien.role === 'billing' || quien.role === 'comm') return { actor: 'seller', profile: quien.uid }
    return null   // almacén/chofer/packing: sin papel en la conversación comercial
  }
  if (hashVisitante) return { actor: 'visitor', profile: null }
  return null
}

export function validarContenido(entrada: unknown): { ok: true; texto: string } | { ok: false; error: string } {
  if (typeof entrada !== 'string') return { ok: false, error: 'contenido_invalido' }
  // Se conserva el texto tal cual (sin regex "sanitizadoras" que mutilen contenido legítimo);
  // solo se normalizan los saltos de línea y se recorta el borde. El escape HTML es del render.
  const texto = entrada.replace(/\r\n?/g, '\n').trim()
  if (!texto) return { ok: false, error: 'contenido_vacio' }
  if (texto.length > MAX_CONTENIDO) return { ok: false, error: 'contenido_largo' }
  return { ok: true, texto }
}

export function validarClientId(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const t = entrada.trim()
  return t && t.length <= MAX_CLIENT_ID && /^[A-Za-z0-9:_.-]+$/.test(t) ? t : null
}

// Errores de la base → HTTP controlado. Nunca se devuelve el texto SQL ni contenido.
export function mapearErrorChat(mensaje: string | undefined): { status: number; body: { error: string; message: string } } {
  const m = mensaje ?? ''
  const r = (status: number, error: string, message: string) => ({ status, body: { error, message } })
  if (/SESION_INVALIDA/.test(m)) return r(400, 'sesion_invalida', 'La sesión de visitante no es válida.')
  if (/CUENTA_SUSPENDIDA/.test(m)) return r(403, 'CUENTA_SUSPENDIDA', 'Tu acceso fue suspendido por Dirección.')
  if (/NO_AUTORIZADO/.test(m)) return r(403, 'no_autorizado', 'No tienes acceso a esta conversación.')
  if (/IA_SILENCIADA/.test(m)) return r(409, 'ia_silenciada', 'Un asesor atiende esta conversación.')
  if (/ASESORIA_NO_INICIADA/.test(m)) return r(409, 'asesoria_no_iniciada', 'Inicia la asesoría antes de escribir.')
  if (/IDEMPOTENCIA_CONFLICTO/.test(m)) return r(409, 'idempotencia_conflicto', 'Ese identificador de mensaje ya se usó con otro contenido.')
  if (/YA_ASIGNADA/.test(m)) return r(409, 'ya_asignada', 'Otro asesor ya tomó esta conversación.')
  if (/YA_HAY_ABIERTA/.test(m)) return r(409, 'ya_hay_abierta', 'Ya tienes una conversación abierta.')
  if (/TRANSICION_INVALIDA/.test(m)) return r(409, 'transicion_invalida', 'Esa acción no corresponde al estado actual.')
  if (/CONVERSACION_CERRADA/.test(m)) return r(409, 'conversacion_cerrada', 'La conversación está cerrada.')
  if (/ASESOR_INVALIDO/.test(m)) return r(400, 'asesor_invalido', 'Ese usuario no puede atender conversaciones.')
  if (/CONTENIDO_VACIO|CONTENIDO_LARGO|ACTOR_INVALIDO/.test(m)) return r(400, 'contenido_invalido', 'El mensaje no es válido.')
  return r(503, 'no_disponible', 'No se pudo completar la operación. Intenta más tarde.')
}

// ¿El modo permite que la IA escriba? (espejo de la regla de la base; la base manda).
export const IA_PUEDE = (modo: string): boolean => modo === 'ai_active' || modo === 'human_offered' || modo === 'human_requested'

// Contexto reciente para el adaptador de IA: solo texto y rol, últimos N turnos, sin ids ni hashes.
export function historialParaIA(mensajes: Array<{ actor: string; content: string }>, maximo = 12): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const m of mensajes) {
    if (m.actor === 'system') continue
    const role: 'user' | 'assistant' = m.actor === 'ai' ? 'assistant' : 'user'
    const content = String(m.content ?? '').slice(0, 4000)
    if (!content) continue
    // Anthropic exige alternancia; se funden turnos consecutivos del mismo lado.
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content
    else out.push({ role, content })
  }
  const recorte = out.slice(-maximo)
  while (recorte.length && recorte[0].role !== 'user') recorte.shift()
  return recorte
}
