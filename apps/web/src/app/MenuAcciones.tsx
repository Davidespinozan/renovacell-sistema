// CALIDAD VISUAL (7 nov 2026) · menú «⋯» para las acciones secundarias y destructivas de una tarjeta o fila. Antes cada tarjeta
// mostraba editar/fijar/borrar (borrar en rojo) siempre visibles: ruido y riesgo de tocar lo que no era. Se cierra al tocar
// fuera, con Esc o al elegir. Lo destructivo va al final y en rojo.
import React, { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface Accion { etiqueta: string; icono?: React.ReactNode; onElegir: () => void; peligro?: boolean; activa?: boolean; testid?: string }

export function MenuAcciones({ acciones, etiqueta = 'Más acciones', testid }: { acciones: Accion[]; etiqueta?: string; testid?: string }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('pointerdown', fuera); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', esc) }
  }, [abierto])
  const orden = [...acciones.filter((a) => !a.peligro), ...acciones.filter((a) => a.peligro)]
  return (
    <div className="menu-acc" ref={raiz}>
      <button type="button" className="menu-acc-btn" aria-label={etiqueta} title={etiqueta} aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)} data-testid={testid}>
        <MoreHorizontal size={18} />
      </button>
      {abierto && (
        <div className="menu-acc-pop" role="menu">
          {orden.map((a) => (
            <button key={a.etiqueta} type="button" role="menuitem" className={'menu-acc-item' + (a.peligro ? ' peligro' : '') + (a.activa ? ' activa' : '')}
              onClick={() => { setAbierto(false); a.onElegir() }} data-testid={a.testid}>
              {a.icono}<span>{a.etiqueta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
