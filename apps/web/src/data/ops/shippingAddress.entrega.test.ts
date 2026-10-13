// El domicilio de un pedido debe quedar ENTREGABLE al capturarlo (venta o compra): C.P. y teléfono incluidos.
// Así Empaque no tiene que pedir datos que debieron recabarse antes (caso S100001).
import { describe, it, expect } from 'vitest'
import { faltantesDeEntrega, isAddressDeliverable, isAddressUsable, esTelefonoEntregaValido, esCpValido } from './shippingAddress'
import { isLocationValid, EMPTY_LOCATION } from '../../app/LocationForm'

const OK = { line1: 'Av. Federalismo 3119', colonia: 'Tabachines', cp: '80104', city: 'Culiacán', state: 'Sinaloa', phone: '667 123 4567' }

describe('domicilio entregable', () => {
  it('completo ⇒ entregable', () => { expect(isAddressDeliverable(OK)).toBe(true); expect(faltantesDeEntrega(OK)).toEqual([]) })
  it('el domicilio de S100001 (texto libre, teléfono "—") era "usable" pero NO es entregable', () => {
    const a = { line1: 'avenida federalismo 3119-25', city: 'tabachines, 80104, culiacan, sinaloa', phone: '—' }
    expect(isAddressUsable(a)).toBe(true)
    expect(isAddressDeliverable(a)).toBe(false)
    expect(faltantesDeEntrega(a)).toEqual(['código postal de 5 dígitos', 'teléfono de quien recibe (10 dígitos)'])
  })
  it('dice exactamente qué falta', () => {
    expect(faltantesDeEntrega(null)).toHaveLength(4)
    expect(faltantesDeEntrega({ ...OK, cp: '8010' })).toEqual(['código postal de 5 dígitos'])
    expect(faltantesDeEntrega({ ...OK, phone: '12345' })).toEqual(['teléfono de quien recibe (10 dígitos)'])
    expect(faltantesDeEntrega({ ...OK, city: '' })).toEqual(['ciudad'])
  })
  it('formatos de teléfono y C.P.', () => {
    for (const t of ['6671234567', '+52 667 123 4567', '(667) 123-4567']) expect(esTelefonoEntregaValido(t)).toBe(true)
    for (const t of ['', '—', 's/n', '667123', null, undefined]) expect(esTelefonoEntregaValido(t)).toBe(false)
    expect(esCpValido('80104')).toBe(true); for (const c of ['8010', '801045', 'abcde', '', null]) expect(esCpValido(c)).toBe(false)
  })
  it('una ubicación del doctor solo es válida con C.P. de 5 dígitos y teléfono de quien recibe', () => {
    const base = { ...EMPTY_LOCATION, name: 'Clínica', line1: 'Calle 1', postal_code: '80104', city: 'Culiacán', state: 'Sinaloa', country: 'México' }
    expect(isLocationValid({ ...base, contact_phone: '6671234567' })).toBe(true)
    expect(isLocationValid({ ...base, contact_phone: '' })).toBe(false)
    expect(isLocationValid({ ...base, contact_phone: '6671234567', postal_code: '801' })).toBe(false)
  })
})
