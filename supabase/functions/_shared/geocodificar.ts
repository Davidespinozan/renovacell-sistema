// DESTINO EN EL MAPA (23 nov 2026) · de una dirección del pedido a las búsquedas en OpenStreetMap (Nominatim), de la
// más precisa a la más gruesa. Puro (lo prueba vitest). Solo viaja la dirección: nunca nombre ni teléfono.
export interface DireccionPedido { line1?: string | null; colonia?: string | null; cp?: string | null; city?: string | null; state?: string | null }
export type PrecisionOsm = 'calle' | 'colonia' | 'cp'
export interface ConsultaOsm { precision: PrecisionOsm; params: Record<string, string> }

const limpia = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** «Heróico colegio militar 415 Entrega en una tienda» → «Heróico colegio militar 415» (calle y número, sin notas). */
export function calleYNumero(line1: string | null | undefined): string {
  const s = limpia(line1).replace(/(?:\b(?:no\.?|num\.?|número)(?=\s*\d)|#)\s*/gi, '')
  const m = /^(.*?\d+\s*[A-Za-z]?)(?=\s|,|-|$)/.exec(s)
  return limpia(m ? m[1] : s).slice(0, 120)
}

export function consultasOsm(a: DireccionPedido): ConsultaOsm[] {
  const base = { format: 'jsonv2', limit: '3', addressdetails: '1', countrycodes: 'mx', 'accept-language': 'es' }
  const ciudad = limpia(a.city), estado = limpia(a.state), cp = limpia(a.cp).replace(/\D/g, ''), col = limpia(a.colonia)
  const calle = calleYNumero(a.line1)
  const out: ConsultaOsm[] = []
  if (calle) out.push({ precision: 'calle', params: { ...base, street: calle, ...(ciudad ? { city: ciudad } : {}), ...(estado ? { state: estado } : {}), ...(cp ? { postalcode: cp } : {}), country: 'México' } })
  if (col) out.push({ precision: 'colonia', params: { ...base, q: [col, cp, ciudad, estado, 'México'].filter(Boolean).join(', ') } })
  if (cp) out.push({ precision: 'cp', params: { ...base, postalcode: cp, country: 'México' } })
  return out
}

const norm = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
interface ResultadoOsm { lat?: string; lon?: string; address?: Record<string, string> }
/** ¿El resultado es creíble? Nunca de otra región postal; por colonia, OSM debe confirmar que está en ESA colonia
 *  (búsqueda real: «Jorge Almada, 80200, Culiacán» devolvía una calle con ese nombre a 25 km, en Costa Rica, Sin.). */
export function resultadoCreible(r: ResultadoOsm, c: ConsultaOsm, a: DireccionPedido): boolean {
  const cp = String(a.cp ?? '').replace(/\D/g, ''), rcp = String(r.address?.postcode ?? '').replace(/\D/g, '')
  if (cp.length >= 3 && rcp.length >= 3 && cp.slice(0, 2) !== rcp.slice(0, 2)) return false
  if (c.precision === 'colonia') {
    const col = norm(a.colonia)
    const zonas = ['suburb', 'neighbourhood', 'quarter', 'residential', 'city_district'].map((k) => norm(r.address?.[k]))
    return !!col && zonas.some((z) => z && (z === col || z.includes(col) || col.includes(z)))
  }
  return true
}
/** El primer resultado de Nominatim que sea creíble → {lat,lng}; null si ninguno. */
export function elegirPunto(data: unknown, c: ConsultaOsm, a: DireccionPedido): { lat: number; lng: number } | null {
  for (const r of (Array.isArray(data) ? data : []) as ResultadoOsm[]) {
    const lat = Number(r?.lat), lng = Number(r?.lon)
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && resultadoCreible(r, c, a)) return { lat, lng }
  }
  return null
}
