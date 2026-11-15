// BORRADORES (15 nov 2026, equipo: "que no se borre el pedido levantado ni la cotización"). Lo que se está armando para un
// cliente se guarda en ESTE dispositivo mientras se escribe; si se cierra la ventana, se cae la señal o se recarga, al
// volver a abrir para el mismo cliente se recupera. Se borra al crear el pedido o la cotización. Dura 7 días.
import { useEffect } from 'react'

const PREFIJO = 'rc_borrador:'
const VIDA_MS = 7 * 24 * 3600 * 1000
type Guardado<T> = { at: number; v: T }

export function leerBorrador<T>(clave: string): T | null {
  try {
    const g = JSON.parse(localStorage.getItem(PREFIJO + clave) ?? 'null') as Guardado<T> | null
    if (!g || Date.now() - g.at > VIDA_MS) { localStorage.removeItem(PREFIJO + clave); return null }
    return g.v
  } catch { return null }
}
export function borrarBorrador(clave: string) { try { localStorage.removeItem(PREFIJO + clave) } catch { /* sin almacenamiento */ } }
/** Guarda `valor` cada vez que cambia; si `vacio`, lo quita (no se guarda un borrador sin nada). */
export function useGuardarBorrador<T>(clave: string | null, valor: T, vacio: boolean) {
  const json = JSON.stringify(valor)
  useEffect(() => {
    if (!clave) return
    try { if (vacio) localStorage.removeItem(PREFIJO + clave); else localStorage.setItem(PREFIJO + clave, JSON.stringify({ at: Date.now(), v: JSON.parse(json) })) } catch { /* sin almacenamiento */ }
  }, [clave, json, vacio])
}
