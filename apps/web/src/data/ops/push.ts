// AVISOS PUSH · activar los avisos del chat en ESTE dispositivo (Web Push). La llave pública la da el servidor; la
// dirección del dispositivo se guarda del lado del servidor ligada a la cuenta o al visitante. Nunca lanza.
import { hasSupabase, supabase } from '../../lib/supabase'
import { leerTokenVisitante } from './visitante'

export type EstadoAvisos = 'no_soportado' | 'requiere_instalar' | 'denegado' | 'activo' | 'inactivo'
type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

const esIOS = (): boolean => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
const instalada = (): boolean => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return esIOS() && !instalada() ? 'requiere_instalar' : 'no_soportado'
  if (!('PushManager' in window) || typeof Notification === 'undefined') return esIOS() && !instalada() ? 'requiere_instalar' : 'no_soportado'
  if (Notification.permission === 'denied') return 'denegado'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo'
  } catch { return 'inactivo' }
}

function llaveBytes(base64url: string): Uint8Array {
  const b = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob(b); const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type ResultadoAvisos = { ok: true } | { ok: false; mensaje: string }
export async function activarAvisos(invocar: Invocar = invocarPorDefecto): Promise<ResultadoAvisos> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  const e = await estadoAvisos()
  if (e === 'requiere_instalar') return { ok: false, mensaje: 'En iPhone, primero agrega Renovacell a tu pantalla de inicio (Compartir → Agregar a inicio) y ábrelo desde ahí.' }
  if (e === 'no_soportado') return { ok: false, mensaje: 'Este navegador no permite avisos.' }
  if (e === 'denegado') return { ok: false, mensaje: 'Los avisos están bloqueados para este sitio: actívalos en los ajustes del navegador.' }
  try {
    const permiso = await Notification.requestPermission()
    if (permiso !== 'granted') return { ok: false, mensaje: 'Sin permiso no podemos avisarte.' }
    const { data: k } = await invocar('push', { body: { action: 'clave' } })
    const clave = (k as { clave?: string | null } | null)?.clave
    if (!clave) return { ok: false, mensaje: 'Los avisos aún no están activados en Renovacell.' }
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveBytes(clave) as BufferSource })
    const { error } = await invocar('push', { body: { action: 'suscribir', suscripcion: sub.toJSON(), token: leerTokenVisitante() } })
    return error ? { ok: false, mensaje: 'No se pudieron activar los avisos en este dispositivo.' } : { ok: true }
  } catch { return { ok: false, mensaje: 'No se pudieron activar los avisos en este dispositivo.' } }
}

/**
 * PUSH SIEMPRE · si el navegador YA dio permiso, deja este dispositivo registrado a la cuenta actual sin pedir nada:
 * repara el botón viejo de Ajustes (pedía permiso y no registraba), un registro que el navegador dio de baja o un cambio
 * de cuenta en el mismo dispositivo. Sin permiso no hace nada (el navegador exige que lo pida la persona). Nunca lanza.
 */
export async function sincronizarAvisos(invocar: Invocar = invocarPorDefecto): Promise<boolean> {
  if (!hasSupabase && invocar === invocarPorDefecto) return false
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return false
    if (Notification.permission !== 'granted') return false
    const { data: k } = await invocar('push', { body: { action: 'clave' } })
    const clave = (k as { clave?: string | null } | null)?.clave
    if (!clave) return false
    const reg = (await navigator.serviceWorker.getRegistration('/')) ?? await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveBytes(clave) as BufferSource })
    const { error } = await invocar('push', { body: { action: 'suscribir', suscripcion: sub.toJSON(), token: leerTokenVisitante() } })
    return !error
  } catch { return false }
}
