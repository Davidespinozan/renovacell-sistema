// Selector de dirección de ENTREGA reutilizable (portal del doctor y Ventas).
// Regla: si el cliente tiene domicilio base, se ofrece "enviar ahí" o "a otra
// dirección"; si no tiene base, se pide la dirección. La elegida viaja con el pedido.
import React, { useState } from 'react'
import { Icon } from './icons'
import { faltantesDeEntrega, formatAddress, isAddressDeliverable, type ShippingAddress } from '../data/ops/shippingAddress'

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)', marginTop: 5 }
const label: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 10 }

const EMPTY: ShippingAddress = { line1: '', colonia: '', cp: '', city: '', state: '', refs: '', phone: '' }

// `value` = dirección elegida; `onChange` la reporta al padre (null si aún no es usable).
export function AddressPicker({ base: baseRecibida, value, onChange }: {
  base: ShippingAddress | null
  value: ShippingAddress | null
  onChange: (a: ShippingAddress | null) => void
}) {
  // El domicilio base solo se ofrece tal cual si está COMPLETO para entregar (C.P. y teléfono). Si le falta algo,
  // se usa como punto de partida del formulario para completarlo aquí, al vender, y no en Empaque.
  const base = isAddressDeliverable(baseRecibida) ? baseRecibida : null
  // Modo: usar el domicilio base, o capturar otro. Sin base, arranca en "otra".
  const [mode, setMode] = useState<'base' | 'otra'>(base ? 'base' : 'otra')
  const [form, setForm] = useState<ShippingAddress>(value && !base ? value : { ...EMPTY, ...(baseRecibida && !base ? { ...baseRecibida, phone: /\d{10}/.test((baseRecibida.phone ?? '').replace(/\D/g, '')) ? baseRecibida.phone : '' } : {}) })

  const pickBase = () => { setMode('base'); onChange(base) }
  const pickOtra = () => { setMode('otra'); onChange(isAddressDeliverable(form) ? form : null) }
  const set = (patch: Partial<ShippingAddress>) => {
    const next = { ...form, ...patch }
    setForm(next)
    onChange(isAddressDeliverable(next) ? next : null)
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
            <input style={input} placeholder="C.P. (5 dígitos)" inputMode="numeric" maxLength={5} aria-label="Código postal" value={form.cp} onChange={(e) => set({ cp: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={input} placeholder="Ciudad" value={form.city} onChange={(e) => set({ city: e.target.value })} />
            <input style={input} placeholder="Estado" value={form.state} onChange={(e) => set({ state: e.target.value })} />
          </div>
          <input style={input} placeholder="Referencias / entre calles (opcional)" value={form.refs} onChange={(e) => set({ refs: e.target.value })} />
          <input style={input} placeholder="Teléfono de quien recibe (10 dígitos)" inputMode="tel" maxLength={20} aria-label="Teléfono de quien recibe" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          {!isAddressDeliverable(form) && <div style={{ fontSize: 11, color: 'var(--warn, #b45309)', marginTop: 6 }} data-testid="entrega-faltantes">Para poder entregar falta: {faltantesDeEntrega(form).join(', ')}.</div>}
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