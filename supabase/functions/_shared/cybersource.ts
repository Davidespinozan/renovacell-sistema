// CyberSource (BanBajío) · cliente REST interno · CS-1A.2
//
// Firma HTTP Signature (HMAC-SHA256) tal como la exige CyberSource ("REST Getting Started", capítulo HTTP Signature;
// misma receta que el cliente oficial cybersource-rest-client-node):
//   cadena firmada (líneas separadas por \n, SIN salto final):
//     host: <host>
//     date: <HTTP-date RFC 7231>
//     request-target: <método en minúsculas> <ruta>
//     digest: SHA-256=<base64(sha256(cuerpo))>        ← solo POST/PUT/PATCH
//     v-c-merchant-id: <merchant id>
//   Signature: keyid="<key id>", algorithm="HmacSHA256", headers="host date request-target [digest] v-c-merchant-id", signature="<base64(HMAC)>"
//   clave HMAC = shared secret DECODIFICADO de base64. Cabeceras HTTP: v-c-merchant-id, Date, Host, Digest, Signature, Content-Type.
//
// Reglas de este módulo (no negociables):
//   · El HOST sale del AMBIENTE (registro HOSTS_CS), nunca de una variable ni del navegador. Producción está DESHABILITADA por
//     código (PRODUCCION_CS_HABILITADA = false) y, además, exige sus propios secretos CS_LIVE_*.
//   · Sin secretos en logs ni en errores: el shared secret y la cabecera Signature nunca salen de aquí; los textos del proveedor
//     se depuran (depurarCS) antes de devolverse.
//   · CERO reintentos: una solicitud financiera se envía UNA vez. Un timeout o fallo de red DESPUÉS de invocar fetch es un
//     RESULTADO DESCONOCIDO (la solicitud pudo llegar), nunca un rechazo. Quien llama decide (intento → unknown + consulta).
//   · Un HTTP 200/201 NO significa pago confirmado: el estado de negocio viene en el cuerpo (p. ej. `status`); eso lo
//     interpreta el bloque que use este cliente (pagos, 3DS, Microform).
//   · Puro: sin Deno.env ni red implícita (el entorno y el fetch se inyectan) para poder probarlo en vitest y en Deno.

export type AmbienteCS = 'test' | 'production'
export type MetodoCS = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Hosts oficiales; el de producción solo se usa cuando PRODUCCION_CS_HABILITADA sea true (bloque posterior autorizado). */
export const HOSTS_CS: Record<AmbienteCS, string> = { test: 'apitest.cybersource.com', production: 'api.cybersource.com' }
/** CS-1A.2 · producción apagada por código: ni con secretos CS_LIVE_* cargados se firma contra api.cybersource.com. */
export const PRODUCCION_CS_HABILITADA = false as boolean

export const CS_SECRETOS = ['CS_API_ENV', 'CS_MERCHANT_ID', 'CS_KEY_ID', 'CS_SHARED_SECRET'] as const              // sandbox
export const CS_SECRETOS_LIVE = ['CS_API_ENV', 'CS_LIVE_MERCHANT_ID', 'CS_LIVE_KEY_ID', 'CS_LIVE_SHARED_SECRET'] as const   // producción

/** Rutas oficiales que usarán los bloques siguientes (Microform, 3DS, pagos, consulta). Ninguna se llama aquí. */
export const RUTAS_CS = {
  captureContext: '/microform/v2/sessions',
  payerSetup: '/risk/v1/authentication-setups',
  payerEnroll: '/risk/v1/authentications',
  payerValidate: '/risk/v1/authentication-results',
  pagos: '/pts/v2/payments',
  reversals: '/pts/v2/reversals',
  transaccion: (id: string) => `/tss/v2/transactions/${encodeURIComponent(id)}`,
  busqueda: '/tss/v2/searches',          // CS-1A.6 · búsqueda por clientReferenceInformation.code (solo lectura)
} as const
/** Rutas que mueven dinero o lo comprometen: NUNCA se reintentan y un timeout tras enviarlas es resultado desconocido. */
export const RUTAS_FINANCIERAS_CS: readonly string[] = [RUTAS_CS.pagos, RUTAS_CS.reversals]

