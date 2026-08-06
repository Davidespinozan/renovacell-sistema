// Selector de dirección de ENTREGA reutilizable (portal del doctor y Ventas).
// Regla: si el cliente tiene domicilio base, se ofrece "enviar ahí" o "a otra
// dirección"; si no tiene base, se pide la dirección. La elegida viaja con el pedido.
import React, { useState } from 'react'
import { Icon } from './icons'
import { formatAddress, isAddressUsable, type ShippingAddress } from '../data/ops/shippingAddress'

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 5 }
const label: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 10 }

const EMPTY: ShippingAddress = { line1: '', colonia: '', cp: '', city: '', state: '', refs: '', phone: '' }

// `value` = dirección elegida; `onChange` la reporta al padre (null si aún no es usable).
export function AddressPicker({ base, value, onChange }: {
  base: ShippingAddress | null
  value: ShippingAddress | null
  onChange: (a: ShippingAddress | null) => void
}) {
  // Modo: usar el domicilio base, o capturar otro. Sin base, arranca en "otra".
  const [mode, setMode] = useState<'base' | 'otra'>(base ? 'base' : 'otra')
  const [form, setForm] = useState<ShippingAddress>(value && !base ? value : EMPTY)

  const pickBase = () => { setMode('base'); onChange(base) }
  const pickOtra = () => { setMode('otra'); onChange(isAddressUsable(form) ? form : null) }
  const set = (patch: Partial<ShippingAddress>) => {
    const next = { ...form, ...patch }
    setForm(next)
    onChange(isAddressUsable(next) ? next : null)
  }

  return (
    <div>
      {base && (
        <div style={{ display: 'grid', gap: 8, marginBottom: mode === 'otra' ? 10 : 0 }}>
          <label className="addr-opt" style={optStyle(mode === 'base')} onClick={pickBase}>
            <input type="radio" checked={mode === 'base'} onChange={pickBase} />
            <span style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: 13 }}>Enviar a su domicilio</b>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatAddress(base)}</span>
            </span>
            <Icon name="usercheck" style={{ width: 15, height: 15, color: 'var(--green-deep)' }} />
          </label>
          <label className="addr-opt" style={optStyle(mode === 'otra')} onClick={pickOtra}>
            <input type="radio" checked={mode === 'otra'} onChange={pickOtra} />
            <b style={{ fontSize: 13 }}>Enviar a otra dirección</b>
          </label>
        </div>
      )}

      {(mode === 'otra' || !base) && (
        <div>
          {!base && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Dirección de entrega de este pedido:</div>}
          <input style={input} placeholder="Calle y número" value={form.line1} onChange={(e) => set({ line1: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={input} placeholder="Colonia" value={form.colonia} onChange={(e) => set({ colonia: e.target.value })} />
            <input style={input} placeholder="C.P." inputMode="numeric" value={form.cp} onChange={(e) => set({ cp: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={input} placeholder="Ciudad" value={form.city} onChange={(e) => set({ city: e.target.value })} />
            <input style={input} placeholder="Estado" value={form.state} onChange={(e) => set({ state: e.target.value })} />
          </div>
          <input style={input} placeholder="Referencias / entre calles (opcional)" value={form.refs} onChange={(e) => set({ refs: e.target.value })} />
          <input style={input} placeholder="Teléfono de contacto para la entrega" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          {!isAddressUsable(form) && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Calle y ciudad son necesarias para poder entregar.</div>}
        </div>
      )}
    </div>
  )
}

// Etiqueta como fields de otras pantallas (label seleccionable).
function optStyle(on: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
    border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 11,
    background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: 'pointer', fontFamily: 'inherit',
  }
}