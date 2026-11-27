// true cuando la ventana mide al menos `px` de ancho. Lo usan las pantallas que en computadora muestran lista + detalle
// y en el celular solo la lista (el detalle se abre en una hoja). Sin matchMedia (pruebas) devuelve `inicial`.
import { useEffect, useState } from 'react'

export function useAnchoMinimo(px: number, inicial = false): boolean {
  const q = `(min-width:${px}px)`
  const hay = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [ok, setOk] = useState<boolean>(() => (hay ? window.matchMedia(q).matches : inicial))
  useEffect(() => {
    if (!hay) return
    const m = window.matchMedia(q)
    const f = () => setOk(m.matches)
    f()
    m.addEventListener?.('change', f)
    return () => m.removeEventListener?.('change', f)
  }, [q, hay])
  return ok
}
