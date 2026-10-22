// CS-1A.4 · Payer Authentication 3DS desde el portal del doctor: llamadas a la Edge `cs-3ds`, recolección de datos del
// dispositivo (iframe oculto oficial de Cardinal) y reto step-up (iframe). El navegador nunca decide el resultado: solo lleva
// y trae lo que el servidor y CyberSource indican. El token transitorio viaja a la Edge y no se guarda en ningún lado.
import { supabase, hasSupabase } from '../../lib/supabase'
import type { DispositivoNavegador } from '../../../../../supabase/functions/cs-3ds/contrato'

export type Estado3ds = 'created' | 'tokenized' | 'auth_setup' | 'auth_pending' | 'auth_challenge' | 'auth_validated' | 'declined' | 'failed_safe_to_retry' | 'unknown_requires_reconciliation' | 'expired' | 'amount_changed' | string

export interface RespSetup { estado: 'auth_setup'; reference_id: string; ddc_url: string; ddc_token: string; ddc_origen: string; ddc_timeout_ms: number }
export interface RespEnroll { estado: 'auth_validated' | 'auth_challenge' | 'declined' | 'failed_safe_to_retry'; reto?: boolean; step_up_url?: string; step_up_token?: string; ventana?: '01' | '02' | '03' | '04' | '05'; ventana_px?: { w: number; h: number } | null; retorno_origen?: string; message?: string }
export interface RespValidate { estado: 'auth_validated' | 'declined' | 'auth_challenge'; pendiente?: boolean; message?: string }
export interface RespEstado { estado: Estado3ds; amount: number; ambiente: 'test' | 'production'; puede_validar: boolean; requiere_tarjeta: boolean; bloqueado: boolean }
export type Resultado3ds<T> = { ok: true; data: T } | { ok: false; error: string; message: string; estado?: string; status?: number }

async function cuerpoDeError(e: unknown): Promise<{ error?: string; message?: string; estado?: string } | null> {
  try { return await (e as { context?: { json?: () => Promise<{ error?: string; message?: string; estado?: string }> } }).context?.json?.() ?? null } catch { return null }
}
async function llamar<T>(body: Record<string, unknown>): Promise<Resultado3ds<T>> {
  if (!hasSupabase) return { ok: false, error: 'not_configured', message: 'El pago con tarjeta aún no está disponible.' }
  const { data, error } = await supabase.functions.invoke('cs-3ds', { body })
  if (error) {
    const b = await cuerpoDeError(error)
    return { ok: false, error: b?.error ?? 'error', message: b?.message ?? 'No se pudo continuar con la verificación. Intenta de nuevo.', estado: b?.estado }
  }
  return { ok: true, data: data as T }
}
export const cs3ds = {
  estado: (attemptId: string) => llamar<RespEstado>({ accion: 'estado', attempt_id: attemptId }),
  setup: (attemptId: string, token: string) => llamar<RespSetup>({ accion: 'setup', attempt_id: attemptId, token }),
  enroll: (attemptId: string, token: string, dispositivo: DispositivoNavegador) => llamar<RespEnroll>({ accion: 'enroll', attempt_id: attemptId, token, dispositivo }),
  validate: (attemptId: string) => llamar<RespValidate>({ accion: 'validate', attempt_id: attemptId }),
  abandonar: (attemptId: string) => llamar<{ estado: string }>({ accion: 'abandonar', attempt_id: attemptId }),
}

/** Los campos del navegador que exige el enrolamiento (ninguno es sensible). */
export function recolectarDispositivo(w: Window = window): DispositivoNavegador {
  const n = w.navigator as Navigator & { javaEnabled?: () => boolean }
  return {
    httpBrowserLanguage: n.language || 'es-MX',
    httpBrowserJavaEnabled: typeof n.javaEnabled === 'function' ? n.javaEnabled() === true : false,
    httpBrowserJavaScriptEnabled: true,
    httpBrowserColorDepth: String(w.screen?.colorDepth ?? 24),
    httpBrowserScreenHeight: String(w.screen?.height ?? 0),
    httpBrowserScreenWidth: String(w.screen?.width ?? 0),
    httpBrowserTimeDifference: String(new Date().getTimezoneOffset()),
  }
}

export const ORIGENES_CARDINAL = ['https://centinelapistag.cardinalcommerce.com', 'https://centinelapi.cardinalcommerce.com'] as const

