// CC-0B · CORS por lista blanca para las Edge Functions que llama un navegador.
//
// Antes: `Access-Control-Allow-Origin: *` en 16 funciones. Ahora el servidor solo
// devuelve cabeceras CORS a los orígenes conocidos (más `CORS_ORIGINS`, separados por
// coma, para sumar uno sin redeploy). Nunca se refleja un Origin arbitrario.
//
// Semántica:
//   · Sin cabecera Origin (curl, servidor a servidor, webhooks): ninguna cabecera CORS; la
//     petición sigue su curso (CORS es un mecanismo del navegador).
//   · Origin permitido: `Access-Control-Allow-Origin: <ese origen>` + `Vary: Origin`.
//   · Origin desconocido: sin cabeceras CORS (el navegador bloquea la lectura); el
//     preflight OPTIONS responde 403.
//
// Sin dependencias de Deno en el módulo: `Deno.env` se lee de forma perezosa para poder
// probarlo con vitest.
export const ORIGENES_BASE: readonly string[] = [
  'https://sistema-renovacell.netlify.app',
  'https://sistema.renovacell.mx',
  'https://renovacell.mx',
  'https://www.renovacell.mx',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]
// Previsualizaciones de Netlify del MISMO sitio (solo Netlify puede crear ese subdominio).
const PREVIEW_NETLIFY = /^https:\/\/[a-z0-9-]+--sistema-renovacell\.netlify\.app$/

const CABECERAS_BASE = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cf-turnstile-response',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '600',
}

function origenesExtra(env: (k: string) => string | undefined): string[] {
  const raw = env('CORS_ORIGINS') ?? ''
  return raw.split(',').map((s) => s.trim()).filter((s) => /^https?:\/\/[^\s/]+$/.test(s))
}

function envPorDefecto(k: string): string | undefined {
  try { return (globalThis as { Deno?: { env?: { get?: (k: string) => string | undefined } } }).Deno?.env?.get?.(k) ?? undefined } catch { return undefined }
}

export function origenPermitido(origen: string | null | undefined, env: (k: string) => string | undefined = envPorDefecto): boolean {
  if (!origen) return false
  const o = origen.trim()
  if (!o || o === 'null') return false
  return ORIGENES_BASE.includes(o) || PREVIEW_NETLIFY.test(o) || origenesExtra(env).includes(o)
}

/** Cabeceras CORS para esta petición, o null si no corresponde devolver ninguna. */
export function cabecerasCors(req: Request, env: (k: string) => string | undefined = envPorDefecto): Record<string, string> | null {
  const origen = req.headers.get('origin')
  if (!origenPermitido(origen, env)) return null
  return { ...CABECERAS_BASE, 'Access-Control-Allow-Origin': origen!.trim(), 'Vary': 'Origin' }
}

/**
 * Envuelve un handler: resuelve el preflight y añade las cabeceras CORS a cualquier
 * respuesta. El handler no necesita saber nada de CORS.
 */
export function conCors(handler: (req: Request) => Promise<Response> | Response, env: (k: string) => string | undefined = envPorDefecto) {
  return async (req: Request): Promise<Response> => {
    const origen = req.headers.get('origin')
    const h = cabecerasCors(req, env)
    if (req.method === 'OPTIONS') {
      if (origen && !h) return new Response('origen no permitido', { status: 403 })
      return new Response(null, { status: 204, headers: h ?? {} })
    }
    const res = await handler(req)
    if (!h) return res
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(h)) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
