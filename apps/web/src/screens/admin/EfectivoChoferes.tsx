// EFECTIVO DE CHOFERES (BLOQUE1, 20 nov 2026) · en Cierre de caja. Lo que cada chofer cobró en la puerta y aún no
// entrega. Al recibirlo: se cuenta, se captura lo contado y queda como corte del chofer (si no cuadra, con motivo).
// Desde ese momento el efectivo cuenta en la caja del día.
import React, { useCallback, useEffect, useState } from 'react'
import { avisar, confirmar, pedirTexto } from '../../app/dialogos'
import { money, fmtDate } from '../../lib/format'
import { efectivoChofer, type EfectivoDeChofer } from '../../data/ops/efectivoChofer'
import { newOpId } from '../../data/ops/w1Command'

const api = efectivoChofer()

export function EfectivoChoferes({ alRecibir }: { alRecibir?: () => void }) {
  const [lista, setLista] = useState<EfectivoDeChofer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const r = await api.choferes()
    if (r.ok) { setLista(r.data ?? []); setError(null) } else setError(r.error)
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const recibir = async (c: EfectivoDeChofer) => {
    const t = await pedirTexto(`¿Cuánto efectivo te entregó ${c.nombre}? (según el sistema trae ${money(c.pendiente)})`, String(c.pendiente))
    if (t == null) return
    const contado = Number(t.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(contado) || contado < 0) { void avisar('Escribe una cantidad válida.'); return }
    let motivo: string | null = null
    if (Math.abs(contado - c.pendiente) > 0.009) {
      motivo = await pedirTexto(`No cuadra: esperado ${money(c.pendiente)}, contado ${money(contado)}. ¿Por qué?`)
      if (!motivo || !motivo.trim()) return
    } else if (!(await confirmar(`¿Recibir ${money(contado)} de ${c.nombre}?`, { aceptar: 'Recibir' }))) return
    setOcupado(c.driver_id)
    const r = await api.recibir(c.driver_id, contado, motivo, newOpId())
    setOcupado(null)
    if (!r.ok) { void avisar(r.error); return }
    await cargar()
    alRecibir?.()
  }

  if (error) return <div className="card"><div className="eyebrow">Efectivo de choferes</div><div className="lt">{error}</div></div>
  if (!lista || lista.length === 0) return null
  return (
    <div className="card" data-testid="efectivo-choferes">
      <div className="eyebrow">Efectivo de choferes</div>
      <div className="lt" style={{ marginBottom: 8 }}>Lo que cobraron al entregar y todavía no entregan en la oficina. Al recibirlo, pasa a la caja del día.</div>
      {lista.map((c) => (
        <div key={c.driver_id} className="lrow">
          <div>
            <div className="nm">{c.nombre}</div>
            <div className="lt">{c.cobros > 0 ? `${c.cobros} ${c.cobros === 1 ? 'cobro' : 'cobros'} desde ${fmtDate(c.desde)}` : 'Sin cobros pendientes'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <b className="mono">{money(c.pendiente)}</b>
            {c.pendiente > 0 && (
              <button className="btn sm" type="button" disabled={ocupado === c.driver_id} onClick={() => void recibir(c)} data-testid="recibir-efectivo">
                {ocupado === c.driver_id ? 'Guardando…' : 'Recibir'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
