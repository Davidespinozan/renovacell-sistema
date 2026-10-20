// ============================================================================
// Adaptador T1 Envíos (agregador de Grupo Carso: FedEx, DHL, UPS, Estafeta, 99 Minutos, AMPM…) — NEUTRAL→T1 y T1→NEUTRAL.
// Contrato según la documentación oficial (t1docs.dev.plataformat1.com/docs/T1Envios):
//   Auth: Keycloak OpenID, POST <T1_AUTH_URL> (x-www-form-urlencoded) grant_type=password, client_id, client_secret,
//         username, password → access_token (expira en `expires_in` s; se cachea en memoria con margen).
//   Cabeceras de la API: Authorization: Bearer <token> · shop_id: <T1_SHOP_ID>
//   POST /quote/create            → cotización por paquetería/servicio con un `token` por servicio (vale para crear la guía)
//   POST /guide/create            → guía a partir de `token_quote`; devuelve `guia`, `file` (PDF), `link_guia`, `paqueteria`, `costo`
//   GET  /webhook-maestro/query/estado-guia/:guia → estado (familia_externa / familia_interna)
//   POST /pickup/create           → recolección (devuelve pick_up)
// El HOST de la API (T1_API_URL) y las credenciales los entrega T1 al abrir la cuenta de API; sin ellos la Edge responde 501.
// Módulo PURO salvo `t1Token` (recibe fetch): las funciones de armado/lectura las prueba vitest desde el frontend.
// ============================================================================
import type { NeutralPackage, NeutralReceiver, NeutralShipper } from './dhl.ts'

export interface T1Config { base: string; authUrl: string; clientId: string; clientSecret: string; username: string; password: string; shopId: string; comercioId: string }

/** Lee la configuración de los secretos. Devuelve null (→ 501) si falta algo indispensable. */
export function t1Config(env: (k: string) => string | undefined): T1Config | null {
  const g = (k: string) => (env(k) ?? '').trim()
  const cfg: T1Config = {
    base: g('T1_API_URL').replace(/\/+$/, ''), authUrl: g('T1_AUTH_URL'), clientId: g('T1_CLIENT_ID') || 't1envios', clientSecret: g('T1_CLIENT_SECRET'),
    username: g('T1_USERNAME'), password: g('T1_PASSWORD'), shopId: g('T1_SHOP_ID'), comercioId: g('T1_COMERCIO_ID') || g('T1_SHOP_ID'),
  }
  if (!cfg.base || !cfg.authUrl || !cfg.clientSecret || !cfg.username || !cfg.password || !cfg.shopId) return null
  // Valores de relleno ("...", "<host>") no cuentan como configuración: mejor 501 claro que un error de red confuso.
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(cfg.base) || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(cfg.authUrl) || /^\.{2,}$|^<.*>$/.test(cfg.clientSecret + cfg.username + cfg.password + cfg.shopId)) return null
  return cfg
}
export const T1_SECRETOS = ['T1_API_URL', 'T1_AUTH_URL', 'T1_CLIENT_SECRET', 'T1_USERNAME', 'T1_PASSWORD', 'T1_SHOP_ID']

// ── Token (cache en memoria del aislado; margen de 60 s) ─────────────────────────────────────────────
let cache: { token: string; hasta: number; clave: string } | null = null
export async function t1Token(cfg: T1Config, fetchFn: typeof fetch = fetch, ahora = Date.now()): Promise<string> {
  const clave = `${cfg.authUrl}|${cfg.username}`
  if (cache && cache.clave === clave && cache.hasta > ahora) return cache.token
  const body = new URLSearchParams({ grant_type: 'password', client_id: cfg.clientId, client_secret: cfg.clientSecret, username: cfg.username, password: cfg.password })
  const r = await fetchFn(cfg.authUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const d = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!r.ok || !d.access_token) throw new Error(`T1 no aceptó las credenciales (${r.status}${d.error_description ? ': ' + d.error_description : ''})`)
  const vida = Math.max(60, Number(d.expires_in ?? 1800))
  cache = { token: d.access_token, hasta: ahora + (vida - 60) * 1000, clave }
  return d.access_token
}
export function _olvidarTokenT1() { cache = null }
export function cabecerasT1(cfg: T1Config, token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, shop_id: cfg.shopId }
}

