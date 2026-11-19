// RESPONDER A UN MENSAJE (19 nov 2026) · deslizar a la derecha con el dedo, como en WhatsApp: pasado el umbral, responde a
// ese mensaje. Con mouse no hace nada (ahí está el botón «Responder»). El dedo sigue desplazando arriba/abajo (pan-y).
import { useRef } from 'react'
import type React from 'react'

export function useDeslizarResponder(onResponder: (id: string) => void, activo: boolean) {
  const d = useRef<{ id: string; x: number; y: number; el: HTMLElement; mueve: boolean } | null>(null)
  const soltar = (x: number | null) => {
    const s = d.current; d.current = null
    if (!s) return
    s.el.style.transition = 'transform .15s'; s.el.style.transform = ''
    window.setTimeout(() => { s.el.style.transition = '' }, 160)
    if (x != null && x - s.x > 60) onResponder(s.id)
  }
  return (id: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { if (e.pointerType !== 'mouse' && activo) d.current = { id, x: e.clientX, y: e.clientY, el: e.currentTarget, mueve: false } },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = d.current; if (!s) return
      const dx = e.clientX - s.x
      if (!s.mueve && (Math.abs(e.clientY - s.y) > 24 || dx < 0)) { s.el.style.transform = ''; d.current = null; return }
      if (dx > 8) s.mueve = true
      if (s.mueve) s.el.style.transform = `translateX(${Math.min(dx, 80)}px)`
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => soltar(e.clientX),
    onPointerCancel: () => soltar(null),
  })
}
