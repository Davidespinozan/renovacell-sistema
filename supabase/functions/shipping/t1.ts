// ============================================================================
// Adaptador T1 Envíos · API v2.0 (T1 Cuenta) — NEUTRAL→T1 y T1→NEUTRAL.
// Autenticación (dos mecanismos INDEPENDIENTES, elegidos por ambiente con T1_AUTH / T1_LIVE_AUTH):
//   api_key  → cabeceras `X-Api-Key: <llave>` y `shop_id: <tienda>` (T1 Cuenta v2.0; es lo que acepta sandbox.t1api.com).
//   keycloak → T1-LIVE-02: `Authorization: Bearer <access_token>` + `shop_id`, con token de Keycloak OpenID (contrato documentado
//              por T1: POST al token endpoint, grant `password`, client_id `t1envios`, client_secret, usuario y contraseña de
//              t1envios.com; access_token ≈ 30 min). Es lo que exige el host productivo documentado apiv2.t1envios.com, que
//              rechazó X-Api-Key con 401 (20 oct 2026). Solo se implementa el grant documentado; nada se supone.
// Ambientes (registro explícito; el host sale del ambiente y del mecanismo, nunca del cliente ni de una URL libre):
//   api_key:  test → https://sandbox.t1api.com (documentado) · production → SIN CONFIRMAR (falla de forma segura).
//   keycloak: test → SIN CONFIRMAR · production → https://apiv2.t1envios.com (developer.t1.com; rutas SIN prefijo /t1-shipping).
// Endpoints documentados:
//   POST /t1-shipping/quote/create-with-quote   cotización (home, origin_postal_code, destination_postal_code, weight, length,
//                                               width, height, shipping_days, insurance, valor_paquete, package_type, packages)
//   POST /t1-shipping/guide/create-guide        guía (quote_token, content, business_id, remitente, destinatario,
//                                               generate_pickup, has_notification)
// Contratos oficiales (T1 Cuenta, 20 oct 2026): cotización → {success, detail[]: {service_id, service_name, service_type,
// carrier, total_cost (TOTAL de T1), cost, delivery_days, currency, token, recommended, insurance, extended_zone, …}};
// guía → request con origin_*/destination_* (first_name, last_name, email, phone, street, number, neighborhood, municipality,
// state, references) + quote_token, content, business_id (= shop_id); respuesta {success, detail: {tracking_number,
// order_number, carrier, cost, guide_link (PDF en S3, no permanente), file (PDF base64), current_balance, …}}.
// Rastreo y recolección v2.0: endpoints no documentados aún → se reportan como no disponibles (sin red).
// Secretos: T1_API_ENV (test|production), T1_API_KEY, T1_SHOP_ID. La llave nunca sale de la Edge ni va a logs.
// Origen: la MISMA fuente que DHL (company_settings → bloque "Origen de envíos", nunca el domicilio fiscal), por campos
// estructurados (migración 183: calle, número exterior/interior, colonia, referencias). Nada se divide ni se inventa.
// Módulo PURO (sin red ni Deno): todas las funciones las prueba vitest desde el frontend.
// ============================================================================
import type { NeutralPackage, NeutralReceiver, NeutralShipper } from './dhl.ts'

export type AmbienteT1 = 'test' | 'production'
export type AuthT1 = 'api_key' | 'keycloak'
/** Registro de ambientes (api_key): el host productivo se agrega aquí cuando T1 lo confirme; mientras, production no opera. */
export const HOSTS_T1: Record<AmbienteT1, string | null> = { test: 'https://sandbox.t1api.com', production: null }
/** Registro de ambientes (keycloak): producción documentada en developer.t1.com; sandbox con Keycloak sin confirmar. */
export const HOSTS_T1_KEYCLOAK: Record<AmbienteT1, string | null> = { test: null, production: 'https://apiv2.t1envios.com' }
export const RUTAS_T1 = { cotizar: '/t1-shipping/quote/create-with-quote', guia: '/t1-shipping/guide/create-guide', wallet: '/t1-shipping/wallet/movements' } as const
/** Rutas del host productivo (sin prefijo): cotización documentada; la ruta de guía NO está confirmada (3 variantes vistas) → null. */
export const RUTAS_T1_KEYCLOAK: Record<keyof typeof RUTAS_T1, string | null> = { cotizar: '/quote/create-with-quote', guia: null, wallet: null }
export const rutaT1 = (cfg: { auth: AuthT1 }, clave: keyof typeof RUTAS_T1): string | null => (cfg.auth === 'keycloak' ? RUTAS_T1_KEYCLOAK[clave] : RUTAS_T1[clave])
/** Evidencia de contrato: false = no se opera esa parte hasta tener el esquema oficial o un fixture real sanitizado. */
export const CONTRATO_T1 = { cotizacion_request: true, cotizacion_response: true, guia_request_campos_direccion: true, guia_response: true, rastreo: false, recoleccion: false } as const
export const T1_SECRETOS = ['T1_API_ENV', 'T1_API_KEY', 'T1_SHOP_ID'] as const            // sandbox (test, api_key)
export const T1_SECRETOS_LIVE = ['T1_API_ENV', 'T1_LIVE_API_KEY', 'T1_LIVE_SHOP_ID', 'T1_LIVE_COTIZAR'] as const   // producción (live, api_key)
/** Keycloak (T1-LIVE-02): modo por ambiente `T1_AUTH` (test) / `T1_LIVE_AUTH` (production) = api_key | keycloak. Credenciales
 *  con prefijo por ambiente: T1_KC_* (test) / T1_LIVE_KC_* (production). Obligatorias: CLIENT_SECRET, USERNAME, PASSWORD.
 *  Opcionales con valor documentado por defecto: TOKEN_URL, CLIENT_ID, GRANT (solo `password`). */
