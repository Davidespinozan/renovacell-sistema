// SALIDA PROGRAMADA (2 nov 2026) · agendar o mover la salida de un pedido ya hecho (vendedor, Dirección, Almacén), antes
// de empacarlo. El flete no cambia; con entrega local por chofer se elige el horario a partir de la nueva fecha.
import React, { useState } from 'react'
import { fechaCorta, programarSalida, type EntregaPedido, type HorarioElegido } from '../data/ops/entrega'
import { hoyNegocio, sumarDias } from '../data/periodo'
import { HorarioEntregaPicker } from './HorarioEntregaPicker'

export function ProgramarSalida({ orderId, folio, entrega, onListo, programar = programarSalida }: {
  orderId: string; folio?: string | null; entrega: EntregaPedido | null
  onListo?: (e: EntregaPedido) => void
  programar?: typeof programarSalida
}) {
  const [abierto, setAbierto] = useState(false)
  const [fecha, setFecha] = useState('')
  const [horario, setHorario] = useState<HorarioElegido | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  if (!entrega || entrega.tipo === 'mostrador') return null
  const chofer = entrega.tipo === 'local' && entrega.paqueteria === 'chofer'
  const listo = !!fecha && motivo.trim().length >= 3 && (!chofer || !!horario)
  const guardar = async () => {
    if (!listo || ocupado) return
    setOcupado(true); setError(null)
    const r = await programar(orderId, fecha, chofer ? horario : null, motivo.trim())
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    setAbierto(false); setFecha(''); setHorario(null); setMotivo('')
    onListo?.(r.entrega)
  }
  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setAbierto(true)} data-testid="programar-salida">
        {entrega.programada ? `Sale el ${fechaCorta(entrega.salida)} · cambiar` : 'Agendar salida'}
      </button>
      {abierto && (
        <div className="overlay" onClick={() => setAbierto(false)}>
          <div className="modal" role="dialog" aria-label="Agendar salida" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }} data-testid="programar-salida-modal">
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Agendar salida {folio ? `· ${folio}` : ''}</h3>
            <p className="ms" style={{ color: 'var(--ink-3)', marginBottom: 10 }}>Hoy sale el {fechaCorta(entrega.salida)}. Elige otra fecha (hasta 90 días); el flete no cambia y Almacén lo prepara un día antes.</p>
            <label style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>Fecha de salida
              <input type="date" value={fecha} min={hoyNegocio()} max={sumarDias(hoyNegocio(), 90)} onChange={(e) => { setFecha(e.target.value); setHorario(null) }} data-testid="programar-salida-fecha" />
            </label>
            {chofer && fecha && (
              <div style={{ marginTop: 10 }}>
                <div className="eyebrow" style={{ margin: '0 0 6px' }}>Horario de entrega</div>
                <HorarioEntregaPicker value={horario} onChange={setHorario} compacto desde={fecha} />
              </div>
            )}
            <label style={{ fontSize: 12.5, display: 'grid', gap: 4, marginTop: 10 }}>Motivo
              <input type="text" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. el doctor lo quiere para el 20" data-testid="programar-salida-motivo" />
            </label>
            {error && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginTop: 8 }} data-testid="programar-salida-error">{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setAbierto(false)}>Cancelar</button>
              <button type="button" className="btn" disabled={!listo || ocupado} onClick={() => void guardar()} data-testid="programar-salida-guardar">{ocupado ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
