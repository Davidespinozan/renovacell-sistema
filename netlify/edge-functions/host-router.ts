// Enrutado por HOSTNAME (una base / un backend / varias puertas).
//
// Por qué una Edge Function y no redirects de netlify.toml: en netlify.toml el
// campo `from` es un PATH, no admite el dominio, así que reglas tipo
// `from = "https://sistema.renovacell.mx/"` NO matchean (ganaba la genérica
// `/ -> landing`). Las Edge Functions leen el Host real y corren ANTES de los
// redirects, así que son el mecanismo robusto y predecible para esto.
//
// Un hostname NO autoriza: esto solo decide QUÉ se sirve en cada dirección; la
// autoridad sigue siendo RLS/roles del backend.
//
// Comportamiento:
//   renovacell.mx / *.netlify.app        -> passthrough (netlify.toml sirve landing y /sistema)
//   sistema.renovacell.mx  (raíz "/")    -> 301 a /sistema (la SPA vive en /sistema)
//   portal.renovacell.mx   (raíz "/")    -> 301 a /sistema
//   www / .com.mx / goldenplacenta (legado) -> 301 canónico a https://renovacell.mx (path+query)
// Cualquier otro path (/sistema/*, /assets, /manifest…) cae en passthrough.
import type { Context } from 'https://edge.netlify.com'

const CANONICAL = new Set([
  'www.renovacell.mx',
  'renovacell.com.mx',
  'www.renovacell.com.mx',
  'goldenplacenta.com',
  'www.goldenplacenta.com',
])
const APP_DOORS = new Set(['sistema.renovacell.mx', 'portal.renovacell.mx'])

export default async (request: Request, context: Context): Promise<Response | void> => {
  const url = new URL(request.url)
  const host = (request.headers.get('host') ?? url.hostname).toLowerCase()

  // 1) Dominios canónicos/legado -> 301 permanente a renovacell.mx (preserva path+query).
  if (CANONICAL.has(host)) {
    return Response.redirect(`https://renovacell.mx${url.pathname}${url.search}`, 301)
  }

  // 2) Puertas de la app: solo la RAÍZ exacta manda a /sistema (la SPA real).
  //    /sistema, /sistema/*, /assets, /manifest… siguen su curso normal.
  if (APP_DOORS.has(host) && url.pathname === '/') {
    return Response.redirect(`https://${host}/sistema`, 301)
  }

  // 3) renovacell.mx, *.netlify.app y rutas profundas de las puertas: passthrough.
  return context.next()
}

export const config = { path: '/*' }