export const T1_SECRETOS_KEYCLOAK_LIVE = ['T1_API_ENV', 'T1_LIVE_AUTH', 'T1_LIVE_SHOP_ID', 'T1_LIVE_COTIZAR', 'T1_LIVE_KC_CLIENT_SECRET', 'T1_LIVE_KC_USERNAME', 'T1_LIVE_KC_PASSWORD'] as const
export const KEYCLOAK_T1 = { tokenUrl: 'https://id.t1.com/realms/T1/protocol/openid-connect/token', clientId: 't1envios', grant: 'password', expiraSegPorDefecto: 1800, margenSeg: 60 } as const
/** T1-LIVE-01 · las GUÍAS en producción quedan bloqueadas en el servidor por código, sin importar secretos ni quién llame. */
export const GUIAS_LIVE_PERMITIDAS = false as boolean

export interface KeycloakT1 { tokenUrl: string; clientId: string; clientSecret: string; username: string; password: string; grant: 'password' }
export interface T1Config { ambiente: AmbienteT1; auth: AuthT1; base: string; apiKey: string; shopId: string; cotizarPermitido: boolean; guiasPermitidas: boolean; keycloak?: KeycloakT1 }
export type ConfigT1 = { ok: true; cfg: T1Config } | { ok: false; motivo: 'sin_configurar' | 'ambiente_invalido' | 'relleno' | 'produccion_sin_host' | 'auth_invalida' | 'grant_no_soportado' | 'token_url_invalida'; detalle: string }

const RELLENO = /^\s*$|^\.{2,}$|^<.*>$|^cambiar|^xxx+$|^tu[_ -]|^your[_ -]/i
/**
 * Lee y valida la configuración desde los secretos. Nunca devuelve ni registra la llave fuera de `cfg`.
 * Credenciales SEPARADAS por ambiente: test → T1_API_KEY/T1_SHOP_ID; production → T1_LIVE_API_KEY/T1_LIVE_SHOP_ID.
 * En production, cotizar exige además T1_LIVE_COTIZAR=on (control independiente); las guías live NO se permiten (código).
 * `hosts` solo se inyecta en pruebas; en runtime el host sale del registro HOSTS_T1.
 */
