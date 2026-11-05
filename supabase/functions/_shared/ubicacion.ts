// UBICACIÓN EN EL CHAT (5 nov 2026, pedido de Alejandra) · el personal manda una ubicación desde Conversaciones.
// Viaja como un mensaje de texto normal con formato fijo (sin migración): «📍 Nombre», la dirección y un enlace de Google
// Maps. Así se ve bien en el portal y en Instagram/Messenger (enlace), y por WhatsApp el despacho lo reconoce y la manda
// como UBICACIÓN NATIVA (pin en el mapa) cuando trae coordenadas. Pura: la usan la web y las Edges, se prueba en vitest.

export interface Ubicacion { nombre: string; direccion: string; lat: number | null; lng: number | null }

export const PIN = '📍'

/** La sucursal (para recoger). `lat/lng` en null = se manda con la dirección (búsqueda en Maps), sin pin nativo. */
export const SUCURSAL: Ubicacion = {
  nombre: 'Renovacell · Sucursal Culiacán',
  direccion: 'Boulevard Pedro Infante 2911, Desarrollo Urbano Tres Ríos, 80020 Culiacán, Sinaloa',
  lat: null, lng: null,
}

const valida = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
const redondear = (n: number) => Math.round(n * 1e6) / 1e6

export function enlaceMaps(u: Pick<Ubicacion, 'direccion' | 'lat' | 'lng'>): string {
  const q = u.lat != null && u.lng != null ? `${redondear(u.lat)},${redondear(u.lng)}` : encodeURIComponent(u.direccion)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}

/** Texto del mensaje: «📍 Nombre» / dirección / enlace. */
export function textoUbicacion(u: Ubicacion): string {
  const nombre = (u.nombre || 'Ubicación').replace(/\s+/g, ' ').trim().slice(0, 100)
  const direccion = (u.direccion || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  return [`${PIN} ${nombre}`, direccion, enlaceMaps(u)].filter(Boolean).join('\n')
}

/** Coordenadas de un enlace de Google Maps (…/@lat,lng…, ?q=, ?query=, ?ll=, !3dlat!4dlng) o de «lat, lng» escrito. */
export function coordsDeTexto(t: string): { lat: number; lng: number } | null {
  let s = (t ?? '').trim()
  try { s = decodeURIComponent(s) } catch { /* enlace con % sueltos: se lee tal cual */ }
  s = s.replace(/\+/g, ' ')
  const pruebas = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination|center)=(?:loc:)?(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/,
  ]
  for (const r of pruebas) {
    const m = s.match(r)
    if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (valida(lat, lng)) return { lat: redondear(lat), lng: redondear(lng) } }
  }
  return null
}

/** ¿El mensaje es una ubicación enviada desde el chat? Devuelve sus datos (lat/lng null si solo trae dirección). */
export function leerUbicacion(texto: string): Ubicacion | null {
  const lineas = (texto ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  if (lineas.length < 2 || !lineas[0].startsWith(PIN + ' ')) return null
  const enlace = lineas[lineas.length - 1]
  if (!/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/.test(enlace)) return null
  const c = coordsDeTexto(enlace)
  return { nombre: lineas[0].slice(PIN.length + 1).trim(), direccion: lineas.length > 2 ? lineas.slice(1, -1).join(' ') : '', lat: c?.lat ?? null, lng: c?.lng ?? null }
}

/** Cuerpo de la Cloud API para una ubicación nativa de WhatsApp (pin). Solo con coordenadas. */
export function cuerpoUbicacion(para: string, u: Ubicacion): Record<string, unknown> | null {
  if (u.lat == null || u.lng == null || !valida(u.lat, u.lng)) return null
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'location',
    location: { latitude: u.lat, longitude: u.lng, ...(u.nombre ? { name: u.nombre.slice(0, 100) } : {}), ...(u.direccion ? { address: u.direccion.slice(0, 300) } : {}) } }
}
