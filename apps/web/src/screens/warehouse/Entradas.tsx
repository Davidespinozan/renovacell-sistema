// Entradas: registrar entrada de inventario (nuevo lote) -> genera un
// inventory_movement (+cantidad). Muestra el ledger inmutable de movimientos.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useInventory } from '../../data/hooks/useInventory'
import { useProducts } from '../../data/hooks/useProducts'
import type { Lot, ProductSafe } from '../../data/types'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
  borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px',
}

export function Entradas() {
  const { data: products } = useProducts()
  const { data: lots, addEntry } = useLots()
  const { data: movements } = useInventory()

  const [productId, setProductId] = useState('')
  const [lotCode, setLotCode] = useState('')
  const [expiry, setExpiry] = useState('')
  const [qty, setQty] = useState('')
  const [location, setLocation] = useState('Culiacán')
  const [toast, setToast] = useState<string | null>(null)

  const lotById = useMemo(() => {
    const m: Record<string, Lot | undefined> = {}
    lots.forEach((l) => (m[l.id] = l))
    return m
  }, [lots])
  const prodById = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const valid = productId && lotCode.trim() && Number(qty) > 0

  const submit = () => {
    if (!valid) return
    addEntry({
      product_id: productId,
      lot_code: lotCode.trim(),
      expiry_date: expiry || null,
      quantity: Number(qty),
      location: location.trim() || null,
    })
    setToast(`Entrada registrada: ${lotCode.trim()} (+${qty} u)`)
    setLotCode(''); setExpiry(''); setQty('')
    window.setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="grid two" style={{ alignItems: 'start', gap: 18 }}>
      <div className="card">
        <div className="eyebrow">Registrar entrada</div>
        <label style={labelStyle}>Producto</label>
        <select style={inputStyle} value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Selecciona…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="form-grid-2" style={{ marginTop: 14 }}>
          <div>
            <label style={labelStyle}>Lote</label>
            <input style={inputStyle} value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Ej. MGP-90-C" />
          </div>
          <div>
            <label style={labelStyle}>Cantidad</label>
            <input style={inputStyle} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
          </div>
        </div>

        <div className="form-grid-2" style={{ marginTop: 14 }}>
          <div>
            <label style={labelStyle}>Caducidad</label>
            <input style={inputStyle} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Ubicación</label>
            <input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Culiacán u otra sede" />
          </div>
        </div>

        <button className="btn" type="button" style={{ marginTop: 18, width: '100%', opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed' }} onClick={submit} disabled={!valid}>
          <Icon name="download" /> Registrar entrada
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '18px 18px 0' }}>
          <div className="eyebrow">Movimientos (ledger inmutable)</div>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Fecha</th><th>Lote</th><th>Motivo</th><th>Ref.</th><th>Cambio</th></tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const lot = lotById[m.lot_id]
                const prod = lot ? prodById[lot.product_id] : undefined
                const pos = m.change >= 0
                return (
                  <tr key={m.id}>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(m.created_at)}</td>
                    <td data-label="Lote">
                      <span className="lc">{lot?.lot_code ?? m.lot_id}</span>
                      {prod && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{prod.name}</div>}
                    </td>
                    <td data-label="Motivo"><span className={'pill ' + (m.reason === 'entrada' ? 'p-ok' : 'p-neu')}>{m.reason}</span></td>
                    <td data-label="Ref." className="mono" style={{ fontSize: 11.5 }}>{m.reference}</td>
                    <td data-label="Cambio" className="mono" style={{ color: pos ? 'var(--green-deep)' : 'var(--danger)' }}>{pos ? '+' : ''}{m.change} u</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="toast show"><Icon name="check" /> {toast}</div>
      )}
    </div>
  )
}