// ── Utilería de datos ───────────────────────────────────────────────────────────────────────────────
const limpia = (t?: string | null) => String(t ?? '').replace(/\s+/g, ' ').trim()
const entero = (n: number, min = 1) => Math.max(min, Math.ceil(Number(n) || 0))
/** "Dra. Ana María Ruiz Pérez" → nombre "Ana María", apellidos "Ruiz Pérez" (T1 exige ambos; sin apellido se repite el nombre). */
export function partirNombre(completo: string): { nombre: string; apellidos: string } {
  const partes = limpia(completo).replace(/^(dr|dra|lic|ing|sr|sra|srta)\.?\s+/i, '').split(' ').filter(Boolean)
  if (partes.length === 0) return { nombre: '', apellidos: '' }
  if (partes.length === 1) return { nombre: partes[0], apellidos: partes[0] }
  if (partes.length === 2) return { nombre: partes[0], apellidos: partes[1] }
  const corte = partes.length >= 4 ? partes.length - 2 : partes.length - 1
  return { nombre: partes.slice(0, corte).join(' '), apellidos: partes.slice(corte).join(' ') }
}
/** "Blvd. Pedro Infante 2911 int. 4" → calle "Blvd. Pedro Infante", número "2911 int. 4"; sin número → "S/N". */
export function partirCalle(line1: string): { calle: string; numero: string } {
  const t = limpia(line1)
  const m = /^(.*?[a-záéíóúñ.)])\s+(#?\s*\d[\w\-/]*(?:\s*(?:int|interior|depto|local|piso|no\.?|num\.?)[\s.]*[\w\-/]+)*)\s*$/i.exec(t)
  if (m && m[1].length >= 3) return { calle: m[1].trim().slice(0, 100), numero: m[2].replace(/^#\s*/, '').trim().slice(0, 30) }
  const m2 = /^(.*?)\s+(\d[\w\-/]*)\s*,?\s*(.*)$/.exec(t)
  if (m2 && m2[1].length >= 3) return { calle: m2[1].trim().slice(0, 100), numero: [m2[2], m2[3]].filter(Boolean).join(' ').trim().slice(0, 30) }
  return { calle: t.slice(0, 100) || 'Domicilio conocido', numero: 'S/N' }
}
const telefono = (t?: string | null) => limpia(t).replace(/\D/g, '').slice(-10)
const municipioDe = (city?: string | null) => limpia(city).slice(0, 60)
const correo = (e?: string | null) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpia(e)) ? limpia(e) : '')

// ── Cotización ─────────────────────────────────────────────────────────────────────────────────────
export function buildQuoteT1(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage, comercioId: string, diasEmbarque = 1, valorPaquete = 0) {
  return {
    codigo_postal_origen: limpia(shipper.cp).replace(/\D/g, ''), codigo_postal_destino: limpia(receiver.address.cp).replace(/\D/g, ''),
    peso: entero(pkg.weightKg), largo: entero(pkg.lengthCm), ancho: entero(pkg.widthCm), alto: entero(pkg.heightCm),
    dias_embarque: diasEmbarque, seguro: valorPaquete > 0 ? 1 : 0, valor_paquete: valorPaquete, tipo_paquete: 2, comercio_id: comercioId,
    paquetes: entero(pkg.pieces), generar_recoleccion: false,
  }
}
const NOMBRE_PAQUETERIA: Record<string, string> = { FEDEX: 'FedEx', DHL: 'DHL', UPS: 'UPS', ESTAFETA: 'Estafeta', EXPRESS: 'Express', '99MIN': '99 Minutos', AMPM: 'AM PM', T1ENVIOS: 'T1 Envíos', REDPACK: 'Redpack', PAQUETEXPRESS: 'Paquetexpress' }
export const carrierT1 = (clave: string) => NOMBRE_PAQUETERIA[limpia(clave).toUpperCase()] ?? limpia(clave)
const NOMBRE_SERVICIO: Record<string, string> = { EXPRESSDOMESTIC: 'Express', STANDARD: 'Estándar', ECONOMY: 'Económico', GROUND: 'Terrestre', TERRESTRE: 'Terrestre', DIASIGUIENTE: 'Día siguiente', NEXTDAY: 'Día siguiente', SAVER: 'Saver' }
const servicioBonito = (clave: string) => NOMBRE_SERVICIO[limpia(clave).toUpperCase().replace(/[^A-Z0-9]/g, '')] ?? limpia(clave).replace(/_/g, ' ')

