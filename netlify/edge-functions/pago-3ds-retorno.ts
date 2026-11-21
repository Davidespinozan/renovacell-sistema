// CS-BB · returnUrl del reto 3DS (step-up) de CyberSource / BanBajío, en el DOMINIO DE LA APP (manual BanBajío §9.5).
//
// Por qué aquí y no en Supabase: las Edge Functions de *.supabase.co sirven text/html como text/plain, así que la página con
// postMessage nunca se ejecutaba dentro del iframe del reto. Netlify sí entrega HTML.
//
// Al terminar el reto, el ACS del banco hace POST (application/x-www-form-urlencoded: TransactionId, MD) a esta ruta DENTRO del
// iframe. Esta página NO decide nada: no toca base de datos ni red; solo avisa a la ventana padre con
//   postMessage({ tipo: 'cs-3ds-retorno', transactionId }, <su propio origen>)
// El padre (Autenticacion3DS) verifica event.origin === su origen y que transactionId sea el authenticationTransactionId del
// enrolamiento; después pide al SERVIDOR la validación (que vuelve a comparar el TransactionId con el guardado en el intento).
export const RUTA = '/pago/3ds-retorno'
const TX = /^[A-Za-z0-9_-]{1,64}$/

/** TransactionId del cuerpo del POST (form-urlencoded o multipart). Inválido o ausente → null. */
export async function leerTransactionId(request: Request): Promise<string | null> {
  try {
    const tipo = (request.headers.get('content-type') ?? '').toLowerCase()
    let v: unknown = null
    if (tipo.includes('application/x-www-form-urlencoded')) v = new URLSearchParams(await request.text()).get('TransactionId')
    else if (tipo.includes('multipart/form-data')) v = (await request.formData()).get('TransactionId')
    const s = typeof v === 'string' ? v.trim() : ''
    return TX.test(s) ? s : null
  } catch { return null }
}

/** Página mínima: el script con nonce avisa al padre SOLO en el mismo origen. Sin datos del pago más allá del TransactionId. */
export function htmlRetorno3ds(transactionId: string | null, nonce: string): string {
  const dato = JSON.stringify({ tipo: 'cs-3ds-retorno', transactionId: transactionId ?? null }).replace(/</g, '\\u003c')
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Verificación</title></head><body style="font-family:system-ui,sans-serif;font-size:14px;color:#1b1f1d;padding:16px">' +
    'Verificación completada. Regresando…' +
    `<script nonce="${nonce}">try{window.parent.postMessage(${dato},window.location.origin)}catch(e){}</script></body></html>`
}

export function cabecerasRetorno(nonce: string): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`,
  }
}

// Sin dependencias (ni siquiera el tipo Context de Netlify): la función solo necesita la Request.
export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const tx = await leerTransactionId(request)
  return new Response(htmlRetorno3ds(tx, nonce), { status: 200, headers: cabecerasRetorno(nonce) })
}

export const config = { path: '/pago/3ds-retorno' }
