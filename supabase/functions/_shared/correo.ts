// W4-05 · Adaptador del proveedor de correo transaccional.
//
// Tres decisiones que este módulo hace cumplir:
//   1. FALLA CERRADO. Sin configuración completa no hay proveedor: `leerConfig` devuelve
//      null y nadie envía nada. No existe modo "simulado" que diga que envió.
//   2. "ENVIADO" SOLO CON CONFIRMACIÓN. El resultado `enviado` exige el identificador
//      que devolvió el proveedor. Un 200 sin identificador es `incierto`, no éxito.
//   3. DESCONOCIDO ≠ RECHAZADO. Corte de red, timeout, 5xx o 429 no prueban que el
//      correo NO salió: son `incierto`. Solo un rechazo definitivo del proveedor es
//      `fallido`.
//
// Las credenciales nunca salen de aquí: ni en errores, ni en logs, ni en el resultado.
export const TIMEOUT_CORREO_MS = 15_000

export interface ConfigCorreo {
  proveedor: 'resend'
  apiKey: string
  remitente: string // "Renovacell <pedidos@dominio>"
}

export interface Mensaje {
  para: string
  asunto: string
  texto: string
  html: string
  // Identidad del EVENTO del negocio (no un valor aleatorio): viaja al proveedor para
  // que un reintento del mismo mensaje no produzca un segundo correo.
  llaveIdempotencia: string
}

export type ResultadoEnvio =
  | { resultado: 'enviado'; id: string }
  | { resultado: 'fallido'; error: string }
  | { resultado: 'incierto'; error: string }

const PROVEEDORES = ['resend'] as const

/** Lee la configuración. null = no configurado (o configurado a medias): no se envía. */
export function leerConfig(env: (k: string) => string | undefined): ConfigCorreo | null {
  const proveedor = (env('MAIL_PROVIDER') ?? '').trim().toLowerCase()
  const apiKey = (env('MAIL_API_KEY') ?? '').trim()
  const remitente = (env('MAIL_FROM') ?? '').trim()
  if (!(PROVEEDORES as readonly string[]).includes(proveedor)) return null
  if (!apiKey || !remitente || !/@/.test(remitente)) return null
  return { proveedor: proveedor as ConfigCorreo['proveedor'], apiKey, remitente }
}

/** Quita cualquier rastro de la credencial y acota el texto antes de guardarlo. */
export function sanitiza(texto: string, cfg: ConfigCorreo): string {
  return String(texto ?? '').split(cfg.apiKey).join('***').replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 240)
}

/** Clasifica una respuesta HTTP del proveedor. Pura: sin red, para poder probarla. */
export function clasificar(status: number, cuerpo: unknown): ResultadoEnvio {
  const c = (cuerpo ?? {}) as Record<string, unknown>
  const id = typeof c.id === 'string' ? c.id.trim() : ''
  const detalle = typeof c.message === 'string' ? c.message : typeof c.name === 'string' ? c.name : ''
  if (status >= 200 && status < 300) {
    return id ? { resultado: 'enviado', id } : { resultado: 'incierto', error: `respuesta ${status} sin identificador` }
  }
  // 408 timeout, 409 conflicto de idempotencia en curso, 425 too early, 429 límite de tasa
  // y 5xx: el proveedor no dijo que el correo NO salió. Se reintenta con la misma llave.
  if ([408, 409, 425, 429].includes(status) || status >= 500) {
    return { resultado: 'incierto', error: `proveedor ${status}${detalle ? `: ${detalle}` : ''}` }
  }
  return { resultado: 'fallido', error: `rechazado ${status}${detalle ? `: ${detalle}` : ''}` }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

export async function enviarCorreo(cfg: ConfigCorreo, m: Mensaje, fetchImpl: Fetch = fetch): Promise<ResultadoEnvio> {
  const ctl = new AbortController()
  const reloj = setTimeout(() => ctl.abort(), TIMEOUT_CORREO_MS)
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': m.llaveIdempotencia,
      },
      body: JSON.stringify({ from: cfg.remitente, to: [m.para], subject: m.asunto, text: m.texto, html: m.html }),
    })
    let cuerpo: unknown = null
    try { cuerpo = await res.json() } catch { /* cuerpo no JSON: se clasifica por status */ }
    const r = clasificar(res.status, cuerpo)
    return r.resultado === 'enviado' ? r : { ...r, error: sanitiza(r.error, cfg) }
  } catch (e) {
    // Sin respuesta: no se sabe si el proveedor recibió la petición.
    const motivo = (e as Error)?.name === 'AbortError' ? 'timeout' : 'sin respuesta del proveedor'
    return { resultado: 'incierto', error: motivo }
  } finally {
    clearTimeout(reloj)
  }
}
