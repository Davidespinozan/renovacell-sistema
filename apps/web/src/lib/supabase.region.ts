// PERF: las Edges corren junto a la base (us-west-1). Sin esto Supabase las ejecuta en la región
// más cercana al usuario (us-east-2 desde Culiacán) y cada consulta de la Edge cruza el país.
// Va como parámetro y no como cabecera x-region: la cabecera exigiría tocar el CORS de cada Edge.
export const REGION_EDGES = 'us-west-1'
export function conRegion(u: string): string {
  if (!u.includes('/functions/v1/') || u.includes('forceFunctionRegion=')) return u
  return u + (u.includes('?') ? '&' : '?') + 'forceFunctionRegion=' + REGION_EDGES
}
export function fetchConRegion(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string') return fetch(conRegion(input), init)
  if (input instanceof URL) return fetch(conRegion(input.href), init)
  return fetch(input, init)
}
