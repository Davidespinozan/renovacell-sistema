// Línea de seguimiento del pedido (tracking), fiel al .trk del demo.
import React from 'react'
import { Icon } from '../../app/icons'
import { TRACK_STEPS } from './orderStatus'

export function Trk({ step }: { step: number }) {
  return (
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
  )
}
