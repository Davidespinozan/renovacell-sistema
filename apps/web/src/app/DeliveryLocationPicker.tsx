// Selector de ubicación de ENTREGA para el checkout del doctor (Fase 2). Encapsula la regla:
//  - 1 activa → se elige sola.  N con default → default preseleccionada.  N sin default → hay
//    que elegir explícitamente (no se elige en silencio).  0 activas → capturar una (y opción a
//    guardarla, siendo la primera puede quedar predeterminada), o usar el domicilio legacy.
// Reporta al padre { address (snapshot), locationId? }. El snapshot es autoritativo: editar la
// ubicación después NO cambia un pedido ya creado (createOrder copia el address).
// En modo mock (sin Supabase) no hay ubicaciones → cae al domicilio legacy / captura (comportamiento previo).
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { AddressPicker } from './AddressPicker'
import { LocationForm, EMPTY_LOCATION, isLocationValid } from './LocationForm'
import { useDoctorLocations } from '../data/hooks/useDoctorLocations'
import { initialLocationSelection, shouldOfferLegacy, summarizeLocation, locationToShippingAddress } from '../data/ops/doctorLocation'
import { formatAddress, isAddressUsable, type ShippingAddress } from '../data/ops/shippingAddress'
import type { LocationFields } from '../data/store/doctorLocationsStore'

export interface DeliveryChoice { address: ShippingAddress | null; locationId?: string }
type Mode = 'existing' | 'legacy' | 'oneoff' | 'new'

function fieldsToShipping(f: LocationFields): ShippingAddress {
  const line1 = [f.line1, f.exterior_number, f.interior_number ? `Int. ${f.interior_number}` : '']
    .map((s) => (s ?? '').toString().trim()).filter(Boolean).join(' ')
  return {
    line1,
    colonia: (f.neighborhood ?? '') || undefined,
    cp: (f.postal_code ?? '') || undefined,
    city: (f.city ?? '') || undefined,
    state: (f.state ?? '') || undefined,
    refs: (f.reference_notes ?? '') || undefined,
    phone: (f.contact_phone ?? '') || undefined,
  }
}

