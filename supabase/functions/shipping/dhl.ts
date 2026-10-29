// ============================================================================
// Adaptador MyDHL API (DHL Express) — mapeo NEUTRAL→DHL y DHL→NEUTRAL.
// Campos según el contrato OFICIAL de MyDHL API REST (developer.dhl.com):
//   Base: TEST https://express.api.dhl.com/mydhlapi/test · PROD .../mydhlapi
//   Auth: HTTP Basic (API Key : API Secret)
//   POST /rates · POST /shipments · GET /shipments/{trackingNumber}/tracking
//   accounts:[{typeCode:'shipper',number}] · customerDetails{shipperDetails,receiverDetails}
//   postalAddress{postalCode,cityName,countryCode,addressLine1} + contactInformation
//   content.packages[].weight + .dimensions{length,width,height} · unitOfMeasurement 'metric'
//   respuesta shipment: shipmentTrackingNumber + documents[]{typeCode,imageFormat,content(base64)}
// La exactitud final de campos se valida contra SANDBOX (422 devuelve el campo).
// ============================================================================

// Tipos neutrales (espejo de apps/web/src/data/shipping/model.ts; el server es la autoridad).
export interface NeutralAddress { line1: string; colonia?: string; cp?: string; city?: string; state?: string; refs?: string; phone?: string }
export interface NeutralShipper { name: string; addressLine1: string; cp: string; city: string; state: string; country: string; phone: string; email: string }
export interface NeutralReceiver { name: string; email?: string | null; address: NeutralAddress }
export interface NeutralPackage { weightKg: number; lengthCm: number; widthCm: number; heightCm: number; pieces: number }

const CC = 'MX' // país de destino operativo (Renovacell = MX doméstico); no es dato por-envío.

