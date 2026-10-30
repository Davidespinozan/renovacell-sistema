// PUSH DEL EQUIPO · al tocar un aviso se abre lo que avisó: "/sistema?abrir=chat&conv=<id>" abre ese chat del equipo y
// "?abrir=avisos" abre Avisos del equipo. Llega por la URL (sistema cerrado) o por un mensaje del service worker (sistema
// ya abierto). Solo lleva el identificador: la pantalla abre únicamente lo que esa cuenta puede leer.
import { useEffect } from 'react'
import { pedirIntento } from '../store/navIntentStore'

export interface Abrir { screen: 'chat' | 'comun'; conv: string | null }
export function leerAbrir(url: string): Abrir | null {
  let q: URLSearchParams
  try { q = new URL(url, 'https://x.invalid').searchParams } catch { return null }
  const a = q.get('abrir')
  if (a === 'avisos') return { screen: 'comun', conv: null }
  if (a !== 'chat') return null
  const conv = q.get('conv')
  return { screen: 'chat', conv: conv && /^[0-9a-f-]{36}$/i.test(conv) ? conv : null }
}

export function aplicarAbrir(a: Abrir, setScreen: (s: string) => void) {
  if (a.conv) pedirIntento({ destino: 'chat', conversationId: a.conv, origen: 'alerta' })
  setScreen(a.screen)
}

/** Lo monta el marco del equipo (no el doctor). */
export function useAbrirDesdeAviso(activo: boolean, setScreen: (s: string) => void) {
  useEffect(() => {
    if (!activo) return
    const inicial = leerAbrir(window.location.href)
    if (inicial) { window.history.replaceState(null, '', window.location.pathname); aplicarAbrir(inicial, setScreen) }
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw) return
    const oir = (e: MessageEvent) => {
      const d = e.data as { tipo?: string; url?: string } | null
      if (d?.tipo !== 'rc-abrir' || typeof d.url !== 'string') return
      const a = leerAbrir(d.url); if (a) aplicarAbrir(a, setScreen)
    }
    sw.addEventListener('message', oir)
    return () => sw.removeEventListener('message', oir)
  }, [activo, setScreen])
}
