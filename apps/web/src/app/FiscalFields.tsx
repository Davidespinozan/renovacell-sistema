// Formulario/Resumen fiscal COMPARTIDO — un solo componente para Portal, POS, Nuevo pedido,
// Mi Perfil y Facturación. Garantiza los mismos 6 campos canónicos y las mismas validaciones
// en todos los canales (sin formularios divergentes). Usa los catálogos SAT existentes.
import React from 'react'
import { REGIMENES_OPTIONS, nombreRegimen } from '../data/sat/regimenesFiscales'
import { USOS_CFDI_OPTIONS, nombreUsoCfdi } from '../data/sat/usosCfdi'
import { validateFiscalProfile, personTypeFromRfc, type FiscalProfile } from '../data/ops/fiscal'

const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
const err: React.CSSProperties = { fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }

export function FiscalFields({ value, onChange, showErrors = false }: {
  value: FiscalProfile
  onChange: (next: FiscalProfile) => void
  showErrors?: boolean
}) {
  const { errors } = validateFiscalProfile(value)
  const set = (patch: Partial<FiscalProfile>) => onChange({ ...value, ...patch })
  const person = personTypeFromRfc(value.rfc)

  return (
    <div>
      <label style={lbl}>RFC {person && <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}>· persona {person}</span>}</label>
      <input style={inp} value={value.rfc} maxLength={13} placeholder="XAXX010101000 / XAX010101AB0"
        onChange={(e) => set({ rfc: e.target.value.toUpperCase().replace(/\s/g, '') })} />
      {showErrors && errors.rfc && <div style={err}>{errors.rfc}</div>}

      <label style={lbl}>Razón social (nombre fiscal)</label>
      <input style={inp} value={value.razon_social} placeholder="Como aparece en la constancia de situación fiscal"
        onChange={(e) => set({ razon_social: e.target.value })} />
      {showErrors && errors.razon_social && <div style={err}>{errors.razon_social}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={lbl}>Régimen fiscal</label>
          <select style={inp} value={value.regimen} onChange={(e) => set({ regimen: e.target.value })}>
            <option value="">Selecciona…</option>
            {REGIMENES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {showErrors && errors.regimen && <div style={err}>{errors.regimen}</div>}
        </div>
        <div>
          <label style={lbl}>CP fiscal</label>
          <input style={inp} inputMode="numeric" maxLength={5} value={value.cp} placeholder="80020"
            onChange={(e) => set({ cp: e.target.value.replace(/\D/g, '').slice(0, 5) })} />
          {showErrors && errors.cp && <div style={err}>{errors.cp}</div>}
        </div>
      </div>

      <label style={lbl}>Uso de CFDI</label>
      <select style={inp} value={value.uso_cfdi} onChange={(e) => set({ uso_cfdi: e.target.value })}>
        <option value="">Selecciona…</option>
        {USOS_CFDI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {showErrors && errors.uso_cfdi && <div style={err}>{errors.uso_cfdi}</div>}

      <label style={lbl}>Correo de facturación</label>
      <input style={inp} type="email" value={value.email_facturacion} placeholder="facturacion@cliente.mx"
        onChange={(e) => set({ email_facturacion: e.target.value.trim().toLowerCase() })} />
      {showErrors && errors.email_facturacion && <div style={err}>{errors.email_facturacion}</div>}
    </div>
  )
}

// Resumen de solo lectura (para confirmar antes de continuar / ver el snapshot del pedido).
export function FiscalSummary({ value }: { value: FiscalProfile }) {
  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--ink-3)' }}>{k}</span>
      <span style={{ textAlign: 'right', fontWeight: 600 }}>{v || '—'}</span>
    </div>
  )
  return (
    <div>
      {row('RFC', value.rfc)}
      {row('Razón social', value.razon_social)}
      {row('Régimen', value.regimen ? `${value.regimen} · ${nombreRegimen(value.regimen)}` : '')}
      {row('CP fiscal', value.cp)}
      {row('Uso CFDI', value.uso_cfdi ? `${value.uso_cfdi} · ${nombreUsoCfdi(value.uso_cfdi)}` : '')}
      {row('Correo', value.email_facturacion)}
    </div>
  )
}
