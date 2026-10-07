// CHV2-B · Store compartido de ATENCIÓN COMERCIAL. Inicio, Mi bandeja, la alerta en vivo y la campana
// leen de AQUÍ, así que no pueden contradecirse ni multiplicar lecturas:
//   · vendedor (rol pos con "Atender conversaciones") → cc_cola_asesorias vía Edge chat (el servidor
//     devuelve SOLO sus conversaciones; nunca la cola de Dirección).
//   · Dirección (admin) → cc_ruteo_pendientes (la base exige Dirección).
//   · cualquier otro rol (almacén, chofer, doctor) → fuente nula: no se consulta nada comercial.
// Invalidación: aviso comercial en vivo (Realtime = señal), pestaña que vuelve a estar visible y un
// sondeo modesto (60 s) mientras está visible. Lecturas concurrentes se colapsan en una.
import { useEffect, useSyncExternalStore } from 'react'
import { chat as chatPorDefecto, type ClienteChat, type ColaItem } from '../ops/chat'
import { atencion as atencionPorDefecto, type ClienteAtencion, type Pendientes } from '../ops/atencion'
import { KINDS_COMERCIALES } from '../ops/atencionComercial'
import { onNuevaNotificacion } from './notificationsStore'
import type { RoleKey } from '../../app/roles'

export type FuenteComercial = 'vendedor' | 'direccion' | null

export interface EstadoAtencionComercial {
  fuente: FuenteComercial
  cola: ColaItem[]                 // vendedor
  pendientes: Pendientes | null    // Dirección
  listo: boolean                   // ya hubo una primera lectura (o fallo) con esta fuente
  error: string | null
}

/** Quién lee qué. Un vendedor sin "Atender conversaciones" no tiene cola comercial. */
export function fuenteComercial(role: RoleKey, capabilities: string[] | undefined): FuenteComercial {
  if (role === 'admin') return 'direccion'
  if (role === 'pos' && (capabilities ?? []).includes('conversaciones')) return 'vendedor'
  return null
}

const VACIO: EstadoAtencionComercial = { fuente: null, cola: [], pendientes: null, listo: false, error: null }
let estado: EstadoAtencionComercial = VACIO
const oyentes = new Set<() => void>()
let clientes: { chat: ClienteChat; atencion: ClienteAtencion } = { chat: chatPorDefecto, atencion: atencionPorDefecto }
let enCurso: Promise<void> | null = null
let ultimaLectura = 0
let usos = 0
let sondeo: ReturnType<typeof setInterval> | null = null
let quitarSenal: (() => void) | null = null
export const INTERVALO_MS = 60_000
const FRESCO_MS = 15_000

function emitir(next: EstadoAtencionComercial) { estado = next; oyentes.forEach((l) => l()) }

/** Pruebas / vista previa: inyecta clientes falsos y reinicia el estado. */
export function configurarClientesAtencion(c: Partial<{ chat: ClienteChat; atencion: ClienteAtencion }>) {
  clientes = { ...clientes, ...c }
  enCurso = null; ultimaLectura = 0
  emitir({ ...VACIO, fuente: estado.fuente })
}

export function getEstadoAtencion(): EstadoAtencionComercial { return estado }

/** Relee del servidor (colapsa lecturas simultáneas). Devuelve cuando el estado ya está actualizado. */
export function recargarAtencion(): Promise<void> {
  const fuente = estado.fuente
  if (!fuente) return Promise.resolve()
  if (enCurso) return enCurso
  const p = (async () => {
    try { await leer(fuente) } catch { if (estado.fuente === fuente) emitir({ ...estado, listo: true, error: 'No hay conexión con el servidor. Intenta de nuevo.' }) }
    ultimaLectura = Date.now()   // marca de frescura del cache (no se usa para ningún SLA)
  })().finally(() => { enCurso = null })
  enCurso = p
  return p
}

async function leer(fuente: Exclude<FuenteComercial, null>) {
  if (fuente === 'vendedor') {
    const r = await clientes.chat.cola()
    if (estado.fuente !== fuente) return
    emitir(r.ok ? { ...estado, cola: r.data.cola ?? [], listo: true, error: null } : { ...estado, listo: true, error: r.error.mensaje })
  } else {
    const r = await clientes.atencion.pendientes()
    if (estado.fuente !== fuente) return
    emitir(r.ok ? { ...estado, pendientes: r.data, listo: true, error: null } : { ...estado, listo: true, error: r.error })
  }
}

function siVisible() { if (typeof document === 'undefined' || document.visibilityState === 'visible') void recargarAtencion() }
function alVolver() { if (document.visibilityState === 'visible' && Date.now() - ultimaLectura > FRESCO_MS) void recargarAtencion() }

function activar(fuente: FuenteComercial) {
  if (estado.fuente !== fuente) { enCurso = null; ultimaLectura = 0; emitir({ ...VACIO, fuente }) }
  if (!fuente) return () => {}
  usos += 1
  if (usos === 1) {
    sondeo = setInterval(siVisible, INTERVALO_MS)
    document.addEventListener('visibilitychange', alVolver)
    // Realtime = SEÑAL de invalidación: la verdad se vuelve a leer del servidor.
    quitarSenal = onNuevaNotificacion((n) => { if (n.kind && KINDS_COMERCIALES.has(n.kind)) void recargarAtencion() })
  }
  if (!estado.listo || Date.now() - ultimaLectura > FRESCO_MS) void recargarAtencion()
  return () => {
    usos = Math.max(0, usos - 1)
    if (usos === 0) {
      if (sondeo) clearInterval(sondeo); sondeo = null
      document.removeEventListener('visibilitychange', alVolver)
      quitarSenal?.(); quitarSenal = null
    }
  }
}

/** Suscribe la superficie al estado comercial de SU fuente (null = no consulta nada). */
export function useAtencionComercial(fuente: FuenteComercial): EstadoAtencionComercial {
  const snap = useSyncExternalStore((cb) => { oyentes.add(cb); return () => { oyentes.delete(cb) } }, getEstadoAtencion, getEstadoAtencion)
  useEffect(() => activar(fuente), [fuente])
  return snap.fuente === fuente ? snap : { ...VACIO, fuente }
}
