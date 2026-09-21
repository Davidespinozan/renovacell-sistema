// "Ubicaciones de entrega" para Mi Perfil (doctor). CRUD real sobre doctor_locations vía
// useDoctorLocations. NO borra físicamente (soft-delete). NO mezcla datos fiscales.
import React, { useState } from 'react'
import { Icon } from './icons'
import { useDoctorLocations } from '../data/hooks/useDoctorLocations'
import { summarizeLocation, type DoctorLocation } from '../data/ops/doctorLocation'
import { LocationForm, EMPTY_LOCATION, isLocationValid } from './LocationForm'
import type { LocationFields } from '../data/store/doctorLocationsStore'

const heading: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }

export function DeliveryLocationsManager({ doctorId }: { doctorId?: string }) {
  const { data, loading, reload, createDoctorLocation, updateDoctorLocation, deactivateDoctorLocation, setDefaultDoctorLocation } = useDoctorLocations(doctorId)
  const [editing, setEditing] = useState<DoctorLocation | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<LocationFields>(EMPTY_LOCATION)
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState<DoctorLocation | null>(null)

  const active = data.filter((l) => l.active)
  const startAdd = () => { setForm({ ...EMPTY_LOCATION }); setMakeDefault(active.length === 0); setAdding(true); setEditing(null); setError(null) }
  const startEdit = (loc: DoctorLocation) => {
    setEditing(loc); setAdding(false); setError(null)
    setForm({
      name: loc.name, line1: loc.line1, exterior_number: loc.exterior_number, interior_number: loc.interior_number,
      neighborhood: loc.neighborhood, postal_code: loc.postal_code, city: loc.city, state: loc.state,
      country: loc.country, reference_notes: loc.reference_notes, contact_name: loc.contact_name, contact_phone: loc.contact_phone,
    })
  }
  const cancel = () => { setAdding(false); setEditing(null); setError(null) }

  const save = async () => {
    if (!isLocationValid(form) || busy) return
    setBusy(true); setError(null)
    if (editing) {
      const r = await updateDoctorLocation(editing.id, form)
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); setBusy(false); return }
    } else {
      const r = await createDoctorLocation(form, doctorId)
      if (!r.ok) { setError(r.error ?? 'No se pudo guardar.'); setBusy(false); return }
      if (makeDefault && r.id) await setDefaultDoctorLocation(r.id)
    }
    setBusy(false); cancel(); await reload()
  }

  const makeDefaultExisting = async (loc: DoctorLocation) => {
    setBusy(true); setError(null)
    const r = await setDefaultDoctorLocation(loc.id)
    if (!r.ok) setError(r.error ?? 'No se pudo actualizar.')
    setBusy(false); await reload()
  }

  const doDeactivate = async (loc: DoctorLocation) => {
    setBusy(true); setError(null)
    const r = await deactivateDoctorLocation(loc.id)
    if (!r.ok) setError(r.error ?? 'No se pudo desactivar.')
    setBusy(false); setConfirmOff(null); await reload()
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={heading}>Ubicaciones de entrega</div>
        {!adding && !editing && <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={startAdd}><Icon name="plus" /> Agregar</button>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>Domicilios a los que enviamos tus pedidos. No incluyen datos fiscales.</div>

      {error && <div className="sysnote" style={{ marginTop: 12, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{error}</span></div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 12 }}>Cargando ubicaciones…</div>
      ) : (adding || editing) ? (
        <div style={{ marginTop: 12 }}>
          <LocationForm value={form} onChange={setForm} />
          {adding && active.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Establecer como predeterminada
            </label>
          )}
          {adding && active.length === 0 && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>Será tu ubicación predeterminada (es la primera).</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={cancel} disabled={busy}>Cancelar</button>
            <button className="btn" type="button" onClick={save} disabled={!isLocationValid(form) || busy} style={(!isLocationValid(form) || busy) ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              <Icon name="check" /> {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : active.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}>Aún no tienes ubicaciones de entrega. Agrega la primera.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {active.map((loc) => (
            <div key={loc.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13.5 }}>{loc.name}</b>
                {loc.is_default && <span className="pill" style={{ background: 'var(--ok-bg, #EAF4EC)', color: 'var(--green-deep)' }}>Predeterminada</span>}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>{summarizeLocation(loc)}</div>
              {(loc.contact_name || loc.contact_phone) && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{[loc.contact_name, loc.contact_phone].filter(Boolean).join(' · ')}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {!loc.is_default && <button className="btn ghost sm" type="button" onClick={() => makeDefaultExisting(loc)} disabled={busy}>Establecer predeterminada</button>}
                <button className="btn ghost sm" type="button" onClick={() => startEdit(loc)} disabled={busy}>Editar</button>
                <button className="btn ghost sm" type="button" onClick={() => setConfirmOff(loc)} disabled={busy} style={{ color: 'var(--danger)' }}>Desactivar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmOff && (
        <div className="overlay" onClick={() => setConfirmOff(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="mbody">
              <h3 style={{ marginTop: 0 }}>Desactivar ubicación</h3>
              <p style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
                Se desactivará <b>{confirmOff.name}</b> y dejará de aparecer al crear pedidos.
                {confirmOff.is_default && ' Como era tu predeterminada, quedarás sin predeterminada (no elegimos otra por ti).'}
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={() => setConfirmOff(null)}>Cancelar</button>
                <button className="btn" type="button" onClick={() => doDeactivate(confirmOff)} disabled={busy} style={{ background: 'var(--danger)' }}>Desactivar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
