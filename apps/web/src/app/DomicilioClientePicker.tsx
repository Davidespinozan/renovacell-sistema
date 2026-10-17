// ENT-2 · Domicilio de entrega de un CLIENTE COMERCIAL al levantar un pedido: los que ya tiene guardados (Cliente 360),
// otro solo para este pedido, o uno nuevo que se guarda en su expediente (cliente_ubicacion_guardar, con su autoridad:
// Dirección o el vendedor de su cartera). Reporta el snapshot elegido (autoritativo en el pedido) y el id si es guardado.
import React, { useEffect, useState } from 'react'
import { Icon } from './icons'
import { AddressPicker } from './AddressPicker'
import { LocationForm, EMPTY_LOCATION, isLocationValid } from './LocationForm'
import { listLocationsForCustomer, type LocationFields } from '../data/store/doctorLocationsStore'
import { cliente360 as clientePorDefecto } from '../data/ops/customer360'
import { locationToShippingAddress, summarizeLocation, type DoctorLocation } from '../data/ops/doctorLocation'
import { faltantesDeEntrega, isAddressDeliverable, type ShippingAddress } from '../data/ops/shippingAddress'

export interface DomicilioElegido { address: ShippingAddress | null; locationId?: string }
type Modo = 'guardado' | 'otro' | 'nuevo'

const DATOS = ['name', 'line1', 'exterior_number', 'interior_number', 'neighborhood', 'postal_code', 'city', 'state', 'country', 'reference_notes', 'contact_name', 'contact_phone'] as const
const datosDe = (f: LocationFields) => ({ ...Object.fromEntries(DATOS.map((k) => [k, (f as Record<string, unknown>)[k] ?? null])), tipo: 'OTRO' })

export function DomicilioClientePicker({ customerId, onChange, listar = listLocationsForCustomer, cliente = clientePorDefecto }: {
  customerId: string
  onChange: (d: DomicilioElegido | null) => void
  listar?: typeof listLocationsForCustomer
  cliente?: typeof clientePorDefecto
}) {
  const [lista, setLista] = useState<DoctorLocation[] | null>(null)
  const [modo, setModo] = useState<Modo | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [otro, setOtro] = useState<ShippingAddress | null>(null)
  const [form, setForm] = useState<LocationFields>(EMPTY_LOCATION)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = async () => {
    const l = (await listar(customerId)).filter((x) => x.active)
    setLista(l)
    return l
  }
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const l = await cargar()
      if (!vivo) return
      // Preselección: el predeterminado si lo hay; una sola → esa; varias sin predeterminado → se elige a mano.
      const def = l.find((x) => x.is_default) ?? (l.length === 1 ? l[0] : null)
      if (def) { setModo('guardado'); setSel(def.id) } else if (l.length === 0) setModo('otro')
    })()
    return () => { vivo = false }
  }, [customerId])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (modo === 'guardado') {
      const loc = lista?.find((x) => x.id === sel)
      const a = loc ? locationToShippingAddress(loc) : null
      onChange(loc && isAddressDeliverable(a) ? { address: a, locationId: loc.id } : null)
    } else if (modo === 'otro') onChange(isAddressDeliverable(otro) ? { address: otro } : null)
    else onChange(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, sel, otro, lista])

  const guardarNuevo = async () => {
    if (!isLocationValid(form) || guardando) return
    setGuardando(true); setError(null)
    const r = await cliente.guardarDomicilio(customerId, null, datosDe(form), (lista?.length ?? 0) === 0)
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    const l = await cargar()
    const id = (r.data as { id?: string } | null)?.id ?? l[l.length - 1]?.id ?? null
    setModo('guardado'); setSel(id); setForm(EMPTY_LOCATION)
  }

  if (lista === null) return <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Cargando domicilios…</div>
  return (
    <div data-testid="domicilio-cliente">
      {error && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}
      {lista.length > 1 && modo === null && <div style={{ fontSize: 12.5, color: 'var(--warn)', marginBottom: 8 }}>El cliente tiene varios domicilios: elige a cuál se entrega.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {lista.map((loc) => {
          const on = modo === 'guardado' && sel === loc.id
          const a = locationToShippingAddress(loc)
          return (
            <label key={loc.id} className="addr-opt" data-testid={`domicilio-${loc.id}`} style={opt(on)} onClick={() => { setModo('guardado'); setSel(loc.id) }}>
              <input type="radio" checked={on} onChange={() => { setModo('guardado'); setSel(loc.id) }} />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontSize: 13 }}>{loc.name}{loc.is_default && <span className="pill" style={{ background: 'var(--ok-bg, #EAF4EC)', color: 'var(--green-deep)', marginLeft: 6 }}>Principal</span>}</b>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{summarizeLocation(loc)}</span>
                {on && !isAddressDeliverable(a) && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--warn, #b45309)', marginTop: 3 }} data-testid="domicilio-incompleto">Le falta: {faltantesDeEntrega(a).join(', ')}. Complétalo en la ficha del cliente o usa otra dirección.</span>}
              </span>
              {on && <Icon name="check" style={{ width: 15, height: 15, color: 'var(--green-deep)' }} />}
            </label>
          )
        })}
        <label className="addr-opt" style={opt(modo === 'otro')} onClick={() => setModo('otro')} data-testid="domicilio-otro">
          <input type="radio" checked={modo === 'otro'} onChange={() => setModo('otro')} />
          <b style={{ fontSize: 13 }}>Otra dirección (solo este pedido)</b>
        </label>
        <label className="addr-opt" style={opt(modo === 'nuevo')} onClick={() => setModo('nuevo')} data-testid="domicilio-nuevo">
          <input type="radio" checked={modo === 'nuevo'} onChange={() => setModo('nuevo')} />
          <b style={{ fontSize: 13 }}>Agregar un domicilio al cliente</b>
        </label>
      </div>
      {modo === 'otro' && <div style={{ marginTop: 10 }}><AddressPicker base={null} value={otro} onChange={setOtro} /></div>}
      {modo === 'nuevo' && (
        <div style={{ marginTop: 10 }}>
          <LocationForm value={form} onChange={setForm} />
          <button className="btn ghost sm" type="button" onClick={guardarNuevo} disabled={!isLocationValid(form) || guardando} style={{ marginTop: 10, ...((!isLocationValid(form) || guardando) ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }} data-testid="domicilio-guardar">
            <Icon name="check" /> {guardando ? 'Guardando…' : 'Guardar en el cliente y usarlo'}
          </button>
        </div>
      )}
    </div>
  )
}

function opt(on: boolean): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 11, background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }
}
