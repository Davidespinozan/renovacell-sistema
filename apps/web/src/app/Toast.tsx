// SISTEMA DE DISEÑO · aviso tipo toast (portado de STRYV, app/ui.tsx): UN canal global para "Listo", "No se pudo" e
// información. Rojo solo para error. Los errores duran 5 s; lo demás, 3 s. Se monta una vez en el shell (<Toaster/>).
import React, { useEffect, useState } from 'react'

export type TipoAviso = 'ok' | 'error' | 'info'
type Aviso = { id: number; texto: string; tipo: TipoAviso }
const subs = new Set<(a: Aviso) => void>()
let n = 0
/** Muestra un aviso breve. Ej.: toast('Agregado al carrito'), toast('No se pudo guardar', 'error'). */
export const toast = (texto: string, tipo: TipoAviso = 'ok') => { const a = { id: ++n, texto, tipo }; subs.forEach((s) => s(a)) }

export function Toaster() {
  const [a, setA] = useState<Aviso | null>(null)
  const [ver, setVer] = useState(false)
  useEffect(() => {
    let t: number | undefined
    const s = (x: Aviso) => { setA(x); setVer(true); window.clearTimeout(t); t = window.setTimeout(() => setVer(false), x.tipo === 'error' ? 5000 : 3000) }
    subs.add(s)
    return () => { subs.delete(s); window.clearTimeout(t) }
  }, [])
  return <div className={`ds-toast ds-toast--${a?.tipo ?? 'info'}${ver ? ' ds-toast--ver' : ''}`} role={a?.tipo === 'error' ? 'alert' : 'status'} aria-live="polite" data-testid="toast">{a?.texto}</div>
}
