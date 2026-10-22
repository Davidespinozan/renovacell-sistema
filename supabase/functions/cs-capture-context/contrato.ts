// CS-1A.3 · Flex Microform v2 · contrato del Capture Context (puro, sin Deno ni red; probado desde vitest).
//
// Request oficial (POST /microform/v2/sessions; muestra oficial GenerateCaptureContextAcceptCard.cs):
//   { clientVersion: 'v2', targetOrigins: [...], allowedCardNetworks: [...], allowedPaymentTypes: ['CARD'] }
// Respuesta: un JWT en TEXTO (el capture context). Su payload trae `exp` y `ctx[0].data.{clientLibrary, clientLibraryIntegrity,
// targetOrigins}`; el navegador debe cargar la librería desde ESA URL con ESA integridad (nunca hardcodeadas: cambian por transacción).

/** Redes aceptadas en México para la afiliación de BanBajío (AMEX y CARNET quedan sujetas a confirmación del banco). */
export const REDES_TARJETA_CS: readonly string[] = ['VISA', 'MASTERCARD', 'AMEX', 'CARNET']

export interface CaptureContextRequest { clientVersion: 'v2'; targetOrigins: string[]; allowedCardNetworks: string[]; allowedPaymentTypes: ['CARD'] }

/** Un solo origen: el de la página que pidió el contexto (ya validado contra la lista blanca de CORS). */
export function buildCaptureContextRequest(origen: string): CaptureContextRequest {
  if (!/^https:\/\/[^\s/]+$/.test(origen) && !/^http:\/\/localhost(:\d+)?$/.test(origen)) throw new Error('origen inválido')
  return { clientVersion: 'v2', targetOrigins: [origen], allowedCardNetworks: [...REDES_TARJETA_CS], allowedPaymentTypes: ['CARD'] }
}

export interface CaptureContextInfo { exp: Date; clientLibrary: string; clientLibraryIntegrity: string; targetOrigins: string[] }
export type LecturaCaptureContext = { ok: true; info: CaptureContextInfo } | { ok: false; motivo: 'no_jwt' | 'payload_invalido' | 'sin_libreria' | 'libreria_no_cybersource' | 'sin_expiracion' | 'expirado' | 'origen_distinto' }

function base64UrlJson(parte: string): unknown {
  const b = parte.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b + '='.repeat((4 - (b.length % 4)) % 4)
  const bin = atob(pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** Lee el payload del capture context (sin verificar firma: llegó por TLS desde CyberSource y el navegador la valida al cargar Flex). */
export function leerCaptureContext(jwt: string, origenEsperado: string, ahora: Date = new Date()): LecturaCaptureContext {
  const partes = (jwt ?? '').trim().split('.')
  if (partes.length !== 3 || !partes[1]) return { ok: false, motivo: 'no_jwt' }
  let p: Record<string, unknown>
  try { const x = base64UrlJson(partes[1]); if (!x || typeof x !== 'object') return { ok: false, motivo: 'payload_invalido' }; p = x as Record<string, unknown> } catch { return { ok: false, motivo: 'payload_invalido' } }
  const ctx = Array.isArray(p.ctx) ? (p.ctx as Array<Record<string, unknown>>) : []
  const data = (ctx[0]?.data && typeof ctx[0].data === 'object' ? ctx[0].data : {}) as Record<string, unknown>
  const lib = typeof data.clientLibrary === 'string' ? data.clientLibrary : ''
  const integ = typeof data.clientLibraryIntegrity === 'string' ? data.clientLibraryIntegrity : ''
  if (!lib || !integ) return { ok: false, motivo: 'sin_libreria' }
  let host = ''
  try { const u = new URL(lib); host = u.protocol === 'https:' ? u.hostname : '' } catch { host = '' }
  if (!host || !(host === 'cybersource.com' || host.endsWith('.cybersource.com'))) return { ok: false, motivo: 'libreria_no_cybersource' }
  if (typeof p.exp !== 'number') return { ok: false, motivo: 'sin_expiracion' }
  const exp = new Date(p.exp * 1000)
  if (exp.getTime() <= ahora.getTime()) return { ok: false, motivo: 'expirado' }
  const origenes = Array.isArray(data.targetOrigins) ? (data.targetOrigins as unknown[]).filter((o): o is string => typeof o === 'string') : []
  if (origenes.length && !origenes.includes(origenEsperado)) return { ok: false, motivo: 'origen_distinto' }
  return { ok: true, info: { exp, clientLibrary: lib, clientLibraryIntegrity: integ, targetOrigins: origenes } }
}

/** Lo ÚNICO que viaja al navegador. Sin secretos, sin cabeceras firmadas, sin merchant/key id. */
export interface RespuestaCaptureContext {
  attempt_id: string
  amount: number
  currency: 'MXN'
  ambiente: 'test' | 'production'
  capture_context: string
  client_library: string
  client_library_integrity: string
  expires_at: string
  reutilizado: boolean
}
export function respuestaParaNavegador(a: { attempt_id: string; amount: number; ambiente: 'test' | 'production'; reutilizado: boolean }, jwt: string, info: CaptureContextInfo): RespuestaCaptureContext {
  return { attempt_id: a.attempt_id, amount: a.amount, currency: 'MXN', ambiente: a.ambiente, capture_context: jwt,
           client_library: info.clientLibrary, client_library_integrity: info.clientLibraryIntegrity, expires_at: info.exp.toISOString(), reutilizado: a.reutilizado }
}

/** Estados del intento en los que tiene sentido (re)emitir un capture context: antes de cualquier envío al banco. */
export const ESTADOS_REEMISION_CS: readonly string[] = ['created', 'tokenized', 'auth_setup', 'auth_pending', 'auth_challenge', 'auth_validated']

/** Mensajes de operador para los códigos de cs_intento_abrir (el resto se devuelve genérico). */
export const MENSAJES_ABRIR: Record<string, { status: number; error: string; message: string }> = {
  NO_AUTORIZADO: { status: 403, error: 'no_autorizado', message: 'Solo el doctor dueño del pedido, con cuenta verificada, puede pagarlo con tarjeta.' },
  PEDIDO_INEXISTENTE: { status: 404, error: 'pedido_inexistente', message: 'Pedido no encontrado.' },
  PEDIDO_NO_PAGABLE: { status: 409, error: 'pedido_no_pagable', message: 'Ese pedido no admite cobros.' },
  SIN_SALDO: { status: 409, error: 'sin_saldo', message: 'Ese pedido no tiene saldo pendiente.' },
  AMBIENTE_INVALIDO: { status: 500, error: 'ambiente_invalido', message: 'Configuración de pagos inválida.' },
}
export function traducirErrorAbrir(msg: string): { status: number; error: string; message: string } {
  const code = Object.keys(MENSAJES_ABRIR).find((c) => msg.includes(c))
  return code ? MENSAJES_ABRIR[code] : { status: 500, error: 'intento', message: 'No se pudo preparar el pago con tarjeta. Intenta de nuevo.' }
}
