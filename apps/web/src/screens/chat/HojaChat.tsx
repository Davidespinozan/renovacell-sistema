// EXPEDIENTE EN EL CHAT · marco común de una hoja de trabajo dentro de la conversación (sube sobre el redactor; el hilo
// sigue a la vista arriba). La usan el panel del cliente, la verificación y los datos del enlace de contacto.
import React from 'react'
import { X } from 'lucide-react'
import type { AccionChat } from './ChatCanonico'

export function HojaMarco({ titulo, sub, onCerrar, children, testid }: { titulo: string; sub?: string; onCerrar: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <section className="hj" aria-label={titulo} data-testid={testid}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar() } }}>
      <header className="hj-h">
        <div className="hj-h-tx"><b>{titulo}</b>{sub && <span>{sub}</span>}</div>
        <button type="button" className="rc-ico" onClick={onCerrar} aria-label="Cerrar" title="Cerrar" data-testid="hoja-cerrar"><X size={17} /></button>
      </header>
      <div className="hj-b">{children}</div>
    </section>
  )
}

/** Piezas que una herramienta aporta a la conversación: franja (quién es), acciones del menú «+» y su hoja abierta. */
export interface PiezasChat { tira: React.ReactNode; hoja: React.ReactNode; acciones: AccionChat[] }
