// Adaptador del PAC (Facturama) — W3-B · B3.
//
// Contrato VERIFICADO contra la documentación oficial:
//   · POST /3/cfdis                                   crear comprobante
//   · GET  /cfdi?type=issued&Serie=&folio=&page=       consulta por serie+folio
//   · GET  /cfdi?type=issued&OrderNumber=&page=        consulta por referencia nuestra
//   · GET  /cfdi/status?uuid=&issuerRfc=&receiverRfc=&total=   estatus ante el SAT
//   · identidad de la operación = (Folio, Date); reintento con los MISMOS valores
//   · máximo 10 registros por petición; la paginación inicia en 0
//   · NO existe 409 ni semántica de duplicado documentada
//
// `fetch` se inyecta a propósito: todo este módulo se prueba contra un PAC
// SIMULADO. En W3-B nada de esto se ejercita contra Facturama.
//
// Jamás se registran credenciales: `sanitiza()` es la última línea de defensa
// antes de que cualquier texto llegue a la bitácora o al operador.

export type ClaseResultado = 'timbrado' | 'fallido' | 'incierto'

export interface ResultadoPAC {
  clase: ClaseResultado
  uuid?: string
  providerRef?: string | null
  folioProveedor?: string | null
  serieProveedor?: string | null
  fechaProveedor?: string | null
  code?: string
  message?: string
}

export const TIMEOUT_PAC_MS = 30_000

// Máximo documentado por el proveedor. No se pide más porque no lo devolvería.
export const PAGINA_MAX_REGISTROS = 10
// Tope duro de páginas: la consulta de huérfano es acotada por diseño, nunca un barrido.
export const PAGINAS_MAX = 5

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CEROS_RE = /^0{8}-0{4}-0{4}-0{4}-0{12}$/

// Mismo criterio que la constraint de la base: un UUID vacío, mal formado o de
// ceros NO es prueba de timbrado.
export function uuidValido(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v.trim()) && !CEROS_RE.test(v.trim())
}

// Nunca dejar salir credenciales ni cabeceras de autorización en un texto.
export function sanitiza(s: unknown, max = 400): string {
  const t = typeof s === 'string' ? s : JSON.stringify(s ?? '')
  return (t ?? '')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic ***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/("?(?:password|pass|secret|token|apikey|api_key|authorization)"?\s*[:=]\s*)"?[^",}\s]+"?/gi, '$1***')
    .slice(0, max)
}

// deno-lint-ignore no-explicit-any
function leeUuid(d: any): string | undefined {
  const u = d?.Complement?.TaxStamp?.Uuid ?? d?.Uuid ?? d?.uuid
  return uuidValido(u) ? String(u).trim() : undefined
}

// CLASIFICACIÓN — tabla congelada del diseño. Pura y exhaustivamente probada.
// Regla que la gobierna: un resultado solo es `fallido` cuando se DEMUESTRA que
// el PAC no produjo efecto. Todo lo demás es `incierto`.
export function clasificarRespuesta(status: number, body: unknown): ResultadoPAC {
  // deno-lint-ignore no-explicit-any
  const d = body as any
  const msg = sanitiza(d?.Message ?? d?.message ?? d?.ModelState ?? '')

  if (status >= 200 && status < 300) {
    const uuid = leeUuid(d)
    if (uuid) {
      return {
        clase: 'timbrado', uuid,
        providerRef: d?.Id ?? d?.id ?? null,
        folioProveedor: d?.Folio != null ? String(d.Folio) : null,
        serieProveedor: d?.Serie != null ? String(d.Serie) : null,
        fechaProveedor: d?.Date ?? null,
      }
    }
    // 2xx sin folio fiscal válido: el PAC pudo timbrar y no lo sabemos.
    return { clase: 'incierto', code: 'respuesta_sin_uuid',
             message: msg || 'El proveedor respondió sin un folio fiscal válido.' }
  }

  if (status === 400) {
    return { clase: 'fallido', code: 'validacion',
             message: msg || 'Datos del comprobante incompletos o inválidos.' }
  }
  if (status === 401 || status === 403) {
    return { clase: 'fallido', code: 'configuracion',
             message: 'Las credenciales de facturación no son válidas o están vencidas.' }
  }
  if (status === 404) {
    return { clase: 'fallido', code: 'no_encontrado', message: msg || 'Recurso no encontrado en el proveedor.' }
  }
  // 5xx y cualquier otro código: el proveedor pudo haber timbrado.
  return { clase: 'incierto', code: status >= 500 ? 'error_proveedor' : 'respuesta_inesperada',
           message: msg || `El proveedor respondió ${status}.` }
}