export interface TarifaT1 { id: string; carrier: string; service: string; serviceCode: string; amount: number; currency: string; etaDays: number; token: string }
/** serviceCode = "<PAQUETERIA>|<SERVICIO>": estable entre cotizaciones; el `token` cambia en cada una y solo vive en el servidor. */
// deno-lint-ignore no-explicit-any
export function parseQuoteT1(data: any): TarifaT1[] {
  const out: TarifaT1[] = []
  const lista = Array.isArray(data?.result) ? data.result : []
  for (const r of lista) {
    const paq = limpia(r?.clave ?? r?.paqueteria ?? r?.comercio).toUpperCase()
    const servicios = r?.cotizacion?.servicios
    if (!paq || !servicios || typeof servicios !== 'object') continue
    for (const [clave, v] of Object.entries(servicios as Record<string, { costo_total?: unknown; dias_entrega?: unknown; moneda?: unknown; token?: unknown }>)) {
      const amount = Number(v?.costo_total), token = limpia(String(v?.token ?? ''))
      if (!Number.isFinite(amount) || amount <= 0 || !token) continue
      const serviceCode = `${paq}|${limpia(clave).toUpperCase()}`
      out.push({ id: serviceCode, serviceCode, carrier: carrierT1(paq), service: servicioBonito(clave), amount, currency: limpia(String(v?.moneda ?? 'MXN')) || 'MXN', etaDays: Math.max(1, Number(v?.dias_entrega) || 2), token })
    }
  }
  return out.sort((a, b) => a.amount - b.amount)
}

// ── Guía ───────────────────────────────────────────────────────────────────────────────────────────
export function buildGuideT1(shipper: NeutralShipper, receiver: NeutralReceiver, token: string, orderRef: string, comercioId: string, origenColonia = '') {
  const o = partirNombre(shipper.name), oc = partirCalle(shipper.addressLine1)
  const d = partirNombre(receiver.name), dc = partirCalle(receiver.address.line1)
  return {
    contenido: `Pedido ${orderRef}`.slice(0, 25), token_quote: token, generar_recoleccion: false, tiene_notificacion: false, origen_guia: 't1envios', comercio_id: comercioId,
    nombre_origen: o.nombre || shipper.name, apellidos_origen: o.apellidos || shipper.name, email_origen: correo(shipper.email), nombre_comercio_origen: limpia(shipper.name).slice(0, 60),
    calle_origen: oc.calle, numero_origen: oc.numero, colonia_origen: limpia(origenColonia) || 'Centro', municipio_origen: municipioDe(shipper.city), estado_origen: limpia(shipper.state).slice(0, 40),
    telefono_origen: telefono(shipper.phone), referencias_origen: 'Sucursal',
    nombre_destino: d.nombre || receiver.name, apellidos_destino: d.apellidos || receiver.name, email_destino: correo(receiver.email) || correo(shipper.email),
    calle_destino: dc.calle, numero_destino: dc.numero, colonia_destino: limpia(receiver.address.colonia) || 'Centro', municipio_destino: municipioDe(receiver.address.city), estado_destino: limpia(receiver.address.state).slice(0, 40),
    telefono_destino: telefono(receiver.address.phone), referencias_destino: limpia(receiver.address.refs).slice(0, 200) || 'Sin referencias',
  }
}
export interface GuiaT1 { tracking: string; labelBase64: string | null; labelUrl: string | null; carrier: string; cost: number | null; numOrden: string | null }
// deno-lint-ignore no-explicit-any
export function parseGuideT1(data: any): GuiaT1 {
  const d = data?.detail ?? data ?? {}
  const tracking = limpia(String(d?.guia ?? d?.numero_guia ?? ''))
  const raw = typeof d?.file === 'string' ? d.file : ''
  let labelBase64: string | null = null
  if (raw.startsWith('%PDF')) labelBase64 = btoa(Array.from(raw as string, (ch: string) => String.fromCharCode(ch.charCodeAt(0) & 0xff)).join(''))   // PDF crudo → base64
  else if (/^(data:application\/pdf;base64,)?[A-Za-z0-9+/=\s]{100,}$/.test(raw)) labelBase64 = raw.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '')
  const link = limpia(String(d?.link_guia ?? ''))
  const cost = Number(d?.costo)
  return { tracking, labelBase64, labelUrl: /^https?:\/\//.test(link) ? link : null, carrier: carrierT1(String(d?.paqueteria ?? '')) || 'T1 Envíos', cost: Number.isFinite(cost) ? cost : null, numOrden: d?.num_orden != null ? String(d.num_orden) : null }
}

