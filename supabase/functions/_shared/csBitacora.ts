// CyberSource (BanBajío) · BITÁCORA DE PRUEBAS de certificación (manual BanBajío §1 y §8.2: casos 3DS 2.1–2.11).
//
// El banco revisa la integración con una bitácora de cada llamada a CyberSource por caso de prueba. Este módulo arma esa
// bitácora SOLO en sandbox: paso, hora, estatus HTTP y cuerpos de solicitud/respuesta ENMASCARADOS:
//   · jti acortado (6 primeros…4 últimos); cavv, xid y ucafAuthenticationData con solo los 4 últimos;
//   · ningún token (accessToken, transientToken, JWT de Cardinal, pareq, capture context), ninguna firma ni secreto;
//   · si por error apareciera un número de tarjeta o CVV, se oculta completo.
// En producción NO se registra nada (ni cuerpos ni filas): `bitacoraActiva` devuelve false y la tabla además solo acepta
// ambiente 'test' (restricción en la base).
// Puro y sin imports: el guardado se inyecta (la Edge pasa un insert con la llave de servidor).

export const ENMASCARAR_ULTIMOS4: readonly string[] = ['cavv', 'xid', 'ucafAuthenticationData', 'authenticationData']
export const OCULTAR_COMPLETO: readonly string[] = [
  'accessToken', 'token', 'transientToken', 'transientTokenJwt', 'pareq', 'pares', 'stepUpUrlJwt', 'JWT', 'jwt', 'capture_context', 'captureContext',
  'number', 'securityCode', 'cvv', 'cvn', 'sharedSecret', 'keyId', 'signature', 'Signature', 'Authorization', 'authorization',
]
const JWT_LIKE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

export function acortarJti(jti: string): string {
  const s = String(jti ?? '')
  return s.length <= 10 ? '…' + s.slice(-2) : `${s.slice(0, 6)}…${s.slice(-4)}`
}
export function ultimos4(v: string): string {
  const s = String(v ?? '').trim()
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4)
}

/** Copia profunda enmascarada. Las llaves se comparan exactas (los nombres oficiales de CyberSource). */
export function enmascararCS(x: unknown, profundidad = 0): unknown {
  if (profundidad > 12) return '‹profundo›'
  if (Array.isArray(x)) return x.map((v) => enmascararCS(v, profundidad + 1))
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (OCULTAR_COMPLETO.includes(k)) { out[k] = v == null ? v : '‹oculto›'; continue }
      if (k === 'jti' && typeof v === 'string') { out[k] = acortarJti(v); continue }
      if (ENMASCARAR_ULTIMOS4.includes(k) && typeof v === 'string') { out[k] = ultimos4(v); continue }
      out[k] = enmascararCS(v, profundidad + 1)
    }
    return out
  }
  if (typeof x === 'string') {
    if (JWT_LIKE.test(x.trim())) return '‹jwt›'
    if (/\b\d{13,19}\b/.test(x)) return x.replace(/\b\d{13,19}\b/g, '‹número›')
  }
  return x
}

/** Sandbox = ambiente 'test' en el host de pruebas (o CS_ENTORNO=sandbox, pero NUNCA con el ambiente de producción). */
export function bitacoraActiva(cfg: { ambiente: string; host: string }, entorno: string | undefined): boolean {
  if (cfg.ambiente !== 'test') return false
  return cfg.host === 'apitest.cybersource.com' || String(entorno ?? '').trim().toLowerCase() === 'sandbox'
}

export interface FilaBitacora {
  attempt_id: string; paso: string; metodo: string; ruta: string; http_status: number | null; resultado: string
  request: unknown; response: unknown; duracion_ms: number; ambiente: 'test'; created_at: string
}
type RespuestaMin = { ok: true; status: number; data: unknown } | { ok: false; clase: 'http'; status: number; data: unknown } | { ok: false; clase: 'antes_de_enviar' | 'resultado_desconocido' }

/** Arma la fila (ya enmascarada). La ruta se guarda sin ids de pago largos. */
export function filaBitacora(p: { attemptId: string; paso: string; metodo: string; ruta: string; cuerpo: unknown; r: RespuestaMin; inicio: number; fin: number }): FilaBitacora {
  const r = p.r
  const status = r.ok ? r.status : r.clase === 'http' ? r.status : null
  const resultado = r.ok ? 'ok' : r.clase
  const resp = r.ok ? r.data : r.clase === 'http' ? r.data : { resultado: r.clase }
  return {
    attempt_id: p.attemptId, paso: p.paso, metodo: p.metodo, ruta: p.ruta.replace(/\d{12,}/g, '‹id›'), http_status: status, resultado,
    request: enmascararCS(p.cuerpo ?? null), response: enmascararCS(typeof resp === 'string' ? (JWT_LIKE.test(resp.trim()) ? '‹jwt›' : resp.slice(0, 2000)) : resp),
    duracion_ms: Math.max(0, Math.round(p.fin - p.inicio)), ambiente: 'test', created_at: new Date(p.fin).toISOString(),
  }
}

/**
 * Ejecuta la llamada y, si la bitácora está activa, guarda la fila (sin bloquear ni romper el flujo si el guardado falla).
 * `llamar` es solicitarCS ya configurado; `guardar` el insert de la Edge.
 */
export async function conBitacora<T extends RespuestaMin>(b: { activa: boolean; attemptId: string; paso: string; metodo: string; ruta: string; cuerpo: unknown; guardar: (f: FilaBitacora) => Promise<unknown>; ahora?: () => number }, llamar: () => Promise<T>): Promise<T> {
  const reloj = b.ahora ?? (() => Date.now())
  const inicio = reloj()
  const r = await llamar()
  if (b.activa) {
    try { await b.guardar(filaBitacora({ attemptId: b.attemptId, paso: b.paso, metodo: b.metodo, ruta: b.ruta, cuerpo: b.cuerpo, r, inicio, fin: reloj() })) } catch { /* la bitácora nunca detiene un pago */ }
  }
  return r
}

/** CSV de la bitácora (para el banco). Las columnas JSON van como texto escapado. */
export const COLUMNAS_CSV_BITACORA = ['created_at', 'attempt_id', 'paso', 'metodo', 'ruta', 'http_status', 'resultado', 'duracion_ms', 'request', 'response'] as const
export function bitacoraACsv(filas: Array<Partial<Record<(typeof COLUMNAS_CSV_BITACORA)[number], unknown>>>): string {
  const celda = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [COLUMNAS_CSV_BITACORA.join(','), ...filas.map((f) => COLUMNAS_CSV_BITACORA.map((c) => celda(f[c])).join(','))].join('\r\n') + '\r\n'
}
