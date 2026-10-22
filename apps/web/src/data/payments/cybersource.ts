// CS-1A.3 · acceso del portal del doctor al Capture Context de Microform (Edge `cs-capture-context`) y carga de la librería Flex.
// El navegador NO elige merchant, ambiente, host, importe ni redes: solo manda order_id. El token transitorio que produce
// Microform vive en memoria del componente y se entrega al siguiente paso (3DS, CS-1A.4); aquí nunca se guarda ni se registra.
import { supabase, hasSupabase } from '../../lib/supabase'

export interface CaptureContextDoctor {
  attempt_id: string
  amount: number
  currency: 'MXN'
  ambiente: 'test' | 'production'
  capture_context: string
  client_library: string
  client_library_integrity: string
  expires_at: string
  reutilizado: boolean
}
export type ResultadoCaptureContext =
  | { ok: true; ctx: CaptureContextDoctor }
  | { ok: false; motivo: 'no_disponible' | 'no_verificado' | 'sin_saldo' | 'en_proceso' | 'pendiente_verificacion' | 'origen' | 'proveedor' | 'error'; mensaje: string }

const MOTIVOS: Record<string, ResultadoCaptureContext & { ok: false }> = {
  not_configured: { ok: false, motivo: 'no_disponible', mensaje: 'El pago con tarjeta aún no está disponible. Usa Transferencia.' },
  produccion_deshabilitada: { ok: false, motivo: 'no_disponible', mensaje: 'El pago con tarjeta aún no está disponible. Usa Transferencia.' },
  no_verificado: { ok: false, motivo: 'no_verificado', mensaje: 'Tu cuenta aún no está verificada por Renovacell.' },
  no_autorizado: { ok: false, motivo: 'no_verificado', mensaje: 'Solo el doctor dueño del pedido puede pagarlo con tarjeta.' },
  sin_saldo: { ok: false, motivo: 'sin_saldo', mensaje: 'Este pedido no tiene saldo pendiente.' },
  pedido_no_pagable: { ok: false, motivo: 'sin_saldo', mensaje: 'Este pedido no admite cobros.' },
  operacion_en_curso: { ok: false, motivo: 'en_proceso', mensaje: 'Hay un cobro con tarjeta de este pedido en proceso. Espera a que termine.' },
  pendiente_verificacion: { ok: false, motivo: 'pendiente_verificacion', mensaje: 'Hay un cobro con tarjeta pendiente de verificación. Te avisamos en cuanto se resuelva.' },
  origen_no_permitido: { ok: false, motivo: 'origen', mensaje: 'Esta página no está autorizada para pagos con tarjeta.' },
  proveedor: { ok: false, motivo: 'proveedor', mensaje: 'No se pudo preparar el formulario de tarjeta. Intenta de nuevo.' },
  proveedor_sin_respuesta: { ok: false, motivo: 'proveedor', mensaje: 'El servicio de tarjeta no respondió. Intenta de nuevo en un momento.' },
  contrato: { ok: false, motivo: 'proveedor', mensaje: 'No se pudo preparar el formulario de tarjeta. Intenta de nuevo.' },
}

async function cuerpoDeError(e: unknown): Promise<{ error?: string; message?: string } | null> {
  try { return await (e as { context?: { json?: () => Promise<{ error?: string; message?: string }> } }).context?.json?.() ?? null } catch { return null }
}

/** Pide el capture context para un pedido. Solo viaja `order_id`. */
export async function solicitarCaptureContext(orderId: string): Promise<ResultadoCaptureContext> {
  if (!hasSupabase) return { ok: false, motivo: 'no_disponible', mensaje: 'El pago con tarjeta aún no está disponible.' }
  const { data, error } = await supabase.functions.invoke('cs-capture-context', { body: { order_id: orderId } })
  if (error) {
    const b = await cuerpoDeError(error)
    const conocido = b?.error ? MOTIVOS[b.error] : undefined
    if (conocido) return { ...conocido, mensaje: b?.message || conocido.mensaje }
    return { ok: false, motivo: 'error', mensaje: b?.message || 'No se pudo preparar el pago con tarjeta. Intenta de nuevo.' }
  }
  const ctx = data as CaptureContextDoctor | null
  if (!ctx?.capture_context || !ctx.client_library || !ctx.client_library_integrity || !ctx.attempt_id) return { ok: false, motivo: 'error', mensaje: 'Respuesta incompleta del servidor.' }
  return { ok: true, ctx }
}

// ---- Librería Flex (Microform v2) -------------------------------------------------------------------------------------
// Tipos mínimos del SDK que usamos (no hay tipos oficiales). El PAN y el CVV viven en iframes de CyberSource.
export interface FlexField { load: (selector: string | HTMLElement) => void; on?: (ev: string, cb: (d: unknown) => void) => void; unload?: () => void }
export interface FlexMicroform {
  createField: (tipo: 'number' | 'securityCode', opciones?: Record<string, unknown>) => FlexField
  createToken: (opciones: { expirationMonth: string; expirationYear: string }, cb: (err: unknown, token?: string) => void) => void
  teardown?: (cb?: () => void) => void
}
export interface FlexSdk { microform: (opciones?: Record<string, unknown>) => FlexMicroform }
export type FlexCtor = new (captureContext: string) => FlexSdk

const cargas = new Map<string, Promise<FlexCtor>>()

/** Carga la librería desde la URL e integridad que trae el capture context (nunca hardcodeadas). Una sola vez por URL. */
export function cargarLibreriaFlex(url: string, integridad: string, doc: Document = document): Promise<FlexCtor> {
  const w = window as unknown as { Flex?: FlexCtor }
  const clave = `${url}#${integridad}`
  const previa = cargas.get(clave)
  if (previa) return previa
  if (!/^https:\/\/([a-z0-9-]+\.)*cybersource\.com\//i.test(url)) return Promise.reject(new Error('librería no permitida'))
  const p = new Promise<FlexCtor>((resolve, reject) => {
    if (w.Flex) { resolve(w.Flex); return }
    const s = doc.createElement('script')
    s.src = url; s.integrity = integridad; s.crossOrigin = 'anonymous'; s.async = true
    s.onload = () => { if (w.Flex) resolve(w.Flex); else reject(new Error('Flex no disponible tras cargar')) }
    s.onerror = () => reject(new Error('no se pudo cargar la librería de tarjeta'))
    doc.head.appendChild(s)
  })
  cargas.set(clave, p)
  p.catch(() => cargas.delete(clave))
  return p
}

/** Solo para pruebas: olvida las cargas memorizadas. */
export function _reiniciarCargasFlex(): void { cargas.clear() }