export interface DepsPAC {
  fetch: typeof fetch
  base: string
  auth: string          // cabecera Authorization ya construida; nunca se registra
  timeoutMs?: number
}

async function pide(d: DepsPAC, ruta: string, init: RequestInit = {}):
  Promise<{ status: number; body: unknown } | { red: true; code: string; message: string }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), d.timeoutMs ?? TIMEOUT_PAC_MS)
  try {
    const r = await d.fetch(`${d.base}${ruta}`, {
      ...init,
      signal: ctl.signal,
      headers: { ...(init.headers ?? {}), Authorization: d.auth, Accept: 'application/json' },
    })
    const body = await r.json().catch(() => ({}))
    return { status: r.status, body }
  } catch (e) {
    const nombre = (e as { name?: string })?.name ?? ''
    return {
      red: true,
      code: nombre === 'AbortError' ? 'timeout' : 'red',
      message: nombre === 'AbortError'
        ? 'El proveedor no respondió dentro del tiempo límite.'
        : 'No se pudo contactar al proveedor.',
    }
  } finally {
    clearTimeout(t)
  }
}

// TIMBRAR. `payload` llega ya construido: este módulo no inventa importes ni
// impuestos (D-W3-4 abierta). Folio y Date vienen de la identidad congelada.
export async function timbrarEnPAC(d: DepsPAC, payload: unknown): Promise<ResultadoPAC> {
  const r = await pide(d, '/3/cfdis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if ('red' in r) return { clase: 'incierto', code: r.code, message: r.message }
  return clasificarRespuesta(r.status, r.body)
}

export interface Candidato {
  uuid: string | null
  providerRef: string | null
  serie: string | null
  folio: string | null
  fecha: string | null
  status: string | null
}

export type ResultadoBusqueda =
  | { outcome: 'encontrado'; candidatos: Candidato[] }
  | { outcome: 'vacio' }
  | { outcome: 'multiple'; candidatos: Candidato[] }
  | { outcome: 'error'; code: string; message: string }

// deno-lint-ignore no-explicit-any
function aCandidato(x: any): Candidato {
  const u = x?.Complement?.TaxStamp?.Uuid ?? x?.Uuid ?? x?.uuid
  return {
    uuid: uuidValido(u) ? String(u).trim() : null,
    providerRef: x?.Id ?? x?.id ?? null,
    serie: x?.Serie != null ? String(x.Serie) : null,
    folio: x?.Folio != null ? String(x.Folio) : null,
    fecha: x?.Date ?? null,
    status: x?.Status ?? null,
  }
}

// Consulta ACOTADA. Nunca combina `folio` con `folioStart`/`folioEnd`: la
// documentación advierte que esa mezcla produce filtrados incorrectos.
async function busca(d: DepsPAC, params: Record<string, string>): Promise<ResultadoBusqueda> {
  const vistos: Candidato[] = []
  for (let page = 0; page < PAGINAS_MAX; page += 1) {
    const qs = new URLSearchParams({ type: 'issued', page: String(page), ...params })
    const r = await pide(d, `/cfdi?${qs.toString()}`)
    if ('red' in r) return { outcome: 'error', code: r.code, message: r.message }
    if (r.status < 200 || r.status >= 300) {
      const c = clasificarRespuesta(r.status, r.body)
      return { outcome: 'error', code: c.code ?? 'consulta', message: c.message ?? 'Consulta rechazada.' }
    }
    const filas = Array.isArray(r.body) ? r.body : []
    for (const f of filas) vistos.push(aCandidato(f))
    if (filas.length < PAGINA_MAX_REGISTROS) break   // última página
  }
  if (vistos.length === 0) return { outcome: 'vacio' }
  if (vistos.length > 1) return { outcome: 'multiple', candidatos: vistos }
  return { outcome: 'encontrado', candidatos: vistos }
}

// PRIMARIA: la identidad que controlamos y que el PAC usa para deduplicar.
export const buscarPorSerieFolio = (d: DepsPAC, serie: string, folio: string) =>
  busca(d, { Serie: serie, folio })

// SECUNDARIA: nuestra propia referencia, independiente de la numeración fiscal.
export const buscarPorOrderNumber = (d: DepsPAC, orderNumber: string) =>
  busca(d, { OrderNumber: orderNumber })

export type EstatusSAT =
  | { ok: true; status: 'Vigente' | 'Cancelado' | 'No encontrado'; cancelable: string | null }
  | { ok: false; code: string; message: string }

// AUTORIDAD FINAL: no le pregunta a Facturama por su propio registro, le
// pregunta por el estado ante el SAT. Exige la identidad congelada completa.
export async function consultarEstatusSAT(
  d: DepsPAC, uuid: string, issuerRfc: string, receiverRfc: string, total: number,
): Promise<EstatusSAT> {
  if (!uuidValido(uuid)) return { ok: false, code: 'uuid_invalido', message: 'Folio fiscal no válido.' }
  const qs = new URLSearchParams({
    uuid, issuerRfc, receiverRfc, total: total.toFixed(2),
  })
  const r = await pide(d, `/cfdi/status?${qs.toString()}`)
  if ('red' in r) return { ok: false, code: r.code, message: r.message }
  if (r.status < 200 || r.status >= 300) {
    const c = clasificarRespuesta(r.status, r.body)
    return { ok: false, code: c.code ?? 'consulta', message: c.message ?? 'Consulta rechazada.' }
  }
  // deno-lint-ignore no-explicit-any
  const b = r.body as any
  const s = b?.Status ?? b?.status
  if (s !== 'Vigente' && s !== 'Cancelado' && s !== 'No encontrado') {
    return { ok: false, code: 'estatus_desconocido', message: sanitiza(s) || 'Estatus no reconocido.' }
  }
  return { ok: true, status: s, cancelable: b?.IsCancelable ?? null }
}

// ── CONSTRUCCIÓN DEL COMPROBANTE ────────────────────────────────────────────
// Deliberadamente incompleta: los renglones y sus impuestos dependen de
// decisiones fiscales ABIERTAS (D-W3-4 tasa por producto, D-W3-5 ClaveProdServ,
// D-W3-6 descripción, D-W3-1..3 forma de pago). W3-B no las inventa.
export class ConstruccionFiscalPendiente extends Error {
  readonly code = 'construccion_fiscal_pendiente'
  constructor() {
    super('La construcción fiscal del comprobante (renglones, impuestos, forma y método de pago) requiere decisiones de Dirección pendientes. El timbrado no está habilitado.')
  }
}

export interface IdentidadCFDI {
  serie: string
  folio: string
  providerDateSent: string
  orderNumber: string
  expeditionPlace: string
  currency: string
  receiver: { Rfc: string; Name: string; CfdiUse: string; FiscalRegime: string; TaxZipCode: string }
}

// Arma el sobre del comprobante con la identidad congelada. `items` NO se
// construye aquí: lo provee quien ya resolvió la política fiscal (W3-C) — o una
// prueba. Así el adaptador queda completo y probado sin inventar fiscalidad.
export function construirCFDI(id: IdentidadCFDI, items: unknown[] | null): Record<string, unknown> {
  if (items === null || items.length === 0) throw new ConstruccionFiscalPendiente()
  return {
    Serie: id.serie,
    Folio: id.folio,                 // identidad: NUNCA se regenera
    Date: id.providerDateSent,       // identidad: NUNCA se recalcula desde now()
    OrderNumber: id.orderNumber,     // nuestra referencia, estable
    Currency: id.currency,
    CfdiType: 'I',
    ExpeditionPlace: id.expeditionPlace,
    Receiver: id.receiver,
    Items: items,
  }
}