// Fecha planeada: el SIGUIENTE DÍA HÁBIL (lunes a viernes) a las 10:00, en el formato que exige MyDHL.
// DHL D1 · antes era "mañana" fijo: un viernes o un sábado la cotización fallaba con el error 996 ("producto no
// disponible para la fecha de recolección") y Empaque no sabía por qué. No se asumen festivos de DHL: si cae en uno,
// DHL lo dirá con el mismo 996 y se vuelve a cotizar otro día.
export function siguienteDiaHabil(ahoraMs = Date.now()): Date {
  const d = new Date(ahoraMs)
  d.setUTCHours(10, 0, 0, 0)
  do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d
}
export function plannedDate(ahoraMs = Date.now()): string {
  const d = siguienteDiaHabil(ahoraMs)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T10:00:00 GMT+00:00`
}

// DHL D1 · Referencia de cliente (typeCode CU, ≤ 35) ÚNICA por intento: el id del intento sin guiones (32). Viaja en la guía
// (nivel envío y nivel paquete) y es lo que permite volver a encontrarla en DHL si el resultado quedó desconocido.
export const REFERENCIA_MAX = 35
export function referenciaIntento(attemptId: string): string {
  return attemptId.replace(/-/g, '').slice(0, REFERENCIA_MAX)
}

// MyDHL limita cada línea a 45 caracteres (más largo → 422 y no sale la guía). En México la COLONIA es clave para que
// el repartidor llegue: va en la línea 2 (antes no viajaba); las referencias en la 3. Una calle larga se parte en palabras.
const MAX_LINEA = 45
const limpia = (t?: string | null) => String(t ?? '').replace(/\s+/g, ' ').trim()
function partir(t: string, max = MAX_LINEA): [string, string] {
  if (t.length <= max) return [t, '']
  const corte = t.lastIndexOf(' ', max)
  const i = corte > max * 0.5 ? corte : max
  return [t.slice(0, i).trim(), t.slice(i).trim()]
}
export function lineasDireccion(a: NeutralAddress): { addressLine1: string; addressLine2?: string; addressLine3?: string } {
  const [l1, resto] = partir(limpia(a.line1))
  const colonia = limpia(a.colonia)
  const col = colonia ? (/^col(\.|onia)?\s/i.test(colonia) ? colonia : `Col. ${colonia}`) : ''
  const l2 = [resto, col].filter(Boolean).join(', ').slice(0, MAX_LINEA)
  const l3 = limpia(a.refs).slice(0, MAX_LINEA)
  return { addressLine1: l1, ...(l2 ? { addressLine2: l2 } : {}), ...(l3 ? { addressLine3: l3 } : {}) }
}
export function postalAddress(a: NeutralAddress, countryCode = CC) {
  const estado = limpia(a.state).slice(0, 35)
  return {
    postalCode: limpia(a.cp).replace(/\D/g, ''),
    cityName: limpia(a.city).slice(0, MAX_LINEA),
    countryCode,
    ...lineasDireccion(a),
    ...(estado ? { provinceCode: estado } : {}),
  }
}
function shipperAddress(s: NeutralShipper) {
  return { postalCode: s.cp, cityName: s.city, countryCode: s.country || CC, addressLine1: s.addressLine1, ...(s.state ? { provinceCode: s.state } : {}) }
}
function packagesOf(p: NeutralPackage, referencia?: string) {
  // Un bulto con el peso/medidas reales del paquete final (mismo peso repartido si pieces>1
  // NO se fabrica: se envía 1 package con el peso total; multi-pieza real se modela luego).
  return [{ weight: p.weightKg, dimensions: { length: p.lengthCm, width: p.widthCm, height: p.heightCm }, ...(referencia ? { customerReferences: [{ value: referencia, typeCode: 'CU' }] } : {}) }]
}

// ---- Cotización -----------------------------------------------------------
export function buildRateRequest(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage, accountNumber: string) {
  return {
    customerDetails: {
      shipperDetails: shipperAddress(shipper),
      receiverDetails: postalAddress(receiver.address),
    },
    accounts: [{ typeCode: 'shipper', number: accountNumber }],
    plannedShippingDateAndTime: plannedDate(),
    unitOfMeasurement: 'metric',
    isCustomsDeclarable: false, // doméstico MX
    packages: packagesOf(pkg),
  }
}

// deno-lint-ignore no-explicit-any
export function parseRates(data: any): Array<{ id: string; carrier: string; service: string; serviceCode?: string; amount: number; currency: string; etaDays: number }> {
  const products = Array.isArray(data?.products) ? data.products : []
  // deno-lint-ignore no-explicit-any
  return products.map((pr: any, i: number) => {
    const price = Array.isArray(pr?.totalPrice) ? pr.totalPrice[0] : undefined
    const cap = pr?.deliveryCapabilities ?? {}
    return {
      id: String(pr?.productCode ?? `dhl-${i}`),
      carrier: 'DHL',
      service: String(pr?.productName ?? 'DHL Express'),
      serviceCode: pr?.productCode ? String(pr.productCode) : undefined,
      amount: Math.round(Number(price?.price ?? 0)),
      currency: String(price?.priceCurrency ?? 'MXN').toUpperCase(),
      etaDays: Number(cap?.totalTransitDays ?? 0) || 2,
    }
  }).filter((r: { amount: number }) => r.amount > 0)
}

// ---- Creación de envío ----------------------------------------------------
export function buildShipmentRequest(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage, accountNumber: string, productCode: string, orderRef: string, referencia?: string) {
  return {
    plannedShippingDateAndTime: plannedDate(),
    pickup: { isRequested: false },
    productCode,
    accounts: [{ typeCode: 'shipper', number: accountNumber }],
    // DHL D1 · referencia CU única del intento (probada en sandbox el 23 oct 2026: DHL la acepta en raíz y en el paquete).
    ...(referencia ? { customerReferences: [{ value: referencia, typeCode: 'CU' }] } : {}),
    customerDetails: {
      shipperDetails: {
        postalAddress: shipperAddress(shipper),
        contactInformation: { phone: shipper.phone, companyName: shipper.name, fullName: shipper.name, email: shipper.email },
      },
      receiverDetails: {
        postalAddress: postalAddress(receiver.address),
        contactInformation: {
          phone: String(receiver.address.phone ?? '').replace(/[^\d+]/g, ''),
          companyName: receiver.name,
          fullName: receiver.name,
          ...(receiver.email ? { email: receiver.email } : {}),
        },
      },
    },
    content: {
      packages: packagesOf(pkg, referencia),
      isCustomsDeclarable: false,
      description: `Pedido ${orderRef}`,
      incoterm: 'DAP',
      unitOfMeasurement: 'metric',
    },
    outputImageProperties: {
      printerDPI: 300,
      encodingFormat: 'pdf', // el formato va aquí (nivel superior), NO en cada imageOptions
      imageOptions: [{ typeCode: 'label', templateName: 'ECOM26_84_001', isRequested: true }],
    },
  }
}

// ---- Recolección (PAQ-B) ---------------------------------------------------
// MyDHL API · POST /pickups (agenda que DHL pase por el paquete) y DELETE /pickups/{confirmación}.
// La hora es la LOCAL del origen: Culiacán (America/Mazatlan) va en UTC-7 todo el año.
// PENDIENTE: validar campos contra el sandbox (un 422 de DHL nombra el campo que no acepta).
export interface PickupInput { date: string; ready: string; close: string; location: string; instructions?: string }
const PICKUP_TZ = 'GMT-07:00'
export function buildPickupRequest(shipper: NeutralShipper, pkg: NeutralPackage, accountNumber: string, productCode: string, i: PickupInput) {
  const contacto = { phone: shipper.phone, companyName: shipper.name, fullName: shipper.name, email: shipper.email }
  return {
    plannedPickupDateAndTime: `${i.date}T${i.ready}:00 ${PICKUP_TZ}`,
    closeTime: i.close,
    location: i.location,
    locationType: 'business',
    accounts: [{ typeCode: 'shipper', number: accountNumber }],
    ...(i.instructions ? { specialInstructions: [{ value: i.instructions, typeCode: 'TBD' }] } : {}),
    customerDetails: {
      shipperDetails: { postalAddress: shipperAddress(shipper), contactInformation: contacto },
      pickupDetails: { postalAddress: shipperAddress(shipper), contactInformation: contacto },
    },
    shipmentDetails: [{ productCode, isCustomsDeclarable: false, unitOfMeasurement: 'metric', packages: packagesOf(pkg) }],
  }
}
// deno-lint-ignore no-explicit-any
export function parsePickup(data: any): { confirmation: string } {
  const n = Array.isArray(data?.dispatchConfirmationNumbers) ? data.dispatchConfirmationNumbers[0] : data?.dispatchConfirmationNumber
  return { confirmation: n == null ? '' : String(n).trim().slice(0, 60) }
}

// deno-lint-ignore no-explicit-any
export function parseShipment(data: any): { tracking: string; labelBase64: string | null; labelFormat: string } {
  const tracking = String(data?.shipmentTrackingNumber ?? '')
  const docs = Array.isArray(data?.documents) ? data.documents : []
  // deno-lint-ignore no-explicit-any
  const label = docs.find((d: any) => String(d?.typeCode).toLowerCase() === 'label') ?? docs[0]
  return { tracking, labelBase64: label?.content ?? null, labelFormat: String(label?.imageFormat ?? 'PDF') }
}

// ---- Tracking -------------------------------------------------------------
// deno-lint-ignore no-explicit-any
export function parseTracking(data: any): { status: string; events: Array<{ at: string; status: string; description: string; location?: string }> } {
  const sh = Array.isArray(data?.shipments) ? data.shipments[0] : data
  const evs = Array.isArray(sh?.events) ? sh.events : []
  return {
    status: String(sh?.status ?? sh?.shipmentTimestamp ?? 'in_transit'),
    // deno-lint-ignore no-explicit-any
    events: evs.map((e: any) => ({ at: String(e?.timestamp ?? e?.date ?? ''), status: String(e?.typeCode ?? e?.statusCode ?? ''), description: String(e?.description ?? ''), location: e?.location?.address?.addressLocality })),
  }
}

// Tracking de una guía VÁLIDA recién creada: MyDHL responde 404 / "No data found"
// mientras aún no hay eventos. Eso NO es un error de dominio, es "sin eventos todavía".
// deno-lint-ignore no-explicit-any
export function isTrackingNoData(status: number, data: any): boolean {
  if (status === 401 || status === 403 || status === 400) return false // auth / request inválido = error real
  if (status >= 500) return false                                       // error inesperado DHL = error real
  if (status === 404) return true                                       // guía sin eventos todavía
  const detail = String(data?.detail ?? data?.title ?? (Array.isArray(data?.additionalDetails) ? data.additionalDetails.join(' ') : ''))
  return /no data found|no result found/i.test(detail)
}
export function emptyTrackingResult(tracking: string): { tracking: string; status: string; events: []; message: string } {
  return { tracking, status: 'sin_eventos', events: [], message: 'Aún no hay eventos de seguimiento.' }
}

// Extrae un mensaje de error de DHL SIN filtrar credenciales ni el cuerpo crudo completo.
// deno-lint-ignore no-explicit-any
export function dhlErrorMessage(status: number, data: any): string {
  const detail = data?.detail ?? data?.title ?? (Array.isArray(data?.additionalDetails) ? data.additionalDetails.join('; ') : '')
  return `DHL ${status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`
}

// ---- DHL D1 · Reconciliación: localizar una guía por referencia y recuperar su etiqueta ---------------------------
// Contrato probado en sandbox (23 oct 2026): GET /tracking?shipmentReference=…&shipperAccountNumber=… (la cuenta es
// obligatoria: sin ella DHL responde 400 código 1013); 404 "No Shipments Found for ReferenceID | <ref>" cuando no hay
// nada indexado, lo mismo para una referencia inexistente que para una guía recién creada. Un 404 NUNCA prueba que la
// guía no exista. GET /shipments/{n}/get-image exige `pickupYearAndMonth` (YYYY-MM).
const fechaISO = (d: Date) => d.toISOString().slice(0, 10)
export function urlRastreoPorReferencia(base: string, referencia: string, accountNumber: string, creadoEnMs: number): string {
  const desde = fechaISO(new Date(creadoEnMs - 86_400_000)), hasta = fechaISO(new Date(creadoEnMs + 2 * 86_400_000))
  const q = new URLSearchParams({ shipmentReference: referencia, shipmentReferenceType: 'CU', shipperAccountNumber: accountNumber, dateRangeFrom: desde, dateRangeTo: hasta, trackingView: 'all-checkpoints', levelOfDetail: 'all' })
  return `${base}/tracking?${q.toString()}`
}
export function urlRastreoPorNumero(base: string, tracking: string): string {
  return `${base}/shipments/${encodeURIComponent(tracking)}/tracking?trackingView=all-checkpoints&levelOfDetail=all`
}
export function mesRecoleccion(creadoEnMs: number): string {
  return fechaISO(new Date(creadoEnMs)).slice(0, 7)
}
export function urlGetImage(base: string, tracking: string, accountNumber: string, creadoEnMs: number): string {
  const q = new URLSearchParams({ shipperAccountNumber: accountNumber, typeCode: 'label', pickupYearAndMonth: mesRecoleccion(creadoEnMs), encodingFormat: 'pdf', allInOnePDF: 'false' })
  return `${base}/shipments/${encodeURIComponent(tracking)}/get-image?${q.toString()}`
}
export type ResultadoRastreo = 'encontradas' | 'sin_resultados' | 'error'
// deno-lint-ignore no-explicit-any
export function clasificarRastreo(status: number, data: any): ResultadoRastreo {
  if (status >= 200 && status < 300) return Array.isArray(data?.shipments) && data.shipments.length ? 'encontradas' : 'sin_resultados'
  if (status === 404 && isTrackingNoData(status, data)) return 'sin_resultados'
  return 'error'
}
// Lo que la reconciliación compara con el snapshot del intento: SOLO hechos que DHL devuelve; nada se completa.
export interface GuiaHallada { tracking: string; referencias: string[]; producto: string | null; destino_cp: string | null; peso_total: number | null; piezas: number | null; eventos: number }
// deno-lint-ignore no-explicit-any
export function guiasDeRastreo(data: any): GuiaHallada[] {
  const shs = Array.isArray(data?.shipments) ? data.shipments : []
  // deno-lint-ignore no-explicit-any
  return shs.map((s: any) => {
    const refs = new Set<string>()
    for (const r of Array.isArray(s?.shipperReferences) ? s.shipperReferences : []) if (r?.value != null) refs.add(String(r.value))
    for (const p of Array.isArray(s?.pieces) ? s.pieces : []) for (const r of Array.isArray(p?.shipperReferences) ? p.shipperReferences : []) if (r?.value != null) refs.add(String(r.value))
    const peso = Number(s?.totalWeight)
    const piezas = Number(s?.numberOfPieces ?? (Array.isArray(s?.pieces) ? s.pieces.length : NaN))
    return {
      tracking: String(s?.shipmentTrackingNumber ?? ''),
      referencias: [...refs],
      producto: s?.productCode != null ? String(s.productCode) : null,
      destino_cp: s?.receiverDetails?.postalAddress?.postalCode != null ? String(s.receiverDetails.postalAddress.postalCode) : null,
      peso_total: Number.isFinite(peso) ? peso : null,
      piezas: Number.isFinite(piezas) ? piezas : null,
      eventos: Array.isArray(s?.events) ? s.events.length : 0,
    }
  }).filter((g: GuiaHallada) => g.tracking)
}
// deno-lint-ignore no-explicit-any
export function parseGetImage(data: any): string | null {
  const docs = Array.isArray(data?.documents) ? data.documents : []
  // deno-lint-ignore no-explicit-any
  const label = docs.find((d: any) => String(d?.typeCode ?? '').toLowerCase() === 'label') ?? docs[0]
  return label?.content ? String(label.content) : null
}

// Ambiente de DHL. Solo dos valores válidos: 'production' (guías reales) o 'test'/'sandbox' (sin valor = test). Cualquier
// otra cosa ('prod', 'live', 'PRODUCTION ' con espacios…) antes caía EN SILENCIO a pruebas y se imprimían guías falsas
// como reales: ahora es un error de configuración (falla cerrado).
export function dhlAmbiente(env: string | undefined): 'production' | 'test' {
  const v = (env ?? '').trim().toLowerCase()
  if (v === 'production') return 'production'
  if (v === '' || v === 'test' || v === 'sandbox') return 'test'
  throw new Error(`DHL_API_ENV inválido ("${env}"): usa exactamente production o test`)
}

export function dhlBaseUrl(env: string | undefined): string {
  return dhlAmbiente(env) === 'production'
    ? 'https://express.api.dhl.com/mydhlapi'
    : 'https://express.api.dhl.com/mydhlapi/test'
}

// ============================================================================
// DHL D1 · Consulta de reconciliación (vive aquí, sin imports, para que las pruebas web puedan cargar el módulo).
// El SERVIDOR consulta a DHL por la referencia CU única del intento y, si Dirección trae uno del portal, por número, y
// arma la evidencia que exige el comando `reconciliar_guia`. Aquí no se decide nada: se recogen hechos sin completarlos.
// ============================================================================
export const TIMEOUT_CONSULTA_MS = 20_000
export const TIMEOUT_COTIZACION_MS = 30_000
export const TIMEOUT_GUIA_MS = 60_000
export const MINUTOS_MINIMOS_SIN_GUIA = 60      // los exige el comando; aquí solo se informan a la pantalla
export const MINUTOS_VIGENCIA_CONSULTA = 30

export interface ConsultaParcial { realizada: boolean; resultado: ResultadoRastreo | 'no_realizada'; encontradas: GuiaHallada[]; http?: number; detalle?: string }
export interface ConsultaDHL {
  consultado_en: string
  referencia: string
  por_referencia: ConsultaParcial
  por_tracking?: ConsultaParcial & { tracking: string }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export async function fetchConTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms)
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }) } finally { clearTimeout(t) }
}

async function consultaParcial(fetchImpl: FetchLike, url: string, authz: string, timeoutMs: number): Promise<ConsultaParcial> {
  try {
    const r = await fetchConTimeout(fetchImpl, url, { headers: { Authorization: authz } }, timeoutMs)
    const data = await r.json().catch(() => ({}))
    const resultado = clasificarRastreo(r.status, data)
    return {
      realizada: resultado !== 'error', resultado, http: r.status,
      encontradas: resultado === 'encontradas' ? guiasDeRastreo(data) : [],
      ...(resultado === 'error' ? { detalle: dhlErrorMessage(r.status, data) } : {}),
    }
  } catch (e) {
    const abort = /abort/i.test(String((e as Error)?.name ?? '') + String((e as Error)?.message ?? ''))
    return { realizada: false, resultado: 'error', encontradas: [], detalle: abort ? 'DHL no respondió a tiempo' : 'sin respuesta de la red' }
  }
}

// Consulta completa para un intento: por referencia siempre; por número solo si Dirección lo aporta (se verifica en DHL,
// nunca se toma como prueba por sí solo).
export async function consultarDHL(o: { base: string; authz: string; account: string; referencia: string; creadoEnMs: number; tracking?: string; fetchImpl?: FetchLike; timeoutMs?: number }): Promise<ConsultaDHL> {
  const f = o.fetchImpl ?? fetch
  const ms = o.timeoutMs ?? TIMEOUT_CONSULTA_MS
  const porRef = await consultaParcial(f, urlRastreoPorReferencia(o.base, o.referencia, o.account, o.creadoEnMs), o.authz, ms)
  const tn = (o.tracking ?? '').trim()
  const porTn = tn ? { tracking: tn, ...(await consultaParcial(f, urlRastreoPorNumero(o.base, tn), o.authz, ms)) } : undefined
  return { consultado_en: new Date().toISOString(), referencia: o.referencia, por_referencia: porRef, ...(porTn ? { por_tracking: porTn } : {}) }
}

// Guías distintas halladas (por referencia y por número).
export function guiasDistintas(c: ConsultaDHL): string[] {
  const set = new Set<string>()
  for (const g of c.por_referencia.encontradas) if (g.tracking) set.add(g.tracking)
  for (const g of c.por_tracking?.encontradas ?? []) if (g.tracking) set.add(g.tracking)
  return [...set]
}

// Consulta PREVIA a crear una guía nueva en un pedido que ya tuvo un cierre `sin_guia`: fail-closed.
//   sin_resultados → se puede crear · encontradas → la guía apareció tarde, NO se recompra · error → no se crea.
export type DecisionPrevia = 'proceder' | 'guia_hallada' | 'fallo'
export function decisionPrevia(c: ConsultaDHL): DecisionPrevia {
  if (c.por_referencia.resultado === 'sin_resultados') return 'proceder'
  if (c.por_referencia.resultado === 'encontradas' && c.por_referencia.encontradas.length) return 'guia_hallada'
  return 'fallo'
}

export function horasDesde(iso: string, ahoraMs = Date.now()): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, (ahoraMs - t) / 3_600_000) : 0
}