export function t1Config(env: (k: string) => string | undefined, hosts: Record<AmbienteT1, string | null> = HOSTS_T1, hostsKeycloak: Record<AmbienteT1, string | null> = HOSTS_T1_KEYCLOAK): ConfigT1 {
  const g = (k: string) => (env(k) ?? '').trim()
  const ambiente = g('T1_API_ENV').toLowerCase()
  if (!ambiente && !g('T1_API_KEY') && !g('T1_SHOP_ID') && !g('T1_LIVE_API_KEY') && !g('T1_LIVE_AUTH') && !g('T1_AUTH')) return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${T1_SECRETOS.join(', ')}.` }
  if (ambiente !== 'test' && ambiente !== 'production') return { ok: false, motivo: 'ambiente_invalido', detalle: 'T1_API_ENV debe ser test o production.' }
  const live = ambiente === 'production'
  const modo = (g(live ? 'T1_LIVE_AUTH' : 'T1_AUTH') || 'api_key').toLowerCase()
  if (modo !== 'api_key' && modo !== 'keycloak') return { ok: false, motivo: 'auth_invalida', detalle: `${live ? 'T1_LIVE_AUTH' : 'T1_AUTH'} debe ser api_key o keycloak.` }
  const kShop = live ? 'T1_LIVE_SHOP_ID' : 'T1_SHOP_ID'
  const shopId = g(kShop)
  const permisos = { cotizarPermitido: live ? g('T1_LIVE_COTIZAR').toLowerCase() === 'on' : true, guiasPermitidas: live ? GUIAS_LIVE_PERMITIDAS : true }
  if (modo === 'keycloak') {
    // T1-LIVE-02 · Keycloak: la llave X-Api-Key NO participa; el token se obtiene con las credenciales del prefijo del ambiente.
    const p = live ? 'T1_LIVE_KC_' : 'T1_KC_'
    const clientSecret = g(p + 'CLIENT_SECRET'), username = g(p + 'USERNAME'), password = g(p + 'PASSWORD')
    const faltan = [!shopId && kShop, !clientSecret && p + 'CLIENT_SECRET', !username && p + 'USERNAME', !password && p + 'PASSWORD'].filter(Boolean)
    if (faltan.length) return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${faltan.join(', ')}.` }
    if (RELLENO.test(shopId) || RELLENO.test(clientSecret) || RELLENO.test(username) || RELLENO.test(password) || clientSecret.length < 8) return { ok: false, motivo: 'relleno', detalle: `Las credenciales Keycloak de ${live ? 'producción' : 'sandbox'} parecen de relleno.` }
    const grant = (g(p + 'GRANT') || KEYCLOAK_T1.grant).toLowerCase()
    if (grant !== 'password') return { ok: false, motivo: 'grant_no_soportado', detalle: `Solo está implementado el grant documentado por T1 (password); ${p}GRANT=${grant} no se usa.` }
    const tokenUrl = g(p + 'TOKEN_URL') || KEYCLOAK_T1.tokenUrl
    if (!/^https:\/\/[a-z0-9.-]+\/realms\/[^/\s]+\/protocol\/openid-connect\/token$/i.test(tokenUrl)) return { ok: false, motivo: 'token_url_invalida', detalle: `${p}TOKEN_URL debe ser un token endpoint https de Keycloak (…/realms/<realm>/protocol/openid-connect/token).` }
    const base = hostsKeycloak[ambiente]
    if (!base) return { ok: false, motivo: 'produccion_sin_host', detalle: `El host de T1 con Keycloak para ${live ? 'producción' : 'sandbox'} no está confirmado; no opera hasta registrarlo.` }
    return { ok: true, cfg: { ambiente, auth: 'keycloak', base, apiKey: '', shopId, ...permisos, keycloak: { tokenUrl, clientId: g(p + 'CLIENT_ID') || KEYCLOAK_T1.clientId, clientSecret, username, password, grant: 'password' } } }
  }
  const kKey = live ? 'T1_LIVE_API_KEY' : 'T1_API_KEY'
  const apiKey = g(kKey)
  if (!apiKey || !shopId) return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${[!apiKey && kKey, !shopId && kShop].filter(Boolean).join(' y ')}.` }
  if (RELLENO.test(apiKey) || RELLENO.test(shopId) || apiKey.length < 16) return { ok: false, motivo: 'relleno', detalle: `La llave o el identificador de ${live ? 'producción' : 'sandbox'} parecen de relleno.` }
  const base = hosts[ambiente]
  if (!base) return { ok: false, motivo: 'produccion_sin_host', detalle: 'El host productivo de T1 no está confirmado; production no opera hasta registrarlo.' }
  return { ok: true, cfg: { ambiente, auth: 'api_key', base, apiKey, shopId, ...permisos } }
}
/** Cabeceras del modo api_key (sandbox). En modo keycloak NO se usan: ver cabecerasAutenticadasT1. */
export function cabecerasT1(cfg: T1Config): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey, shop_id: cfg.shopId }
}

// ── T1-LIVE-02 · Keycloak: token, caché con vencimiento anticipado y cabeceras Bearer ─────────────────────────────────
// Contrato documentado (único implementado): POST tokenUrl, application/x-www-form-urlencoded,
//   grant_type=password&client_id=<id>&client_secret=<secret>&username=<u>&password=<p>  → { access_token, expires_in, token_type }
// El token y las credenciales nunca salen de este módulo salvo dentro de la cabecera Authorization; nunca a logs ni mensajes.
export interface TokenT1 { accessToken: string; expiraEn: number }   // expiraEn = epoch ms
export type ClaseTokenT1 = 'credenciales_rechazadas' | 'sin_permisos' | 'forma_no_reconocida' | 'proveedor' | 'sin_respuesta'
export type LecturaToken = { ok: true; token: TokenT1 } | { ok: false; clase: ClaseTokenT1; mensaje: string }
export function buildTokenRequest(kc: KeycloakT1): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  const body = new URLSearchParams({ grant_type: kc.grant, client_id: kc.clientId, client_secret: kc.clientSecret, username: kc.username, password: kc.password }).toString()
  return { url: kc.tokenUrl, init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body } }
}
/** Clasifica la respuesta del token endpoint en palabras; NUNCA incluye el cuerpo (puede traer el token) ni credenciales. */
// deno-lint-ignore no-explicit-any
export function leerToken(status: number, data: any, ahora = Date.now()): LecturaToken {
  const d = data && typeof data === 'object' ? data : {}
  if (status === 200) {
    const tok = typeof d.access_token === 'string' ? d.access_token.trim() : ''
    const seg = Number(d.expires_in)
    if (!tok) return { ok: false, clase: 'forma_no_reconocida', mensaje: 'Keycloak respondió 200 sin access_token.' }
    return { ok: true, token: { accessToken: tok, expiraEn: ahora + (Number.isFinite(seg) && seg > 0 ? seg : KEYCLOAK_T1.expiraSegPorDefecto) * 1000 } }
  }
  if (status === 400 || status === 401) return { ok: false, clase: 'credenciales_rechazadas', mensaje: `Keycloak rechazó las credenciales de T1 (${status}${typeof d.error === 'string' ? ' ' + d.error.slice(0, 40) : ''}): revisa usuario, contraseña, client_id y client_secret.` }
  if (status === 403) return { ok: false, clase: 'sin_permisos', mensaje: 'Keycloak respondió 403: la cuenta no tiene permiso para este cliente o realm.' }
  if (status >= 500) return { ok: false, clase: 'proveedor', mensaje: `Keycloak de T1 no está disponible (${status}).` }
  return { ok: false, clase: 'forma_no_reconocida', mensaje: `Keycloak respondió ${status}.` }
}
const tokens = new Map<string, TokenT1>()
const claveToken = (kc: KeycloakT1) => `${kc.tokenUrl}|${kc.clientId}|${kc.username}`   // sin secretos en la clave
export const tokenVigente = (t: TokenT1 | undefined, ahora = Date.now()) => !!t && t.expiraEn - KEYCLOAK_T1.margenSeg * 1000 > ahora
export function olvidarTokenT1(kc: KeycloakT1): void { tokens.delete(claveToken(kc)) }
export function olvidarTodosLosTokensT1(): void { tokens.clear() }
type FetchT1 = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>
/** Devuelve un token vigente (caché) o pide uno nuevo con vencimiento anticipado de KEYCLOAK_T1.margenSeg. */
export async function obtenerTokenT1(kc: KeycloakT1, fetchImpl: FetchT1, ahora = Date.now()): Promise<LecturaToken> {
  const k = claveToken(kc)
  const t = tokens.get(k)
  if (tokenVigente(t, ahora)) return { ok: true, token: t! }
  tokens.delete(k)
  const { url, init } = buildTokenRequest(kc)
  let status = 0, data: unknown = {}
  try { const r = await fetchImpl(url, init); status = r.status; data = await r.json().catch(() => ({})) }
  catch { return { ok: false, clase: 'sin_respuesta', mensaje: 'Keycloak de T1 no respondió (red o tiempo de espera).' } }
  const l = leerToken(status, data, ahora)
  if (l.ok) tokens.set(k, l.token)
  return l
}
export type CabecerasT1 = { ok: true; headers: Record<string, string> } | { ok: false; clase: ClaseTokenT1; mensaje: string }
/** Cabeceras autenticadas según el modo: api_key (X-Api-Key) o keycloak (Bearer). Solo en keycloak existe Authorization. */
export async function cabecerasAutenticadasT1(cfg: T1Config, fetchImpl: FetchT1, ahora = Date.now()): Promise<CabecerasT1> {
  if (cfg.auth !== 'keycloak') return { ok: true, headers: cabecerasT1(cfg) }
  if (!cfg.keycloak) return { ok: false, clase: 'credenciales_rechazadas', mensaje: 'Configuración Keycloak ausente.' }
  const t = await obtenerTokenT1(cfg.keycloak, fetchImpl, ahora)
  if (!t.ok) return t
  return { ok: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token.accessToken}`, shop_id: cfg.shopId } }
}
export const urlT1 = (cfg: T1Config, ruta: string) => `${cfg.base}${ruta}`
/** Texto seguro para logs/UI: nunca la llave. */
export const describirT1 = (cfg: T1Config) => `T1 ${cfg.ambiente === 'test' ? 'sandbox' : 'producción'} (${cfg.auth === 'keycloak' ? 'Keycloak' : 'X-Api-Key'}) · shop ${cfg.shopId.slice(0, 2)}…`

