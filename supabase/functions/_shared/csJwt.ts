// CyberSource (BanBajío) · JWT de Flex Microform v2: verificación de firma y lectura del token transitorio · manual BanBajío §3 y §6.
//
// Dos JWT llegan al servidor:
//   · el CAPTURE CONTEXT (respuesta de POST /microform/v2/sessions) — manual §3 «Validación del Contexto de Captura».
//   · el TOKEN TRANSITORIO (lo produce Microform en el navegador y el navegador nos lo reenvía) — manual §6.
// Ambos van firmados RS256 por CyberSource. La llave pública se pide por el `kid` de la cabecera a
// GET /flex/v2/public-keys/{kid} en el MISMO host de la API del ambiente, y se guarda en memoria del proceso (por host+kid).
// Si la firma no cuadra, el JWT se RECHAZA: nunca se usa un jti ni una librería que no vengan firmados por CyberSource.
//
// Del token transitorio se usan solo: `jti` (manual §6: "utilizar el JTI como transient token en todos los llamados rest
// posteriores"), `exp` (15 min; §6.1: al expirar, el cliente debe reiniciar el flujo) y datos NO sensibles de la tarjeta
// (BIN, terminación enmascarada, red detectada) para elegir los campos 3DS por marca. Nunca PAN ni CVV (no vienen en el token).
//
// Puro y sin imports: lo usan las Edges (Deno) y vitest. La obtención de la llave se inyecta (pruebas sin red).

export interface JwtDecodificado { header: Record<string, unknown>; payload: Record<string, unknown>; firmado: string; firma: Uint8Array }

function deBase64Url(parte: string): Uint8Array {
  const b = parte.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4))
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
function jsonDe(parte: string): Record<string, unknown> | null {
  try { const x = JSON.parse(new TextDecoder().decode(deBase64Url(parte))); return x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null } catch { return null }
}

/** Decodifica sin verificar (la verificación es `verificarJwtCS`). null si no es un JWT de 3 partes con JSON válido. */
export function decodificarJwtCS(jwt: string): JwtDecodificado | null {
  const partes = String(jwt ?? '').trim().split('.')
  if (partes.length !== 3 || !partes[0] || !partes[1] || !partes[2]) return null
  const header = jsonDe(partes[0]), payload = jsonDe(partes[1])
  if (!header || !payload) return null
  let firma: Uint8Array
  try { firma = deBase64Url(partes[2]) } catch { return null }
  return { header, payload, firmado: `${partes[0]}.${partes[1]}`, firma }
}

/** Llave pública RSA en formato JWK (lo que devuelve /flex/v2/public-keys/{kid}). */
export interface JwkRsa { kty: string; n: string; e: string; kid?: string; use?: string; alg?: string }
export type ObtenerJwkCS = (kid: string) => Promise<JwkRsa | null>

export type VerificacionJwt = { ok: true; jwt: JwtDecodificado } | { ok: false; motivo: 'no_jwt' | 'alg_no_permitido' | 'sin_kid' | 'sin_llave' | 'firma_invalida' }

/**
 * Verifica RS256 con la llave del `kid`. Solo RS256 (nunca "none" ni HS*: un atacante no puede elegir el algoritmo).
 * WebCrypto rechaza importar una JWK con `use: "enc"` para firmar/verificar; CyberSource publica sus llaves de Flex con
 * use=enc, así que se importa solo el material RSA (kty, n, e).
 */
export async function verificarJwtCS(jwt: string, obtener: ObtenerJwkCS): Promise<VerificacionJwt> {
  const d = decodificarJwtCS(jwt)
  if (!d) return { ok: false, motivo: 'no_jwt' }
  if (d.header.alg !== 'RS256') return { ok: false, motivo: 'alg_no_permitido' }
  const kid = typeof d.header.kid === 'string' ? d.header.kid : ''
  if (!kid) return { ok: false, motivo: 'sin_kid' }
  let jwk: JwkRsa | null = null
  try { jwk = await obtener(kid) } catch { jwk = null }
  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return { ok: false, motivo: 'sin_llave' }
  try {
    const llave = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', llave, d.firma as BufferSource, new TextEncoder().encode(d.firmado) as BufferSource)
    return ok ? { ok: true, jwt: d } : { ok: false, motivo: 'firma_invalida' }
  } catch { return { ok: false, motivo: 'firma_invalida' } }
}

/** Ruta oficial de la llave pública de Flex (mismo host que la API del ambiente). */
export const rutaLlavePublicaCS = (kid: string) => `/flex/v2/public-keys/${encodeURIComponent(kid)}`

