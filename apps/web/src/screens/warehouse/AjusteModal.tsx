// Corregir conteo de un lote: el almacenista teclea el CONTEO FÍSICO real y el sistema
// calcula la diferencia (sobrante o faltante) y escribe UN movimiento 'ajuste' con motivo
// → queda en la trazabilidad. Antes solo se podía RESTAR (merma) o crear un lote nuevo
// (entrada); no había forma de corregir hacia arriba ni de cuadrar un conteo mal capturado.
import React, { useState } from 'react'
import { Icon } from '../../app/icons'
import { adjust } from '../../data/store/lotsStore'

const MOTIVOS = ['Conteo físico', 'Entrada mal capturada', 'Devolución no registrada', 'Otro']

export function AjusteModal({ lot, onClose }: {
  lot: { id: string; lot_code: string; quantity: number; producto?: string }
  onClose: () => void
}) {
  const [real, setReal] = useState<string>(String(lot.quantity))
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const realN = Math.max(0, Math.floor(Number(real) || 0))
  const delta = realN - lot.quantity

  const aplicar = () => {
    if (delta === 0) return
    adjust(lot.id, delta, 'ajuste', `${motivo} · ${lot.lot_code}`)
    onClose()
  }

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Corregir conteo</h3><div className="ms">{lot.producto ? `${lot.producto} · ` : ''}Lote {lot.lot_code} · sistema marca {lot.quantity} u</div></div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Motivo</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            {MOTIVOS.map((m) => (
              <button key={m} type="button" onClick={() => setMotivo(m)} className={'fchip' + (motivo === m ? ' on' : '')}>{m}</button>
            ))}
          </div>

          <label style={label}>Conteo físico real</label>
          <input style={input} type="number" min={0} value={real} onChange={(e) => setReal(e.target.value)} />
          {delta !== 0 && (
            <div style={{ fontSize: 12.5, marginTop: 8, color: delta > 0 ? 'var(--green-deep)' : 'var(--danger)' }}>
              {delta > 0 ? `Sobran ${delta} u — se sumarán al lote.` : `Faltan ${-delta} u — se restarán del lote.`}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={aplicar} disabled={delta === 0} style={delta === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              <Icon name="check" /> Ajustar a {realN} u
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