// ── Utilería de datos ───────────────────────────────────────────────────────────────────────────────
const limpia = (t?: string | null) => String(t ?? '').replace(/\s+/g, ' ').trim()
const entero = (n: number, min = 1) => Math.max(min, Math.ceil(Number(n) || 0))
export function partirNombre(completo: string): { nombre: string; apellidos: string } {
  const partes = limpia(completo).replace(/^(dr|dra|lic|ing|sr|sra|srta)\.?\s+/i, '').split(' ').filter(Boolean)
  if (partes.length === 0) return { nombre: '', apellidos: '' }
  if (partes.length === 1) return { nombre: partes[0], apellidos: '' }   // un solo nombre: el apellido NO se inventa ni se repite (la guía se detiene y lo pide)
  if (partes.length === 2) return { nombre: partes[0], apellidos: partes[1] }
  const corte = partes.length >= 4 ? partes.length - 2 : partes.length - 1
  return { nombre: partes.slice(0, corte).join(' '), apellidos: partes.slice(corte).join(' ') }
}
export function partirCalle(line1: string): { calle: string; numero: string } {
  const t = limpia(line1)
  const m = /^(.*?[a-záéíóúñ.)])\s+(#?\s*\d[\w\-/]*(?:\s*(?:int|interior|depto|local|piso|no\.?|num\.?)[\s.]*[\w\-/]+)*)\s*$/i.exec(t)
  if (m && m[1].length >= 3) return { calle: m[1].trim().slice(0, 100), numero: m[2].replace(/^#\s*/, '').trim().slice(0, 30) }
  const m2 = /^(.*?)\s+(\d[\w\-/]*)\s*,?\s*(.*)$/.exec(t)
  if (m2 && m2[1].length >= 3) return { calle: m2[1].trim().slice(0, 100), numero: [m2[2], m2[3]].filter(Boolean).join(' ').trim().slice(0, 30) }
  return { calle: t.slice(0, 100), numero: 'S/N' }
}
const telefono = (t?: string | null) => limpia(t).replace(/\D/g, '').slice(-10)
const correo = (e?: string | null) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpia(e)) ? limpia(e) : '')