// allowManage=true (default): checkout PROPIO del doctor → puede guardar ubicación y marcar
// predeterminada (RLS lo permite: doctor_id = auth.uid()). allowManage=false: checkout de
// staff/POS "a nombre de" → SOLO leer ubicaciones del doctor, elegir una, o capturar una
// dirección one-off. No crea/edita/desactiva ni cambia default (lo impediría la RLS de todos
// modos; §3: no mezclar administración con checkout POS).
export function DeliveryLocationPicker({ doctorId, legacyBase, onChange, allowManage = true }: {
  doctorId?: string
  legacyBase: ShippingAddress | null
  onChange: (c: DeliveryChoice | null) => void
  allowManage?: boolean
}) {
  const { data, loading, reload, createDoctorLocation, setDefaultDoctorLocation } = useDoctorLocations(doctorId)
  const active = data.filter((l) => l.active)

  const [mode, setMode] = useState<Mode | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [oneoff, setOneoff] = useState<ShippingAddress | null>(null)
  const [form, setForm] = useState<LocationFields>(EMPTY_LOCATION)
  const [makeDefault, setMakeDefault] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inited = useRef(false)

  // Preselección una sola vez, cuando cargan las ubicaciones.
  useEffect(() => {
    if (loading || inited.current) return
    inited.current = true
    const sel = initialLocationSelection(active)
    if (sel.mode === 'auto') { setMode('existing'); setSelectedId(sel.selectedId) }
    else if (sel.mode === 'requires-choice') { setMode(null); setSelectedId(null) }
    else if (shouldOfferLegacy(active, legacyBase)) { setMode('legacy') }
    else { setMode(allowManage ? 'new' : 'oneoff') } // staff sin ubicaciones: dirección one-off
  }, [loading, active, legacyBase, allowManage])

  // Reporta la elección actual al padre (snapshot + id opcional).
  useEffect(() => {
    if (mode === 'existing') {
      const loc = active.find((l) => l.id === selectedId)
      onChange(loc ? { address: locationToShippingAddress(loc), locationId: loc.id } : null)
    } else if (mode === 'legacy') {
      onChange(isAddressUsable(legacyBase) ? { address: legacyBase } : null)
    } else if (mode === 'oneoff') {
      onChange(isAddressUsable(oneoff) ? { address: oneoff } : null)
    } else if (mode === 'new') {
      onChange(isLocationValid(form) ? { address: fieldsToShipping(form) } : null)
    } else {
      onChange(null) // requires-choice sin elegir
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedId, oneoff, form, data])

  const saveNew = async () => {
    if (!isLocationValid(form) || busy) return
    setBusy(true); setError(null)
    const r = await createDoctorLocation(form, doctorId)
    if (!r.ok || !r.id) { setError(r.error ?? 'No se pudo guardar.'); setBusy(false); return }
    if (makeDefault) await setDefaultDoctorLocation(r.id)
    setBusy(false)
    await reload()
    setMode('existing'); setSelectedId(r.id)
  }

  if (loading) return <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Cargando tus ubicaciones…</div>

  // Sin ubicaciones activas: legacy y/o captura de una dirección.
  if (active.length === 0) {
    const captureMode: Mode = allowManage ? 'new' : 'oneoff' // persistible (doctor) vs one-off (staff)
    return (
      <div>
        {error && <div className="sysnote" style={{ marginBottom: 10, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{error}</span></div>}
        {shouldOfferLegacy(active, legacyBase) && (
          <label className="addr-opt" style={optStyle(mode === 'legacy')} onClick={() => setMode('legacy')}>
            <input type="radio" checked={mode === 'legacy'} onChange={() => setMode('legacy')} />
            <span style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: 13 }}>Usar el domicilio registrado</b>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatAddress(legacyBase)}</span>
            </span>
          </label>
        )}
        {shouldOfferLegacy(active, legacyBase) && (
          <label className="addr-opt" style={{ ...optStyle(mode === captureMode), marginTop: 8 }} onClick={() => setMode(captureMode)}>
            <input type="radio" checked={mode === captureMode} onChange={() => setMode(captureMode)} />
            <b style={{ fontSize: 13 }}>{allowManage ? 'Registrar una nueva ubicación' : 'Enviar a otra dirección (solo este pedido)'}</b>
          </label>
        )}
        {mode !== 'legacy' && allowManage && (
          <div style={{ marginTop: 10 }}>
            <LocationForm value={form} onChange={setForm} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Guardar como predeterminada
            </label>
            <button className="btn ghost sm" type="button" onClick={saveNew} disabled={!isLocationValid(form) || busy} style={{ marginTop: 10, ...((!isLocationValid(form) || busy) ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}>
              <Icon name="check" /> {busy ? 'Guardando…' : 'Guardar esta ubicación'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Puedes guardarla para reutilizarla, o continuar y usarla solo en este pedido.</div>
          </div>
        )}
        {mode !== 'legacy' && !allowManage && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Dirección de entrega de este pedido (no se guarda en el perfil del doctor):</div>
            <AddressPicker base={null} value={oneoff} onChange={setOneoff} />
          </div>
        )}
      </div>
    )
  }

  // Con ubicaciones activas: selector.
  const needsChoice = mode === null
  return (
    <div>
      {error && <div className="sysnote" style={{ marginBottom: 10, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{error}</span></div>}
      {needsChoice && <div style={{ fontSize: 12.5, color: 'var(--warn)', marginBottom: 8 }}>Tienes varias ubicaciones y ninguna predeterminada. Elige a dónde enviar este pedido.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {active.map((loc) => {
          const on = mode === 'existing' && selectedId === loc.id
          return (
            <label key={loc.id} className="addr-opt" style={optStyle(on)} onClick={() => { setMode('existing'); setSelectedId(loc.id) }}>
              <input type="radio" checked={on} onChange={() => { setMode('existing'); setSelectedId(loc.id) }} />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontSize: 13 }}>{loc.name} {loc.is_default && <span className="pill" style={{ background: 'var(--ok-bg, #EAF4EC)', color: 'var(--green-deep)', marginLeft: 6 }}>Predeterminada</span>}</b>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{summarizeLocation(loc)}</span>
              </span>
              {on && <Icon name="check" style={{ width: 15, height: 15, color: 'var(--green-deep)' }} />}
            </label>
          )
        })}
        <label className="addr-opt" style={optStyle(mode === 'oneoff')} onClick={() => setMode('oneoff')}>
          <input type="radio" checked={mode === 'oneoff'} onChange={() => setMode('oneoff')} />
          <b style={{ fontSize: 13 }}>Enviar a otra dirección (solo este pedido)</b>
        </label>
      </div>
      {mode === 'oneoff' && (
        <div style={{ marginTop: 10 }}>
          <AddressPicker base={null} value={oneoff} onChange={setOneoff} />
        </div>
      )}
    </div>
  )
}

function optStyle(on: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
    border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 11,
    background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: 'pointer', fontFamily: 'inherit',
  }
}
