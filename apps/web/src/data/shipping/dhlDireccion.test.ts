// DHL · el domicilio capturado (landing o chat) llega completo y dentro de los límites de MyDHL: colonia en la línea 2
// (antes no viajaba), referencias en la 3, cada línea ≤ 45 caracteres (más largo = 422 y no sale la guía).
import { describe, it, expect } from 'vitest'
import { lineasDireccion, postalAddress, buildShipmentRequest } from '../../../../../supabase/functions/shipping/dhl'

describe('Domicilio para la guía DHL', () => {
  it('la colonia viaja (línea 2) y las referencias (línea 3)', () => {
    expect(lineasDireccion({ line1: 'Av. Federalismo 3119-25', colonia: 'Tabachines', refs: 'Entre Obregón y Juárez, portón negro' }))
      .toEqual({ addressLine1: 'Av. Federalismo 3119-25', addressLine2: 'Col. Tabachines', addressLine3: 'Entre Obregón y Juárez, portón negro' })
    expect(lineasDireccion({ line1: 'Calle 5', colonia: 'Colonia Centro' }).addressLine2).toBe('Colonia Centro')   // no duplica "Col."
    expect(lineasDireccion({ line1: 'Calle 5' })).toEqual({ addressLine1: 'Calle 5' })
  })
  it('una calle larga se parte por palabras y nada pasa de 45 caracteres', () => {
    const r = lineasDireccion({ line1: 'Boulevard Doctor Manuel Romero de Terreros número 1234 interior 5', colonia: 'Fraccionamiento Las Quintas Residencial del Valle' })
    expect(r.addressLine1.length).toBeLessThanOrEqual(45); expect(r.addressLine2!.length).toBeLessThanOrEqual(45)
    expect(r.addressLine1).toBe('Boulevard Doctor Manuel Romero de Terreros')
    expect(r.addressLine2!.startsWith('número 1234 interior 5, Col.')).toBe(true)
  })
  it('C.P. solo dígitos, ciudad acotada, teléfono sin espacios ni guiones', () => {
    const p = postalAddress({ line1: 'Calle 1', cp: ' 80 104 ', city: 'Culiacán Rosales', state: 'Sinaloa' })
    expect(p).toMatchObject({ postalCode: '80104', cityName: 'Culiacán Rosales', provinceCode: 'Sinaloa', countryCode: 'MX' })
    const req = buildShipmentRequest({ name: 'Renovacell', addressLine1: 'X', cp: '80000', city: 'Culiacán', state: 'Sinaloa', country: 'MX', phone: '6670000000', email: 'a@b.mx' },
      { name: 'David Espinoza', address: { line1: 'Calle 1', colonia: 'Tabachines', cp: '80104', city: 'Culiacán', phone: '667 255-6669' } },
      { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, pieces: 1 }, '123', 'N', 'S100001')
    expect(req.customerDetails.receiverDetails.contactInformation.phone).toBe('6672556669')
    expect(req.customerDetails.receiverDetails.postalAddress).toMatchObject({ addressLine2: 'Col. Tabachines' })
  })
})