// ── Cotización (request documentado) ───────────────────────────────────────────────────────────────
// `valor_paquete`: valor declarado de la mercancía (decimal, MXN). T1 lo exige en el sandbox aunque `insurance` sea false
// (su documentación lo define como "valor de la factura"). Sale del PEDIDO: suma de renglones (cantidad × precio vendido, IVA
// incluido porque los precios lo incluyen), sin flete ni descuentos adicionales. Nunca un valor fijo ni un costo interno.
// HIPÓTESIS CONTRACTUAL (pendiente de validar con una cotización real en sandbox): la doc pública de cotización exige en el
// CUERPO `comercio_id` (string, "Identificador único de la tienda"); el ejemplo v2.0 de T1 Cuenta no lo lista, pero el sandbox
// ya demostró exigir nombres de esa familia (`valor_paquete`) y el error ERR-QUOTE-STORE ocurre al "registrar" la cotización.
// Se manda el mismo identificador de la cabecera `shop_id`. Si T1 lo rechaza o no cambia nada, se retira (un solo campo).
// `package_value` (number, MXN): nombre documentado en T1 Cuenta v2.0 para el valor declarado (obligatorio con insurance=true).
// `valor_paquete` se conserva mientras el sandbox lo exija (HTTP 400 real del 20 oct); ambos llevan el MISMO número.
export interface QuoteV2Request { home: boolean; origin_postal_code: string; destination_postal_code: string; weight: number; length: number; width: number; height: number; shipping_days: number; insurance: boolean; package_value: number; valor_paquete: number; package_type: number; packages: number; comercio_id: string }
export function buildQuoteT1(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage, valorMercancia: number, comercioId: string, diasEmbarque = 0): QuoteV2Request {
  const valor = Number(valorMercancia)
  const declarado = Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0
  return {
    comercio_id: String(limpia(comercioId)),
    home: false, origin_postal_code: limpia(shipper.cp).replace(/\D/g, ''), destination_postal_code: limpia(receiver.address.cp).replace(/\D/g, ''),
    weight: entero(pkg.weightKg), length: entero(pkg.lengthCm), width: entero(pkg.widthCm), height: entero(pkg.heightCm),
    shipping_days: Math.max(0, Math.floor(diasEmbarque)), insurance: false, package_value: declarado, valor_paquete: declarado, package_type: 2, packages: entero(pkg.pieces),
  }
}
export function faltantesCotizacion(q: QuoteV2Request): string[] {
  const f: string[] = []
  if (!/^\d{5}$/.test(q.origin_postal_code)) f.push('C.P. de origen (5 dígitos)')
  if (!/^\d{5}$/.test(q.destination_postal_code)) f.push('C.P. de destino (5 dígitos)')
  if (!(q.weight > 0 && q.length > 0 && q.width > 0 && q.height > 0)) f.push('peso y medidas del paquete')
  if (!(q.package_value > 0) || q.valor_paquete !== q.package_value) f.push('valor de la mercancía del pedido (renglones con precio)')
  if (!q.comercio_id) f.push('identificador de la tienda (T1_SHOP_ID)')
  return f
}
/** Valor declarado de la mercancía desde los renglones del pedido: Σ cantidad × precio vendido. null si no hay renglones con precio. */
export function valorMercancia(renglones: Array<{ qty: unknown; unit_price: unknown }>): number | null {
  let total = 0, n = 0
  for (const r of renglones) {
    const q = Number(r.qty), p = Number(r.unit_price)
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) continue
    total += q * p; n++
  }
  return n > 0 && total > 0 ? Math.round(total * 100) / 100 : null
}

const NOMBRE_PAQUETERIA: Record<string, string> = { FEDEX: 'FedEx', DHL: 'DHL', UPS: 'UPS', ESTAFETA: 'Estafeta', EXPRESS: 'Express', '99MIN': '99 Minutos', '99MINUTOS': '99 Minutos', AMPM: 'AM PM', T1ENVIOS: 'T1 Envíos', REDPACK: 'Redpack', PAQUETEXPRESS: 'Paquetexpress', JTEXPRESS: 'J&T Express' }
export const carrierT1 = (clave: string) => NOMBRE_PAQUETERIA[limpia(clave).toUpperCase().replace(/[^A-Z0-9]/g, '')] ?? limpia(clave)
const NOMBRE_SERVICIO: Record<string, string> = { EXPRESSDOMESTIC: 'Express', EXPRESS: 'Express', STANDARD: 'Estándar', ECONOMY: 'Económico', ECONOMICO: 'Económico', GROUND: 'Terrestre', TERRESTRE: 'Terrestre', DIASIGUIENTE: 'Día siguiente', NEXTDAY: 'Día siguiente', SAVER: 'Saver' }
const servicioBonito = (clave: string) => NOMBRE_SERVICIO[limpia(clave).toUpperCase().replace(/[^A-Z0-9]/g, '')] ?? limpia(clave).replace(/_/g, ' ')