export interface ConfigCS { ambiente: AmbienteCS; host: string; merchantId: string; keyId: string; sharedSecret: string }
export type ResolucionCS =
  | { ok: true; cfg: ConfigCS }
  | { ok: false; motivo: 'sin_configurar' | 'ambiente_invalido' | 'relleno' | 'secreto_invalido' | 'produccion_deshabilitada'; detalle: string }

const RELLENO = /^\s*$|^\.{2,}$|^<.*>$|^cambiar|^xxx+$|^tu[_ -]|^your[_ -]|^test$|^demo$/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Lee y valida la configuración desde los secretos. El shared secret solo vive dentro de `cfg`; nunca se devuelve en `detalle`. */
export function csConfig(env: (k: string) => string | undefined, produccionHabilitada: boolean = PRODUCCION_CS_HABILITADA): ResolucionCS {
  const g = (k: string) => (env(k) ?? '').trim()
  const ambiente = g('CS_API_ENV').toLowerCase()
  if (!ambiente && !g('CS_MERCHANT_ID') && !g('CS_KEY_ID') && !g('CS_SHARED_SECRET') && !g('CS_LIVE_MERCHANT_ID')) {
    return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${CS_SECRETOS.join(', ')}.` }
  }
  if (ambiente !== 'test' && ambiente !== 'production') return { ok: false, motivo: 'ambiente_invalido', detalle: 'CS_API_ENV debe ser test o production.' }
  const live = ambiente === 'production'
  if (live && !produccionHabilitada) return { ok: false, motivo: 'produccion_deshabilitada', detalle: 'CyberSource en producción está deshabilitado por código en esta fase.' }
  const kMid = live ? 'CS_LIVE_MERCHANT_ID' : 'CS_MERCHANT_ID', kKey = live ? 'CS_LIVE_KEY_ID' : 'CS_KEY_ID', kSec = live ? 'CS_LIVE_SHARED_SECRET' : 'CS_SHARED_SECRET'
  const merchantId = g(kMid), keyId = g(kKey), sharedSecret = g(kSec)
  const faltan = [!merchantId && kMid, !keyId && kKey, !sharedSecret && kSec].filter(Boolean)
  if (faltan.length) return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${faltan.join(', ')}.` }
  if (RELLENO.test(merchantId) || RELLENO.test(keyId) || RELLENO.test(sharedSecret)) return { ok: false, motivo: 'relleno', detalle: `Las credenciales de ${live ? 'producción' : 'sandbox'} parecen de relleno.` }
  if (!BASE64.test(sharedSecret) || sharedSecret.length < 24 || sharedSecret.length % 4 !== 0) return { ok: false, motivo: 'secreto_invalido', detalle: 'El shared secret debe ser el valor base64 generado en Business Center › Key Management.' }
  return { ok: true, cfg: { ambiente, host: HOSTS_CS[ambiente], merchantId, keyId, sharedSecret } }
}

/** Descripción segura para logs: ambiente, host, merchant y key id enmascarado. Nunca el secreto. */
export function describirCS(cfg: ConfigCS): string {
  return `cybersource ${cfg.ambiente} · ${cfg.host} · merchant ${cfg.merchantId} · key …${cfg.keyId.slice(-4)}`
}

/** Fecha HTTP (RFC 7231) que CyberSource espera en `Date` y en la cadena firmada. */
export function fechaHttpCS(d: Date): string { return d.toUTCString() }

const enc = new TextEncoder()
export function cuerpoBytesCS(cuerpo: unknown): Uint8Array {
  if (cuerpo == null) return new Uint8Array(0)
  if (cuerpo instanceof Uint8Array) return cuerpo
  return enc.encode(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo))
}
function aBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s)
}
function deBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}

/** `Digest` = "SHA-256=" + base64(sha256(bytes EXACTOS del cuerpo)). */
export async function digestCS(cuerpo: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', cuerpo as BufferSource)
  return `SHA-256=${aBase64(h)}`
}

