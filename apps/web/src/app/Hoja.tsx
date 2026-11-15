// SISTEMA DE DISEÑO · hoja inferior en el celular / diálogo en escritorio (portado de STRYV, Sheet variante "ds").
// Encabezado y acción principal fijos; solo el cuerpo hace scroll. Foco adentro al abrir, Escape cierra, el fondo no se
// mueve. Se monta en <body> (portal) para quedar SIEMPRE encima de todo (lección del chat: dentro de una capa quedaba debajo).
import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Hoja({ abierta, onCerrar, titulo, children, pie, ancha = false, testid }: {
  abierta: boolean; onCerrar: () => void; titulo: string; children: React.ReactNode; pie?: React.ReactNode; ancha?: boolean; testid?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!abierta) return
    const previo = document.activeElement as HTMLElement | null
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar() } }
    document.addEventListener('keydown', esc)
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.ds-hoja-x)')?.focus()
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = overflow; previo?.focus?.() }
  }, [abierta, onCerrar])
  if (!abierta || typeof document === 'undefined') return null
  return createPortal(
    <div className="ds-hoja-fondo" onClick={onCerrar} data-testid={testid ? `${testid}-fondo` : undefined}>
      <div ref={ref} className={`ds-hoja${ancha ? ' ds-hoja--ancha' : ''}`} role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()} data-testid={testid}>
        <div className="ds-hoja-cab"><h3>{titulo}</h3><button type="button" className="ds-hoja-x" onClick={onCerrar} aria-label="Cerrar"><X size={18} /></button></div>
        <div className="ds-hoja-cuerpo">{children}</div>
        {pie && <div className="ds-hoja-pie">{pie}</div>}
      </div>
    </div>,
    document.body,
  )
}
