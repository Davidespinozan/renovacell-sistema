// META-02 · Diagnóstico SEGURO del webhook de Meta (WhatsApp, Instagram, Messenger).
// Módulo PURO (sin Deno ni red): produce UNA línea de log estructurada por evento relevante para saber, desde los logs de
// la Edge, QUÉ canal, en QUÉ etapa y por QUÉ causa falló (o qué se recibió). Nunca lleva textos, teléfonos, nombres,
// tokens, secretos ni identificadores personales completos: solo canal, etapa, causa, código técnico, un hash corto
// de correlación y la cola del identificador de la cuenta de negocio (WABA / página), que no identifica personas.
export type CanalDiag = 'whatsapp' | 'instagram' | 'messenger' | 'desconocido'
export type EtapaDiag = 'firma' | 'json' | 'wa_estado' | 'wa_entrante' | 'meta_entrante' | 'procesar' | 'recibido'
export type CausaDiag = 'validacion' | 'autorizacion' | 'base_datos' | 'excepcion' | 'ok'
export interface Diagnostico {
  canal: CanalDiag; etapa: EtapaDiag; causa: CausaDiag; codigo: string; http: number
  correlacion?: string; cuenta?: string; conteo?: Record<string, number>
}

/** Canal a partir del objeto del paquete de Meta. */
export function canalDe(payload: unknown): CanalDiag {
  const o = String((payload as Record<string, unknown> | null)?.object ?? '')
  return o === 'whatsapp_business_account' ? 'whatsapp' : o === 'instagram' ? 'instagram' : o === 'page' ? 'messenger' : 'desconocido'
}
/** Cola (4) del id de la primera entrada: WABA o página, identificador de la EMPRESA, nunca de una persona. */
export function cuentaDe(payload: unknown): string {
  const e = (payload as { entry?: unknown[] } | null)?.entry
  const id = Array.isArray(e) && e[0] && typeof e[0] === 'object' ? String((e[0] as Record<string, unknown>).id ?? '') : ''
  return id ? `…${id.slice(-4)}` : ''
}
/** Hash corto (FNV-1a 32 bits, hex) de identificadores técnicos (wamid / mid): correlaciona reintentos sin revelar el id. */
export function correlacion(...partes: string[]): string {
  let h = 0x811c9dc5
  for (const ch of partes.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
const CODIGO_SEGURO = /^[A-Z][A-Z0-9_]{2,40}/   // p. ej. WA_SIN_TEXTO, META_DATOS_INVALIDOS, CUENTA_SUSPENDIDA, NO_AUTORIZADO
/** Clasifica un error de la base (PostgrestError de supabase-js: code + message) o una excepción, SIN copiar su texto. */
export function clasificarError(e: unknown): { causa: CausaDiag; codigo: string } {
  const r = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown; name?: unknown }
  const code = typeof r.code === 'string' ? r.code : ''
  const msg = typeof r.message === 'string' ? r.message : ''
  // la etiqueta (WA_SIN_TEXTO, CUENTA_SUSPENDIDA…) solo cuenta en errores levantados por nuestras funciones (P0001 / check)
  const etiqueta = (code === 'P0001' || code === '23514' || code === '' ) ? (CODIGO_SEGURO.exec(msg)?.[0] ?? '') : ''
  if (code.startsWith('PGRST')) return { causa: 'base_datos', codigo: code }
  if (code === '42501' || etiqueta === 'NO_AUTORIZADO') return { causa: 'autorizacion', codigo: etiqueta || code }
  if (code === '23514' || code === '22023' || (code === 'P0001' && etiqueta)) return { causa: 'validacion', codigo: etiqueta || code }
  if (/^[0-9A-Z]{5}$/.test(code)) return { causa: 'base_datos', codigo: code }
  if (e instanceof Error) return { causa: 'excepcion', codigo: (typeof r.name === 'string' && r.name) || 'Error' }
  return { causa: code || etiqueta ? 'base_datos' : 'excepcion', codigo: etiqueta || code || 'desconocido' }
}
/** Línea única y estable para los logs (prefijo fijo para filtrar). Solo campos técnicos. */
export function lineaDiagnostico(d: Diagnostico): string {
  const base: Record<string, unknown> = { canal: d.canal, etapa: d.etapa, causa: d.causa, codigo: d.codigo.slice(0, 40), http: d.http }
  if (d.correlacion) base.correlacion = d.correlacion.slice(0, 16)
  if (d.cuenta) base.cuenta = d.cuenta.slice(0, 8)
  if (d.conteo) base.conteo = d.conteo
  return 'meta-webhook ' + JSON.stringify(base)
}
