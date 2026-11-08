// Línea de seguimiento del pedido (tracking), fiel al .trk del demo.
import React from 'react'
import { Icon } from '../../app/icons'
import { TRACK_STEPS } from './orderStatus'

export function Trk({ step }: { step: number }) {
  // CALIDAD VISUAL · en celular, versión compacta (paso actual + barra); en escritorio, la línea completa.
  const actual = Math.min(Math.max(step, 0), TRACK_STEPS.length - 1)
  return (
    <>
    <div className="trk-compacto" aria-label={`${TRACK_STEPS[actual]} · paso ${actual + 1} de ${TRACK_STEPS.length}`}>
      {/* el estado actual ya va en la etiqueta de arriba: aquí, qué sigue */}
      <div className="trk-compacto-tx"><span className="trk-sig">{actual < TRACK_STEPS.length - 1 ? <>Sigue: <b>{TRACK_STEPS[actual + 1]}</b></> : <b>Completado</b>}</span><span>Paso {actual + 1} de {TRACK_STEPS.length}</span></div>
      <div className="trk-compacto-barra"><span style={{ width: `${((actual + 1) / TRACK_STEPS.length) * 100}%` }} /></div>
    </div>
    <div className="trk">
      {TRACK_STEPS.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'now' : 'todo'
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className={'tseg' + (i <= step ? ' done' : '')} />}
            <div className="tnode">
              <div className={'tdot ' + state}>{i < step && <Icon name="check" />}</div>
              <div className={'tlab ' + (i <= step ? 'done' : '')}>{label}</div>
            </div>
          </React.Fragment>
        )
      })}
    </div>
    </>
  )
}
