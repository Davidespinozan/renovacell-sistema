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

// Fecha planeada: mañana 10:00 hora local en el formato que exige MyDHL.
function plannedDate(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T10:00:00 GMT+00:00`
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
function packagesOf(p: NeutralPackage) {
  // Un bulto con el peso/medidas reales del paquete final (mismo peso repartido si pieces>1
  // NO se fabrica: se envía 1 package con el peso total; multi-pieza real se modela luego).
  return [{ weight: p.weightKg, dimensions: { length: p.lengthCm, width: p.widthCm, height: p.heightCm } }]
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
export function buildShipmentRequest(shipper: NeutralShipper, receiver: NeutralReceiver, pkg: NeutralPackage, accountNumber: string, productCode: string, orderRef: string) {
  return {
    plannedShippingDateAndTime: plannedDate(),
    pickup: { isRequested: false },
    productCode,
    accounts: [{ typeCode: 'shipper', number: accountNumber }],
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
      packages: packagesOf(pkg),
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

export function dhlBaseUrl(env: string | undefined): string {
  return (env ?? 'test').toLowerCase() === 'production'
    ? 'https://express.api.dhl.com/mydhlapi'
    : 'https://express.api.dhl.com/mydhlapi/test'
}
