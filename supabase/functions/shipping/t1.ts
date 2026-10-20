// ============================================================================
// Adaptador T1 Envíos · API v2.0 (T1 Cuenta) — NEUTRAL→T1 y T1→NEUTRAL.
// Autenticación: cabeceras `X-Api-Key: <llave>` y `shop_id: <tienda>`; NO hay Keycloak ni usuario/contraseña en la v2.0.
// Ambientes (registro explícito; el host sale del ambiente, nunca del cliente ni de una URL libre):
//   test       → https://sandbox.t1api.com              (documentado en T1 Cuenta)
//   production → SIN CONFIRMAR: hasta que T1 publique el host productivo, production falla de forma segura.
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
/** Registro de ambientes: el host productivo se agrega aquí cuando T1 lo confirme; mientras, production no opera. */
export const HOSTS_T1: Record<AmbienteT1, string | null> = { test: 'https://sandbox.t1api.com', production: null }
export const RUTAS_T1 = { cotizar: '/t1-shipping/quote/create-with-quote', guia: '/t1-shipping/guide/create-guide' } as const
/** Evidencia de contrato: false = no se opera esa parte hasta tener el esquema oficial o un fixture real sanitizado. */
export const CONTRATO_T1 = { cotizacion_request: true, cotizacion_response: true, guia_request_campos_direccion: true, guia_response: true, rastreo: false, recoleccion: false } as const
export const T1_SECRETOS = ['T1_API_ENV', 'T1_API_KEY', 'T1_SHOP_ID'] as const

export interface T1Config { ambiente: AmbienteT1; base: string; apiKey: string; shopId: string }
export type ConfigT1 = { ok: true; cfg: T1Config } | { ok: false; motivo: 'sin_configurar' | 'ambiente_invalido' | 'relleno' | 'produccion_sin_host'; detalle: string }

const RELLENO = /^\s*$|^\.{2,}$|^<.*>$|^cambiar|^xxx+$|^tu[_ -]|^your[_ -]/i
/** Lee y valida la configuración desde los secretos. Nunca devuelve ni registra la llave fuera de `cfg`. */
export function t1Config(env: (k: string) => string | undefined): ConfigT1 {
  const g = (k: string) => (env(k) ?? '').trim()
  const ambiente = g('T1_API_ENV').toLowerCase(), apiKey = g('T1_API_KEY'), shopId = g('T1_SHOP_ID')
  if (!ambiente && !apiKey && !shopId) return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${T1_SECRETOS.join(', ')}.` }
  if (ambiente !== 'test' && ambiente !== 'production') return { ok: false, motivo: 'ambiente_invalido', detalle: 'T1_API_ENV debe ser test o production.' }
  if (!apiKey || !shopId) return { ok: false, motivo: 'sin_configurar', detalle: `Faltan ${[!apiKey && 'T1_API_KEY', !shopId && 'T1_SHOP_ID'].filter(Boolean).join(' y ')}.` }
  if (RELLENO.test(apiKey) || RELLENO.test(shopId) || apiKey.length < 16) return { ok: false, motivo: 'relleno', detalle: 'La llave o el shop_id parecen de relleno.' }
  const base = HOSTS_T1[ambiente]
  if (!base) return { ok: false, motivo: 'produccion_sin_host', detalle: 'El host productivo de T1 no está confirmado; production no opera hasta registrarlo.' }
  return { ok: true, cfg: { ambiente, base, apiKey, shopId } }
}
export function cabecerasT1(cfg: T1Config): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey, shop_id: cfg.shopId }
}
export const urlT1 = (cfg: T1Config, ruta: string) => `${cfg.base}${ruta}`
/** Texto seguro para logs/UI: nunca la llave. */
export const describirT1 = (cfg: T1Config) => `T1 ${cfg.ambiente === 'test' ? 'sandbox' : 'producción'} · shop ${cfg.shopId.slice(0, 2)}…`

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
export interface QuoteV2Request { home: boolean; origin_postal_code: string; destination_postal_code: string; weight: number; length: number; width: number; height: number; shipping_days: number; insurance: boolean; valor_paquete: number; package_type: number; packages: number }
export function buildQuoteT1(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage, valorMercancia: number, diasEmbarque = 0): QuoteV2Request {
  const valor = Number(valorMercancia)
  return {
    home: false, origin_postal_code: limpia(shipper.cp).replace(/\D/g, ''), destination_postal_code: limpia(receiver.address.cp).replace(/\D/g, ''),
    weight: entero(pkg.weightKg), length: entero(pkg.lengthCm), width: entero(pkg.widthCm), height: entero(pkg.heightCm),
    shipping_days: Math.max(0, Math.floor(diasEmbarque)), insurance: false, valor_paquete: Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : 0, package_type: 2, packages: entero(pkg.pieces),
  }
}
export function faltantesCotizacion(q: QuoteV2Request): string[] {
  const f: string[] = []
  if (!/^\d{5}$/.test(q.origin_postal_code)) f.push('C.P. de origen (5 dígitos)')
  if (!/^\d{5}$/.test(q.destination_postal_code)) f.push('C.P. de destino (5 dígitos)')
  if (!(q.weight > 0 && q.length > 0 && q.width > 0 && q.height > 0)) f.push('peso y medidas del paquete')
  if (!(q.valor_paquete > 0)) f.push('valor de la mercancía del pedido (renglones con precio)')
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
  return `[t1] ${etapa} · HTTP ${status} · ${mensajeT1(data) || 'sin mensaje'} · forma ${formaDe(data)}`
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
