// PERF: las Edges corren junto a la base (us-west-1). Sin esto Supabase las ejecuta en la región
// más cercana al usuario (us-east-2 desde Culiacán) y cada consulta de la Edge cruza el país.
// Va como parámetro y no como cabecera x-region: la cabecera exigiría tocar el CORS de cada Edge.
export const REGION_EDGES = 'us-west-1'
export function conRegion(u: string): string {
  if (!u.includes('/functions/v1/') || u.includes('forceFunctionRegion=')) return u
  return u + (u.includes('?') ? '&' : '?') + 'forceFunctionRegion=' + REGION_EDGES
}
// DUEÑO COMO VENDEDOR (23 nov 2026) · mientras el dueño está en «Ver como › Ventas», cada consulta a la base (/rest/v1)
// lleva x-actuar-como: pos y el servidor lo trata como vendedor (auth_role; mig 0782). Solo a /rest/v1: las Edges no
// aceptan cabeceras nuevas por CORS. Solo sirve para bajar de Dirección a Ventas (el servidor exige el permiso «dueno»).
let actuarComo: string | null = null
export function fijarActuarComo(rol: string | null): void { actuarComo = rol }
export function conActuarComo(u: string, init?: RequestInit): RequestInit | undefined {
  if (!actuarComo || !u.includes('/rest/v1/')) return init
  const h = new Headers(init?.headers)
  h.set('x-actuar-como', actuarComo)
  return { ...init, headers: h }
}
export function fetchConRegion(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string') return fetch(conRegion(input), conActuarComo(input, init))
  if (input instanceof URL) return fetch(conRegion(input.href), conActuarComo(input.href, init))
  return fetch(input, init)
}