// ── Rastreo ────────────────────────────────────────────────────────────────────────────────────────
/** T1 reporta "YYYY-MM-DD HH:MM:SS" en hora del centro de México (UTC-6 fijo desde 2022); se convierte a ISO sin depender de la zona del proceso. */
export function fechaT1(f: string): string {
  const t = limpia(f).replace(' ', 'T')
  if (!t) return ''
  const iso = /[zZ]|[+-]\d{2}:\d{2}$/.test(t) ? t : `${t}-06:00`
  return Number.isNaN(Date.parse(iso)) ? '' : new Date(iso).toISOString()
}
// deno-lint-ignore no-explicit-any
export function parseTrackingT1(data: any): { status: string; events: Array<{ at: string; status: string; description: string; location?: string }> } {
  const d = data?.detail ?? {}
  const status = limpia(String(d?.familia_externa ?? d?.familia_interna ?? '')) || 'unknown'
  const fecha = limpia(String(d?.fecha ?? ''))
  const at = fechaT1(fecha)
  const description = [limpia(String(d?.descripcion ?? '')), limpia(String(d?.familia_interna ?? ''))].filter(Boolean).join(' · ')
  return { status, events: at ? [{ at, status: limpia(String(d?.codigo ?? '')) || status, description }] : [] }
}

// ── Recolección ────────────────────────────────────────────────────────────────────────────────────
export interface PickupT1Input { date: string; ready: string; close: string; instructions?: string }
export function buildPickupT1(shipper: NeutralShipper, pkg: NeutralPackage, mensajeria: string, i: PickupT1Input, comercioId: string, origenColonia = '') {
  const o = partirNombre(shipper.name), oc = partirCalle(shipper.addressLine1)
  return {
    mensajeria: limpia(mensajeria).toUpperCase(), nombre_contacto: o.nombre || shipper.name, apellidos_contacto: o.apellidos || shipper.name, email: correo(shipper.email),
    calle: oc.calle, numero: oc.numero, colonia: limpia(origenColonia) || 'Centro', telefono: telefono(shipper.phone), estado: limpia(shipper.state).slice(0, 40), municipio: municipioDe(shipper.city),
    codigo_postal: limpia(shipper.cp).replace(/\D/g, ''), referencias: limpia(i.instructions).slice(0, 200) || 'Recepción', cantidad_piezas: entero(pkg.pieces), peso: entero(pkg.weightKg),
    largo: entero(pkg.lengthCm), ancho: entero(pkg.widthCm), alto: entero(pkg.heightCm), fecha: i.date, hora_inicio: i.ready, horario_cierre: i.close, comercio_id: comercioId,
  }
}
// deno-lint-ignore no-explicit-any
export function parsePickupT1(data: any): { confirmation: string } {
  const r = data?.detail?.recoleccion ?? data?.detail ?? {}
  return { confirmation: limpia(String(r?.pick_up ?? r?.confirmacion ?? r?.id ?? '')) }
}

// ── Errores ────────────────────────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
export function t1ErrorMessage(status: number, data: any): string {
  const m = limpia(String(data?.message ?? data?.error ?? data?.detail?.recoleccion?.mensaje ?? ''))
  if (status === 401 || status === 403) return 'T1 rechazó las credenciales o el shop_id.'
  if (m) return `T1: ${m.slice(0, 200)}`
  return `T1 respondió ${status}.`
}