const CON_DIGEST: ReadonlySet<MetodoCS> = new Set<MetodoCS>(['POST', 'PUT', 'PATCH'])

/** Cadena canónica firmada (expuesta para probar la canonicalización con vectores deterministas). */
export function cadenaFirmaCS(cfg: Pick<ConfigCS, 'host' | 'merchantId'>, metodo: MetodoCS, ruta: string, fecha: string, digest: string | null): string {
  const lineas = [`host: ${cfg.host}`, `date: ${fecha}`, `request-target: ${metodo.toLowerCase()} ${ruta}`]
  if (CON_DIGEST.has(metodo)) {
    if (!digest) throw new Error('digest requerido para ' + metodo)
    lineas.push(`digest: ${digest}`)
  }
  lineas.push(`v-c-merchant-id: ${cfg.merchantId}`)
  return lineas.join('\n')
}

export function listaCabecerasFirmadasCS(metodo: MetodoCS): string {
  return CON_DIGEST.has(metodo) ? 'host date request-target digest v-c-merchant-id' : 'host date request-target v-c-merchant-id'
}

export interface FirmaCS { headers: Record<string, string>; cadena: string; digest: string | null }

/**
 * Firma una solicitud. `cuerpo` son los bytes EXACTOS que se enviarán (el Digest se calcula sobre ellos).
 * Devuelve las cabeceras listas (incluida `Signature`); la cadena y el digest se exponen solo para pruebas y diagnóstico interno.
 */