function formEnIframe(doc: Document, contenedor: HTMLElement, url: string, jwt: string, nombre: string, md?: string, visible?: { w: number; h: number } | null): HTMLIFrameElement {
  const iframe = doc.createElement('iframe')
  iframe.name = nombre; iframe.title = nombre
  if (visible === undefined) { iframe.width = '10'; iframe.height = '10'; iframe.style.cssText = 'width:10px;height:10px;border:0;position:absolute;left:-9999px' }
  else { iframe.style.cssText = `border:0;width:${visible ? visible.w + 'px' : '100%'};height:${visible ? visible.h + 'px' : '100%'};max-width:100%` }
  const form = doc.createElement('form')
  form.method = 'POST'; form.action = url; form.target = nombre; form.style.display = 'none'
  const inJwt = doc.createElement('input'); inJwt.type = 'hidden'; inJwt.name = 'JWT'; inJwt.value = jwt; form.appendChild(inJwt)
  if (md) { const inMd = doc.createElement('input'); inMd.type = 'hidden'; inMd.name = 'MD'; inMd.value = md; form.appendChild(inMd) }
  contenedor.appendChild(iframe); contenedor.appendChild(form)
  form.submit()
  form.remove()
  return iframe
}

/**
 * Recolección de datos del dispositivo (paso oficial 2): form POST con JWT a la URL de Cardinal en iframe oculto; se espera el
 * postMessage {MessageType:'profile.completed'} SOLO desde el origen de Cardinal del ambiente. Si no llega en el tiempo dado, se
 * continúa (el enrolamiento lleva los 11 campos del navegador como respaldo).
 */
export function ejecutarDDC(p: { url: string; token: string; origen: string; timeoutMs: number; contenedor: HTMLElement; doc?: Document; win?: Window }): Promise<{ completado: boolean; sessionId: string | null }> {
  const doc = p.doc ?? document, win = p.win ?? window
  if (!(ORIGENES_CARDINAL as readonly string[]).includes(p.origen) || !p.url.startsWith(p.origen + '/')) return Promise.resolve({ completado: false, sessionId: null })
  return new Promise((resolve) => {
    let listo = false
    const fin = (r: { completado: boolean; sessionId: string | null }) => { if (listo) return; listo = true; win.removeEventListener('message', onMsg); clearTimeout(t); try { iframe.remove() } catch { /* ya no está */ } resolve(r) }
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== p.origen) return
      let d: unknown = ev.data
      if (typeof d === 'string') { try { d = JSON.parse(d) } catch { return } }
      const m = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
      if (m.MessageType === 'profile.completed') fin({ completado: m.Status === true || m.Status === 'true', sessionId: typeof m.SessionId === 'string' ? m.SessionId : null })
    }
    win.addEventListener('message', onMsg)
    const t = setTimeout(() => fin({ completado: false, sessionId: null }), p.timeoutMs)
    const iframe = formEnIframe(doc, p.contenedor, p.url, p.token, 'rc-ddc')
  })
}

/**
 * Reto step-up (paso oficial 4): form POST con JWT a stepUpUrl en un iframe visible. Termina cuando el returnUrl (nuestra Edge
 * cs-3ds-return) avisa por postMessage desde el ORIGEN de las funciones; el resultado real lo decide después el servidor (validate).
 */
export function ejecutarStepUp(p: { url: string; token: string; md: string; retornoOrigen: string; ventana: { w: number; h: number } | null; timeoutMs: number; contenedor: HTMLElement; doc?: Document; win?: Window }): Promise<{ regreso: boolean }> {
  const doc = p.doc ?? document, win = p.win ?? window
  let host = ''
  try { host = new URL(p.url).hostname } catch { host = '' }
  if (!/(^|\.)cardinalcommerce\.com$/i.test(host) || !p.url.startsWith('https://')) return Promise.resolve({ regreso: false })
  return new Promise((resolve) => {
    let listo = false
    const fin = (r: { regreso: boolean }) => { if (listo) return; listo = true; win.removeEventListener('message', onMsg); clearTimeout(t); try { iframe.remove() } catch { /* ya no está */ } resolve(r) }
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== p.retornoOrigen) return
      const m = (ev.data && typeof ev.data === 'object' ? ev.data : {}) as Record<string, unknown>
      if (m.tipo === 'renovacell-3ds-return') fin({ regreso: true })
    }
    win.addEventListener('message', onMsg)
    const t = setTimeout(() => fin({ regreso: false }), p.timeoutMs)
    const iframe = formEnIframe(doc, p.contenedor, p.url, p.token, 'rc-stepup', p.md, p.ventana)
  })
}