// Caché en memoria del proceso (por host+kid). Una llave que falla NO se guarda (se vuelve a pedir la próxima vez).
const cacheLlaves = new Map<string, JwkRsa>()
/** Envuelve un obtenedor con la caché por host. */
export function conCacheJwk(host: string, obtener: ObtenerJwkCS): ObtenerJwkCS {
  return async (kid) => {
    const clave = `${host}|${kid}`
    const previa = cacheLlaves.get(clave)
    if (previa) return previa
    const jwk = await obtener(kid)
    if (jwk && jwk.kty === 'RSA' && jwk.n && jwk.e) cacheLlaves.set(clave, jwk)
    return jwk
  }
}
/** Solo para pruebas. */
export function _limpiarCacheJwkCS(): void { cacheLlaves.clear() }

/** Lee la JWK de la respuesta de /flex/v2/public-keys/{kid} (la llave puede venir sola o dentro de `jwk`/`keys`). */
export function jwkDeRespuesta(data: unknown, kid: string): JwkRsa | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const candidatos: unknown[] = [d, d.jwk, ...(Array.isArray(d.keys) ? d.keys : [])]
  for (const c of candidatos) {
    const k = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    if (k.kty === 'RSA' && typeof k.n === 'string' && typeof k.e === 'string' && (!k.kid || k.kid === kid)) return { kty: 'RSA', n: k.n, e: k.e, kid: typeof k.kid === 'string' ? k.kid : kid }
  }
  return null
}

// ---- Token transitorio --------------------------------------------------------------------------------------------------

export type MarcaTarjeta = 'visa' | 'mastercard' | 'amex' | 'carnet'
/** Códigos de tipo de tarjeta de CyberSource (detectedCardTypes) y nombres de red → marca. */
const MARCAS: Record<string, MarcaTarjeta> = {
  '001': 'visa', VISA: 'visa', '002': 'mastercard', MASTERCARD: 'mastercard', MC: 'mastercard', '003': 'amex', AMEX: 'amex', AMERICAN_EXPRESS: 'amex',
  '058': 'carnet', CARNET: 'carnet',
}
export function marcaTarjeta(v: unknown): MarcaTarjeta | null {
  const k = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '_')
  return MARCAS[k] ?? null
}

export interface TokenTransitorio { jti: string; exp: Date; marca: MarcaTarjeta | null; bin: string | null; terminacion: string | null }
export type LecturaToken = { ok: true; token: TokenTransitorio } | { ok: false; motivo: 'no_jwt' | 'sin_jti' | 'sin_expiracion' | 'expirado' }

/** Lee el payload del token transitorio (ya verificado o por verificar). `expirado` es un código propio: la UI pide recapturar. */
export function leerTokenTransitorio(payload: Record<string, unknown> | null, ahora: Date = new Date()): LecturaToken {
  if (!payload) return { ok: false, motivo: 'no_jwt' }
  const jti = typeof payload.jti === 'string' ? payload.jti.trim() : ''
  if (!jti || jti.length > 128 || !/^[A-Za-z0-9_-]+$/.test(jti)) return { ok: false, motivo: 'sin_jti' }
  if (typeof payload.exp !== 'number') return { ok: false, motivo: 'sin_expiracion' }
  const exp = new Date(payload.exp * 1000)
  if (exp.getTime() <= ahora.getTime()) return { ok: false, motivo: 'expirado' }
  const content = (payload.content && typeof payload.content === 'object' ? payload.content : {}) as Record<string, unknown>
  const pi = (content.paymentInformation && typeof content.paymentInformation === 'object' ? content.paymentInformation : {}) as Record<string, unknown>
  const card = (pi.card && typeof pi.card === 'object' ? pi.card : {}) as Record<string, unknown>
  const num = (card.number && typeof card.number === 'object' ? card.number : {}) as Record<string, unknown>
  const tipos = Array.isArray(num.detectedCardTypes) ? num.detectedCardTypes : []
  const bin = typeof num.bin === 'string' && /^\d{6,8}$/.test(num.bin) ? num.bin : null
  const masked = typeof num.maskedValue === 'string' ? num.maskedValue : ''
  const terminacion = /\d{4}$/.test(masked) ? masked.slice(-4) : null
  return { ok: true, token: { jti, exp, marca: marcaTarjeta(tipos[0]), bin, terminacion } }
}

/** Atajo: verifica la firma Y lee el token. Un token con firma inválida no se usa jamás. */
export async function verificarTokenTransitorio(jwt: string, obtener: ObtenerJwkCS, ahora: Date = new Date()): Promise<LecturaToken | { ok: false; motivo: 'firma' }> {
  const v = await verificarJwtCS(jwt, obtener)
  if (!v.ok) return v.motivo === 'no_jwt' ? { ok: false, motivo: 'no_jwt' } : { ok: false, motivo: 'firma' }
  return leerTokenTransitorio(v.jwt.payload, ahora)
}
