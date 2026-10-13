// PAQ-A · Bloque de rastreo de paquetería, el MISMO para Empaque, Seguimiento y el portal del doctor: estado actual,
// quién recibió, última actualización e historial de eventos. `vista="cliente"` usa lenguaje para el cliente y no
// ofrece forzar la consulta. Sin rastreo disponible no pinta nada.
import React, { useState } from 'react'
import { Icon } from './icons'
import { fmtDate } from '../lib/format'
import { ETIQUETA_RASTREO, type Rastreo } from '../data/shipping/rastreo'

const hora = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${fmtDate(iso)} · ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` }

export function RastreoEnvio({ rastreo, cargando, onActualizar, vista = 'staff' }: {
  rastreo: Rastreo | null; cargando: boolean; onActualizar?: () => void; vista?: 'staff' | 'cliente'
}) {
  const [abierto, setAbierto] = useState(false)
  if (!rastreo) return cargando ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }} data-testid="rastreo-cargando">Consultando a la paquetería…</div> : null
  const e = ETIQUETA_RASTREO[rastreo.estado]
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--cp-surface, #fff)' }} data-testid="rastreo-envio">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className={'pill ' + e.pill} data-testid="rastreo-estado">{vista === 'cliente' ? e.cliente : e.label}</span>
        {rastreo.estado === 'entregado' && rastreo.firmadoPor && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Recibió: {rastreo.firmadoPor}</span>}
        {rastreo.estado === 'entregado' && rastreo.entregadoAt && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{hora(rastreo.entregadoAt)}</span>}
        {vista === 'staff' && onActualizar && rastreo.estado !== 'entregado' && (
          <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={onActualizar} disabled={cargando} data-testid="rastreo-actualizar">
            <Icon name="clock" style={{ width: 13, height: 13 }} /> {cargando ? 'Consultando…' : 'Actualizar rastreo'}
          </button>
        )}
      </div>
      {rastreo.descripcion && rastreo.estado !== 'entregado' && <div style={{ fontSize: 12.5, marginTop: 6 }}>{rastreo.descripcion}</div>}
      {rastreo.estado === 'sin_eventos' && vista === 'staff' && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>La paquetería aún no registra movimientos: el paquete sigue en el local hasta entregarlo en sucursal o que pasen a recogerlo.</div>}
      {rastreo.aviso && <div style={{ fontSize: 12, color: 'var(--warn, #b45309)', marginTop: 6 }} data-testid="rastreo-aviso">{rastreo.aviso}</div>}
      {vista === 'staff' && rastreo.cierre === 'pendiente' && <div style={{ fontSize: 12, color: 'var(--warn, #b45309)', marginTop: 6 }}>La paquetería ya lo reporta entregado; el pedido se cerrará cuando Almacén o Dirección actualicen el rastreo.</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
        {rastreo.actualizadoAt && <span>Actualizado: {hora(rastreo.actualizadoAt)}</span>}
        {rastreo.eventos.length > 0 && (
          <button type="button" onClick={() => setAbierto((v) => !v)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--green-deep)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5 }} data-testid="rastreo-ver-historial">
            {abierto ? 'Ocultar historial' : `Ver historial (${rastreo.eventos.length})`}
          </button>
        )}
      </div>
      {abierto && (
        <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }} data-testid="rastreo-historial">
          {rastreo.eventos.map((ev, i) => (
            <li key={ev.at + ev.codigo + i} style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8 }}>
              <span style={{ color: 'var(--ink-3)' }}>{hora(ev.at)}</span>
              <span>{ev.descripcion || ev.codigo || 'Movimiento'}{ev.lugar ? <span style={{ color: 'var(--ink-3)' }}> · {ev.lugar}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