export interface TarifaT1 {
  id: string; serviceCode: string; carrier: string; service: string; amount: number; currency: string; etaDays: number; token: string
  detalle: { service_id: string; service_name: string; service_type: string | null; cost: number | null; insurance: boolean | null; insurance_cost: number | null; extended_zone: boolean | null; extended_zone_cost: number | null; recommended: boolean | null; total_packages: number | null }
}
export type LecturaCotizacion = { ok: true; tarifas: TarifaT1[] } | { ok: false; motivo: 'sin_servicios' | 'respuesta_incompleta' | 'forma_no_reconocida'; forma: string }
const n = (v: unknown) => { const x = Number(typeof v === 'string' ? v.replace(/[^0-9.]/g, '') : v); return Number.isFinite(x) ? x : NaN }
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null)
const numONull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(n(v)) ? n(v) : null)
/** Forma de un JSON sin valores (solo llaves): sirve para diagnosticar un contrato distinto sin filtrar datos. */
export function formaDe(v: unknown, nivel = 0): string {
  if (nivel > 4) return '…'
  if (Array.isArray(v)) return `[${v.length ? formaDe(v[0], nivel + 1) : ''}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).slice(0, 25).map((k) => `${k}:${formaDe((v as Record<string, unknown>)[k], nivel + 1)}`).join(',')}}`
  return typeof v
}
export const claveServicio = (carrier: string, serviceName: string) => `${limpia(carrier).toUpperCase().replace(/[^A-Z0-9]/g, '')}|${limpia(serviceName).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
/**
 * Contrato OFICIAL de cotización: `success === true` y `detail[]`. Por servicio se exigen carrier, service_name, total_cost (> 0)
 * y token; lo demás es opcional y se conserva tal cual (nunca se inventa). Un servicio incompleto se descarta; si todos lo son,
 * `respuesta_incompleta`. El TOTAL de T1 es `total_cost` (no `cost`): es el costo del proveedor, NO el precio comercial al cliente.
 */
// deno-lint-ignore no-explicit-any
export function parseQuoteT1(data: any): LecturaCotizacion {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('success' in data) || !('detail' in data)) return { ok: false, motivo: 'forma_no_reconocida', forma: formaDe(data) }
  if (data.success !== true || !Array.isArray(data.detail)) return { ok: false, motivo: 'forma_no_reconocida', forma: formaDe(data) }
  if (data.detail.length === 0) return { ok: false, motivo: 'sin_servicios', forma: formaDe(data) }
  const out: TarifaT1[] = []
  for (const r of data.detail as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue
    const carrier = limpia(String(r.carrier ?? r.service_id ?? '')), serviceName = limpia(String(r.service_name ?? '')), token = limpia(String(r.token ?? ''))
    const total = n(r.total_cost)
    if (!carrier || !serviceName || !token || !Number.isFinite(total) || total <= 0) continue
    const serviceCode = claveServicio(carrier, serviceName)
    out.push({
      id: serviceCode, serviceCode, carrier: carrierT1(carrier), service: limpia(String(r.service_type ?? '')) ? `${servicioBonito(serviceName)} · ${limpia(String(r.service_type))}` : servicioBonito(serviceName),
      amount: total, currency: limpia(String(r.currency ?? '')) || 'MXN', etaDays: Math.max(1, Math.floor(n(r.delivery_days)) || 1), token,
      detalle: { service_id: limpia(String(r.service_id ?? carrier)), service_name: serviceName, service_type: limpia(String(r.service_type ?? '')) || null, cost: numONull(r.cost), insurance: bool(r.insurance), insurance_cost: numONull(r.insurance_cost), extended_zone: bool(r.extended_zone), extended_zone_cost: numONull(r.extended_zone_cost), recommended: bool(r.recommended), total_packages: numONull(r.total_packages) },
    })
  }
  if (!out.length) return { ok: false, motivo: 'respuesta_incompleta', forma: formaDe(data) }
  return { ok: true, tarifas: out.sort((a, b) => a.amount - b.amount) }
}

// ── Guía ───────────────────────────────────────────────────────────────────────────────────────────
export interface DatosDireccionT1 { nombre: string; apellidos: string; correo: string; telefono: string; calle: string; numero: string; colonia: string; municipio: string; estado: string; cp: string; referencias: string }
/** Origen de envíos del ERP (company_settings, Configuración → Origen de envíos) con los campos estructurados de la 183. */
export type OrigenEnvios = NeutralShipper & { calle?: string | null; numeroExt?: string | null; numeroInt?: string | null; colonia?: string | null; referencias?: string | null }
/** Datos del remitente para la guía, SOLO desde los campos estructurados (sin dividir textos): lo que falte se reporta. */
export function datosOrigenT1(shipper: OrigenEnvios): DatosDireccionT1 {
  const o = partirNombre(shipper.name)
  const numero = [limpia(shipper.numeroExt), limpia(shipper.numeroInt)].filter(Boolean).join(' ')
  return { nombre: o.nombre, apellidos: o.apellidos, correo: correo(shipper.email), telefono: telefono(shipper.phone), calle: limpia(shipper.calle).slice(0, 100), numero: numero.slice(0, 30), colonia: limpia(shipper.colonia).slice(0, 80), municipio: limpia(shipper.city).slice(0, 60), estado: limpia(shipper.state).slice(0, 40), cp: limpia(shipper.cp).replace(/\D/g, ''), referencias: limpia(shipper.referencias).slice(0, 200) }
}
export function datosDestinoT1(receiver: NeutralReceiver): DatosDireccionT1 {
  const d = partirNombre(receiver.name), c = partirCalle(receiver.address.line1)
  return { nombre: d.nombre, apellidos: d.apellidos, correo: correo(receiver.email), telefono: telefono(receiver.address.phone), calle: c.calle, numero: c.numero, colonia: limpia(receiver.address.colonia), municipio: limpia(receiver.address.city).slice(0, 60), estado: limpia(receiver.address.state).slice(0, 40), cp: limpia(receiver.address.cp).replace(/\D/g, ''), referencias: limpia(receiver.address.refs).slice(0, 200) || 'Sin referencias' }
}
/** Qué falta para una guía (sin inventar nada): los campos obligatorios del contrato, en palabras y por lado. */
export function faltantesGuia(origen: DatosDireccionT1, destino: DatosDireccionT1): string[] {
  const rev = (d: DatosDireccionT1, lado: string) => ([['nombre', 'nombre'], ['apellidos', 'apellidos'], ['correo', 'correo'], ['telefono', 'teléfono (10 dígitos)'], ['calle', 'calle'], ['numero', 'número'], ['colonia', 'colonia'], ['municipio', 'municipio'], ['estado', 'estado'], ['referencias', 'referencias']] as Array<[keyof DatosDireccionT1, string]>)
    .filter(([k]) => !d[k] || (k === 'telefono' && !/^\d{10}$/.test(d.telefono))).map(([, l]) => `${lado}: ${l}`)
  return [...rev(origen, 'origen'), ...rev(destino, 'destino')]
}
/** Dónde se corrige cada faltante (el origen vive en Configuración → Origen de envíos; el destino en el pedido). */
export const PISTA_ORIGEN_T1 = 'El origen sale de Configuración → Origen de envíos: captura calle, número exterior, colonia, referencias, teléfono, correo y, en "Nombre / remitente", nombre y apellido de la persona de contacto (T1 exige nombre y apellido).'
/** Contrato OFICIAL de la guía: nombres de campo por lado (prefijos origin_ y destination_). */
export const CAMPOS_GUIA_V2: Record<keyof DatosDireccionT1, string | null> = { nombre: 'first_name', apellidos: 'last_name', correo: 'email', telefono: 'phone', calle: 'street', numero: 'number', colonia: 'neighborhood', municipio: 'municipality', estado: 'state', referencias: 'references', cp: null }
export interface GuiaV2Request extends Record<string, unknown> { quote_token: string; content: string; business_id: string; generate_pickup: false; has_notification: false }
/**
 * Request oficial: quote_token, content (≤ 25), business_id = shop_id del header, origin_… y destination_… obligatorios,
 * origin_business_name opcional (razón social), generate_pickup y has_notification en false (T1-A), y SIN `guide_origin`
 * (se omite: el transportista lo fija el token del servicio elegido). Lanza si falta un obligatorio: nunca se inventa.
 */
export function buildGuideT1(quoteToken: string, orderRef: string, shopId: string, origen: DatosDireccionT1, destino: DatosDireccionT1, razonSocial?: string): GuiaV2Request {
  const falta = faltantesGuia(origen, destino)
  if (!limpia(quoteToken)) falta.unshift('token de cotización')
  if (falta.length) throw new Error(`faltan: ${falta.join(', ')}`)
  const lado = (prefijo: 'origin' | 'destination', d: DatosDireccionT1) => Object.fromEntries((Object.keys(CAMPOS_GUIA_V2) as Array<keyof DatosDireccionT1>).filter((k) => CAMPOS_GUIA_V2[k]).map((k) => [`${prefijo}_${CAMPOS_GUIA_V2[k]}`, d[k]]))
  return { quote_token: limpia(quoteToken), content: `Pedido ${orderRef}`.slice(0, 25), business_id: shopId, ...(limpia(razonSocial) ? { origin_business_name: limpia(razonSocial).slice(0, 60) } : {}), ...lado('origin', origen), ...lado('destination', destino), generate_pickup: false, has_notification: false }
}
export interface GuiaT1 { tracking: string; orderNumber: string | null; carrier: string; cost: number | null; labelUrl: string | null; labelBase64: string | null; extendedZone: boolean | null; currentBalance: number | null }
export type LecturaGuia = { ok: true; guia: GuiaT1 } | { ok: false; motivo: 'rechazada' | 'sin_guia' | 'forma_no_reconocida'; mensaje: string; forma: string }
/** Respuesta OFICIAL de la guía: `success === true` y `detail.tracking_number`. `file` = PDF base64 (nunca a logs); `guide_link` = PDF en S3 (no permanente). */
// deno-lint-ignore no-explicit-any
export function parseGuideT1(data: any): LecturaGuia {
  if (!data || typeof data !== 'object' || !('success' in data)) return { ok: false, motivo: 'forma_no_reconocida', mensaje: 'T1 respondió en un formato no reconocido.', forma: formaDe(data) }
  const d = (data.detail && typeof data.detail === 'object' ? data.detail : {}) as Record<string, unknown>
  if (data.success !== true) return { ok: false, motivo: 'rechazada', mensaje: limpia(String(data.message ?? '')).slice(0, 160) || 'T1 no generó la guía.', forma: formaDe(data) }
  const tracking = limpia(String(d.tracking_number ?? ''))
  if (!tracking) return { ok: false, motivo: 'sin_guia', mensaje: 'T1 respondió éxito sin número de guía.', forma: formaDe(data) }
  const raw = typeof d.file === 'string' ? d.file.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '') : ''
  const link = limpia(String(d.guide_link ?? ''))
  return { ok: true, guia: {
    tracking, orderNumber: d.order_number != null ? String(d.order_number) : null, carrier: carrierT1(String(d.carrier ?? '')) || 'T1 Envíos',
    cost: numONull(d.cost), labelUrl: /^https?:\/\//.test(link) ? link : null, labelBase64: /^[A-Za-z0-9+/=]{100,}$/.test(raw) ? raw : null,
    extendedZone: bool(d.extended_zone), currentBalance: numONull(d.current_balance),
  } }
}

// ── Errores y reintentos ───────────────────────────────────────────────────────────────────────────
/** Depura un texto antes de mostrarlo o registrarlo: correos, teléfonos/números largos y tokens largos se ocultan; máximo 200. */
export function depurarTexto(t: string): string {
  return limpia(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '[token]')
    .replace(/\b\d[\d\s().-]{6,}\d\b/g, '[número]')
    .slice(0, 200)
}
/** Texto de error de T1 (message / error / detail.message / detail.error / errors[]), depurado y recortado; nunca cabeceras ni lo que enviamos. */
// deno-lint-ignore no-explicit-any
export function mensajeT1(data: any): string {
  const d = data?.detail
  const cand = [data?.message, data?.error, d?.message, d?.error, Array.isArray(data?.errors) ? data.errors.map((e: unknown) => typeof e === 'string' ? e : (e as { message?: string })?.message ?? '').filter(Boolean).join('; ') : '', typeof d === 'string' ? d : '']
  const m = cand.map((x) => limpia(typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x))).find(Boolean) ?? ''
  return depurarTexto(m)
}
/** Línea de diagnóstico para los logs de la Edge: código, texto de T1 y FORMA de la respuesta (solo llaves). Sin datos enviados ni cabeceras. */
// deno-lint-ignore no-explicit-any
export function diagnosticoT1(etapa: string, status: number, data: any): string {
  // error/errorType de T1 (códigos y tipos, no datos personales) ayudan a distinguir validación, configuración de tienda o falla interna.
  const extra = [data?.error, data?.errorType].map((x) => (typeof x === 'string' ? depurarTexto(x).slice(0, 80) : '')).filter(Boolean).join(' / ')
  return `[t1] ${etapa} · HTTP ${status} · ${mensajeT1(data) || 'sin mensaje'}${extra ? ` · ${extra}` : ''} · forma ${formaDe(data)}`
}
export type ClaseErrorT1 = 'credenciales' | 'sin_saldo' | 'limite' | 'proveedor' | 'cotizacion' | 'token_vencido'
/** Clasifica y redacta sin exponer cabeceras ni la respuesta completa (errores documentados: 400, 401, 402, 409, 500). */
// deno-lint-ignore no-explicit-any
export function errorT1(status: number, data: any): { clase: ClaseErrorT1; mensaje: string } {
  const m = mensajeT1(data)   // ya depurado (sin correos, números largos ni tokens) y recortado
  if (status === 401 || status === 403) return { clase: 'credenciales', mensaje: 'T1 rechazó la llave o el shop_id, o la llave expiró (revisa el ambiente y las credenciales).' }
  if (status === 402) return { clase: 'sin_saldo', mensaje: 'T1: saldo insuficiente en la cuenta para generar la guía.' }
  if (status === 409) return { clase: 'token_vencido', mensaje: 'T1: la cotización ya se usó o venció. Vuelve a cotizar y confirma el servicio y el precio.' }
  if (status === 429) return { clase: 'limite', mensaje: 'T1: demasiadas solicitudes; espera un momento y vuelve a intentar.' }
  if (status === 400 || status === 422) return { clase: 'cotizacion', mensaje: m ? `T1: ${m}` : 'T1 no aceptó los datos enviados.' }
  // 5xx: se conserva el texto de T1 (su sandbox explica errores de validación también con 500); sin texto, solo el código.
  if (status >= 500) return { clase: 'proveedor', mensaje: m ? `T1 respondió ${status}: ${m}` : `T1 no está disponible (${status}).` }
  return { clase: 'proveedor', mensaje: m ? `T1: ${m}` : `T1 respondió ${status}.` }
}
/** Solo las consultas idempotentes (cotizar) se reintentan: 429 y 5xx, con espera exponencial; la guía NUNCA se reintenta sola. */
export const reintentableCotizacion = (status: number) => status === 429 || status >= 500
export const esperaReintentoMs = (intento: number, base = 600) => Math.min(8000, base * 2 ** intento)
export const TIMEOUT_MS = { cotizar: 20_000, guia: 30_000 } as const

// ── DIAGNÓSTICO TEMPORAL (sandbox) · GET /t1-shipping/wallet/movements con `seller_id` (NO shop_id) ──────────────────
// Una sola lectura, solo Dirección, solo ambiente test, para saber si la llave y el seller_id (candidato = T1_SHOP_ID) son
// reconocidos por T1. Se devuelve un resumen mínimo; nunca el cuerpo completo, límites, datos bancarios ni movimientos.
export function cabecerasWalletT1(cfg: T1Config): Record<string, string> {
  return { 'X-Api-Key': cfg.apiKey, seller_id: cfg.shopId }
}
export interface ResumenWallet { http: number; success: boolean | null; seller_coincide: boolean | null; current_balance: number | null; error: string | null; errorType: string | null }
const buscarSeller = (o: unknown, nivel = 0): string | null => {
  if (!o || typeof o !== 'object' || nivel > 3) return null
  const r = o as Record<string, unknown>
  for (const k of ['seller_id', 'sellerId', 'id_seller']) { const v = r[k]; if (typeof v === 'string' || typeof v === 'number') return String(v) }
  for (const v of Object.values(r)) { const h = buscarSeller(Array.isArray(v) ? v[0] : v, nivel + 1); if (h) return h }
  return null
}
// deno-lint-ignore no-explicit-any
export function resumenWalletT1(status: number, data: any, sellerEsperado: string): ResumenWallet {
  const ok = status >= 200 && status < 300 && data?.success === true
  const seller = buscarSeller(data)
  const bal = ok ? n(data?.detail?.current_balance ?? data?.current_balance ?? data?.detail?.balance ?? data?.balance) : NaN
  const err = ok ? '' : depurarTexto(String(data?.error ?? data?.message ?? '')).slice(0, 120)
  return {
    http: status, success: typeof data?.success === 'boolean' ? data.success : null,
    seller_coincide: seller == null ? null : seller === String(sellerEsperado),
    current_balance: ok && Number.isFinite(bal) ? bal : null,
    error: err || null, errorType: typeof data?.errorType === 'string' ? depurarTexto(data.errorType).slice(0, 60) : null,
  }
}
