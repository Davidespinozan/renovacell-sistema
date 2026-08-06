// Dar de baja por MERMA — parcial o total. Antes solo se podía dar de baja el lote
// COMPLETO; aquí el almacenista elige CUÁNTAS unidades y el motivo. Escribe un
// movimiento de inventario (adjust −qty, reason 'merma') → queda en la trazabilidad.
import React, { useState } from 'react'
import { Icon } from '../../app/icons'
import { adjust } from '../../data/store/lotsStore'

const MOTIVOS = ['Dañado', 'Caducado', 'Robo / extravío', 'Muestra', 'Otro']

export function MermaModal({ lot, onClose }: {
  lot: { id: string; lot_code: string; quantity: number; producto?: string }
  onClose: () => void
}) {
  const [qty, setQty] = useState<string>(String(lot.quantity))
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const n = Math.max(0, Math.min(lot.quantity, Math.floor(Number(qty) || 0)))

  const dar = () => {
    if (n <= 0) return
    adjust(lot.id, -n, 'merma', `${motivo} · ${lot.lot_code}`)
    onClose()
  }

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Dar de baja (merma)</h3><div className="ms">{lot.producto ? `${lot.producto} · ` : ''}Lote {lot.lot_code} · {lot.quantity} u disponibles</div></div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Motivo</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            {MOTIVOS.map((m) => (
              <button key={m} type="button" onClick={() => setMotivo(m)} className={'fchip' + (motivo === m ? ' on' : '')}>{m}</button>
            ))}
          </div>

          <label style={label}>Cantidad a dar de baja</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={input} type="number" min={1} max={lot.quantity} value={qty} onChange={(e) => setQty(e.target.value)} />
            <button className="btn ghost sm" type="button" onClick={() => setQty(String(lot.quantity))}>Todo el lote</button>
          </div>
          {n > 0 && n < lot.quantity && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>Quedan {lot.quantity - n} u en el lote tras la baja.</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={dar} disabled={n <= 0} style={n <= 0 ? { opacity: 0.5, cursor: 'not-allowed' } : { background: 'var(--danger)' }}>
              <Icon name="x" /> Dar de baja {n} u
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}