export async function firmarCS(cfg: ConfigCS, metodo: MetodoCS, ruta: string, cuerpo: Uint8Array, fecha: Date = new Date()): Promise<FirmaCS> {
  if (!ruta.startsWith('/')) throw new Error('ruta inválida: debe empezar con /')
  const date = fechaHttpCS(fecha)
  const digest = CON_DIGEST.has(metodo) ? await digestCS(cuerpo) : null
  const cadena = cadenaFirmaCS(cfg, metodo, ruta, date, digest)
  const key = await crypto.subtle.importKey('raw', deBase64(cfg.sharedSecret) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = aBase64(await crypto.subtle.sign('HMAC', key, enc.encode(cadena) as BufferSource))
  const headers: Record<string, string> = {
    'v-c-merchant-id': cfg.merchantId,
    'Date': date,
    'Host': cfg.host,
    'Signature': `keyid="${cfg.keyId}", algorithm="HmacSHA256", headers="${listaCabecerasFirmadasCS(metodo)}", signature="${sig}"`,
    'Content-Type': 'application/json;charset=utf-8',
    'Accept': 'application/json;charset=utf-8',
  }
  if (digest) headers['Digest'] = digest
  return { headers, cadena, digest }
}

/** Texto seguro: sin correos, sin secuencias largas de dígitos (PAN/teléfonos), sin tokens largos ni firmas; 200 máx. */
export function depurarCS(texto: unknown, max = 200): string {
  return String(texto ?? '')
    .replace(/signature="[^"]*"/gi, 'signature="‹oculto›"')
    .replace(/[^@\s"]+@[^@\s"]+/g, '‹correo›')
    .replace(/\d{7,}/g, '‹número›')
    .replace(/[A-Za-z0-9+/_\-]{32,}={0,2}/g, '‹token›')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export type RespuestaCS<T = unknown> =
  | { ok: true; status: number; data: T; correlationId: string | null }
  /** CyberSource respondió con error HTTP (4xx/5xx). Es un resultado CONOCIDO: el proveedor lo rechazó o falló explícitamente. */
  | { ok: false; clase: 'http'; status: number; data: unknown; mensaje: string; correlationId: string | null }
  /** Falló ANTES de invocar la red (configuración/firma): seguro reintentar tras corregir. */
  | { ok: false; clase: 'antes_de_enviar'; mensaje: string }
  /** Timeout o fallo de red DESPUÉS de invocar fetch: la solicitud pudo llegar → RESULTADO DESCONOCIDO. Nunca reintentar en automático. */
  | { ok: false; clase: 'resultado_desconocido'; motivo: 'timeout' | 'red'; mensaje: string }

export interface SolicitudCS {
  metodo: MetodoCS
  ruta: string
  cuerpo?: unknown
  /** 'json' (defecto): el cuerpo 2xx se parsea. 'texto': se devuelve tal cual (p. ej. el capture context de Microform es un JWT en texto). */
  aceptar?: 'json' | 'texto'
  timeoutMs?: number
  /** Inyectable para pruebas; por defecto el fetch global. */
  fetchImpl?: typeof fetch
  ahora?: () => Date
}

export const TIMEOUT_CS_MS = { consulta: 15000, financiera: 30000 } as const

/** Mensaje de error del proveedor (forma oficial {status, reason, message}) depurado; nunca el cuerpo completo. */
export function mensajeErrorCS(status: number, data: unknown): string {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const partes = [d.status, d.reason, d.message].filter((x) => typeof x === 'string' && x).map((x) => depurarCS(x, 80))
  return partes.length ? `CyberSource ${status}: ${partes.join(' · ')}` : `CyberSource respondió ${status}.`
}

/**
 * Envía UNA solicitud firmada. Sin reintentos. El cuerpo se serializa UNA vez y el Digest se calcula sobre esos mismos bytes.
 * No registra nada: quien llama decide qué observar (sin cabeceras ni cuerpos).
 */
export async function solicitarCS<T = unknown>(cfg: ConfigCS, s: SolicitudCS): Promise<RespuestaCS<T>> {
  let bytes: Uint8Array, firma: FirmaCS
  try {
    bytes = cuerpoBytesCS(s.cuerpo)
    if (!CON_DIGEST.has(s.metodo) && bytes.length > 0) return { ok: false, clase: 'antes_de_enviar', mensaje: `${s.metodo} no lleva cuerpo.` }
    firma = await firmarCS(cfg, s.metodo, s.ruta, bytes, (s.ahora ?? (() => new Date()))())
  } catch (e) {
    return { ok: false, clase: 'antes_de_enviar', mensaje: `No se pudo firmar la solicitud: ${depurarCS((e as Error)?.message, 120)}` }
  }
  const f = s.fetchImpl ?? fetch
  const ctl = new AbortController()
  const timeoutMs = s.timeoutMs ?? (RUTAS_FINANCIERAS_CS.includes(s.ruta) ? TIMEOUT_CS_MS.financiera : TIMEOUT_CS_MS.consulta)
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  let r: Response
  try {
    r = await f(`https://${cfg.host}${s.ruta}`, { method: s.metodo, headers: firma.headers, body: CON_DIGEST.has(s.metodo) ? (bytes as BodyInit) : undefined, signal: ctl.signal })
  } catch (e) {
    clearTimeout(t)
    const abort = (e as Error)?.name === 'AbortError' || ctl.signal.aborted
    return { ok: false, clase: 'resultado_desconocido', motivo: abort ? 'timeout' : 'red',
             mensaje: abort ? `Sin respuesta de CyberSource en ${timeoutMs} ms; la solicitud pudo haberse procesado.` : `Fallo de red hablando con CyberSource; la solicitud pudo haberse procesado (${depurarCS((e as Error)?.message, 80)}).` }
  }
  clearTimeout(t)
  const correlationId = r.headers.get('v-c-correlation-id')
  let data: unknown = null
  const texto = await r.text().catch(() => '')
  if (texto) { try { data = JSON.parse(texto) } catch { data = { raw: depurarCS(texto) } } }
  if (!r.ok) return { ok: false, clase: 'http', status: r.status, data, mensaje: mensajeErrorCS(r.status, data), correlationId }
  if (s.aceptar === 'texto') return { ok: true, status: r.status, data: texto.trim() as unknown as T, correlationId }   // sin depurar: es el valor útil (p. ej. JWT)
  return { ok: true, status: r.status, data: data as T, correlationId }
}
