// PUSH SIEMPRE · la pantalla "Activa las notificaciones" se abre al entrar (una vez por sesión) y, para el doctor, también
// justo después de escribirle a su asesor o de hacer un pedido: el momento en que más le importa enterarse. Cada motivo
// se pide una vez por sesión; si ya están activas, no se abre.
import { useSyncExternalStore } from 'react'

export type MotivoAvisos = 'entrada' | 'chat' | 'pedido'
let abierta: MotivoAvisos | null = null
const oyentes = new Set<() => void>()
const emitir = () => oyentes.forEach((l) => l())
const clave = (m: MotivoAvisos) => `rc_puerta_avisos_${m}`
const yaPedido = (m: MotivoAvisos): boolean => { try { return sessionStorage.getItem(clave(m)) === '1' } catch { return false } }
const marcar = (m: MotivoAvisos) => { try { sessionStorage.setItem(clave(m), '1') } catch { /* sin almacenamiento: puede repetirse */ } }

/** Abre la pantalla por este motivo si no se pidió ya en esta sesión (la pantalla decide si hace falta). */
export function pedirAvisos(m: MotivoAvisos) {
  if (abierta || yaPedido(m)) return
  marcar(m); abierta = m; emitir()
}
export function cerrarPuertaAvisos() { if (abierta) { abierta = null; emitir() } }
export const puertaAbierta = (): MotivoAvisos | null => abierta
export function usePuertaAvisos(): MotivoAvisos | null {
  return useSyncExternalStore((cb) => { oyentes.add(cb); return () => { oyentes.delete(cb) } }, puertaAbierta, puertaAbierta)
}
