// Estados vacíos y de carga con una sola receta (diseno.md):
//   vacío  = ícono · frase corta · pista · una acción (opcional)
//   carga  = esqueleto con shimmer (.skel), nunca spinner a pantalla completa
// Las vistas no dibujan esto a mano: usan <Vacio> y <Cargando>.
import React from 'react'
import { Icon, type IconName } from './icons'

type VacioProps = {
  icono?: IconName
  titulo: React.ReactNode
  pista?: React.ReactNode
  accion?: React.ReactNode
  /** Sin tarjeta propia (cuando ya vive dentro de una). */
  plano?: boolean
  'data-testid'?: string
}

export function Vacio({ icono = 'layers', titulo, pista, accion, plano, ...rest }: VacioProps) {
  return (
    <div className={plano ? 'empty' : 'card empty'} role="status" data-testid={rest['data-testid']}>
      <div className="empty-ic" aria-hidden="true"><Icon name={icono} /></div>
      <div className="empty-t">{titulo}</div>
      {pista && <div className="empty-d">{pista}</div>}
      {accion && <div className="empty-a">{accion}</div>}
    </div>
  )
}

export function Cargando({ filas = 3, etiqueta = 'Cargando…', plano }: { filas?: number; etiqueta?: string; plano?: boolean }) {
  return (
    <div className={plano ? 'skel-list' : 'card skel-list'} role="status" aria-busy="true" aria-label={etiqueta}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="skel-row">
          <span className="skel skel-dot" />
          <span className="skel-lines">
            <span className="skel" style={{ width: `${62 - (i % 3) * 12}%` }} />
            <span className="skel" style={{ width: `${38 + (i % 2) * 14}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}
