// Formulario de captura/edición de una ubicación de entrega (doctor_locations).
// SOLO datos de ENTREGA — nunca fiscales (RFC/CFDI viven en meta.fiscal, otra pantalla).
// Reutilizado por "Mi perfil → Ubicaciones" y por el checkout cuando no hay ubicaciones.
import React, { useState } from 'react'
import type { LocationFields } from '../data/store/doctorLocationsStore'

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 5 }
const label: React.CSSProperties = { display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 10 }

export const EMPTY_LOCATION: LocationFields = {
  name: '', line1: '', exterior_number: '', interior_number: '', neighborhood: '',
  postal_code: '', city: '', state: '', country: 'México', reference_notes: '',
  contact_name: '', contact_phone: '',
}

// Campos mínimos obligatorios (§1): name, line1, postal_code, city, state, country.
export function isLocationValid(f: LocationFields): boolean {
  return [f.name, f.line1, f.postal_code, f.city, f.state, f.country]
    .every((v) => (v ?? '').toString().trim().length > 0)
}

export function LocationForm({ value, onChange }: { value: LocationFields; onChange: (f: LocationFields) => void }) {
  const set = (patch: Partial<LocationFields>) => onChange({ ...value, ...patch })
  const s = (v: string | null | undefined) => v ?? ''
  return (
    <div>
      <label style={label}>Nombre / alias *</label>
      <input style={input} placeholder="Clínica Centro, Consultorio Norte…" value={s(value.name)} onChange={(e) => set({ name: e.target.value })} />
      <label style={label}>Calle *</label>
      <input style={input} placeholder="Calle" value={s(value.line1)} onChange={(e) => set({ line1: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><label style={label}>Núm. exterior</label><input style={input} value={s(value.exterior_number)} onChange={(e) => set({ exterior_number: e.target.value })} /></div>
        <div><label style={label}>Núm. interior</label><input style={input} value={s(value.interior_number)} onChange={(e) => set({ interior_number: e.target.value })} /></div>
      </div>
      <label style={label}>Colonia</label>
      <input style={input} value={s(value.neighborhood)} onChange={(e) => set({ neighborhood: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><label style={label}>C.P. *</label><input style={input} inputMode="numeric" value={s(value.postal_code)} onChange={(e) => set({ postal_code: e.target.value })} /></div>
        <div><label style={label}>Ciudad *</label><input style={input} value={s(value.city)} onChange={(e) => set({ city: e.target.value })} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><label style={label}>Estado *</label><input style={input} value={s(value.state)} onChange={(e) => set({ state: e.target.value })} /></div>
        <div><label style={label}>País *</label><input style={input} value={s(value.country)} onChange={(e) => set({ country: e.target.value })} /></div>
      </div>
      <label style={label}>Referencias / entre calles</label>
      <input style={input} value={s(value.reference_notes)} onChange={(e) => set({ reference_notes: e.target.value })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><label style={label}>Contacto</label><input style={input} value={s(value.contact_name)} onChange={(e) => set({ contact_name: e.target.value })} /></div>
        <div><label style={label}>Teléfono</label><input style={input} inputMode="tel" value={s(value.contact_phone)} onChange={(e) => set({ contact_phone: e.target.value })} /></div>
      </div>
      {!isLocationValid(value) && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Nombre, calle, C.P., ciudad, estado y país son obligatorios.</div>}
    </div>
  )
}

// Estado local de formulario reutilizable.
export function useLocationForm(initial: LocationFields = EMPTY_LOCATION) {
  return useState<LocationFields>(initial)
}
