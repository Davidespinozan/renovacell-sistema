// «ESTE CLIENTE YA TIENE DATOS FISCALES» (27 nov 2026) · en el punto de venta, para quien no ve los datos completos
// (Ventas): avisa que el expediente ya los tiene —con el RFC enmascarado, igual que en el expediente— y deja pedir la
// factura con ellos sin teclear nada, o capturar otros para esta venta.
import React from 'react'
import { BadgeCheck } from 'lucide-react'
import type { FiscalEnExpediente } from '../data/ops/fiscalExpediente'

export function FiscalDelExpediente({ info, usar, onCambiar, testid = 'fiscal-expediente' }: {
  info: FiscalEnExpediente; usar: boolean; onCambiar: (usar: boolean) => void; testid?: string
}) {
  return (
    <div className="sysnote fiscal-exp" data-testid={testid}>
      <BadgeCheck size={16} aria-hidden />
      <div className="fiscal-exp-tx">
        <div><b>Este cliente ya tiene datos fiscales en su expediente.</b> RFC <span className="mono">{info.rfc}</span>{info.alias ? ` · ${info.alias}` : ''}</div>
        <div className="seg fiscal-exp-seg" role="group" aria-label="Con qué datos se pide la factura">
          <button type="button" className={usar ? 'active' : undefined} aria-pressed={usar} onClick={() => onCambiar(true)} data-testid={`${testid}-usar`}>Usar los de su expediente</button>
          <button type="button" className={!usar ? 'active' : undefined} aria-pressed={!usar} onClick={() => onCambiar(false)} data-testid={`${testid}-otros`}>Capturar otros datos</button>
        </div>
        {usar && <div className="fiscal-exp-nota" data-testid={`${testid}-nota`}>La factura se pide con esos datos: no hay que volver a escribirlos.</div>}
      </div>
    </div>
  )
}
