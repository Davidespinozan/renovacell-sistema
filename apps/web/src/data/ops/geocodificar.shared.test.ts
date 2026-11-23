// DESTINO EN EL MAPA · búsquedas a OpenStreetMap a partir de la dirección del pedido (sin nombre ni teléfono).
import { describe, expect, it } from 'vitest'
import { calleYNumero, consultasOsm, elegirPunto } from '../../../../../supabase/functions/_shared/geocodificar'

describe('geocodificar destino', () => {
  it('calle y número sin las notas de entrega', () => {
    expect(calleYNumero('Heróico colegio militar 415 Entrega en una tienda de abarrotes')).toBe('Heróico colegio militar 415')
    expect(calleYNumero('JUAN JOSE RIOS 879')).toBe('JUAN JOSE RIOS 879')
    expect(calleYNumero('Av. Obregón #1200-B int 3')).toBe('Av. Obregón 1200')
    expect(calleYNumero('Calle sin número')).toBe('Calle sin número')
  })
  it('de la más precisa a la más gruesa; solo dirección', () => {
    const c = consultasOsm({ line1: 'JUAN JOSE RIOS 879', colonia: 'JORGE ALMADA', cp: '80200', city: 'Culiacán', state: 'Sinaloa' })
    expect(c.map((x) => x.precision)).toEqual(['calle', 'colonia', 'cp'])
    expect(c[0].params).toMatchObject({ street: 'JUAN JOSE RIOS 879', city: 'Culiacán', postalcode: '80200', countrycodes: 'mx' })
    expect(c[1].params.q).toBe('JORGE ALMADA, 80200, Culiacán, Sinaloa, México')
    expect(JSON.stringify(c)).not.toMatch(/phone|tel|name/i)
  })
  it('sin calle ni colonia: solo el CP', () => {
    expect(consultasOsm({ cp: '80000' }).map((x) => x.precision)).toEqual(['cp'])
    expect(consultasOsm({})).toEqual([])
  })
  const dir = { line1: 'JUAN JOSE RIOS 879', colonia: 'JORGE ALMADA', cp: '80200', city: 'Culiacán', state: 'Sinaloa' }
  const [calle, colonia] = consultasOsm(dir)
  it('por calle: acepta el resultado de la misma región postal', () => {
    expect(elegirPunto([{ lat: '24.80', lon: '-107.39', address: { postcode: '80200' } }], calle, dir)).toEqual({ lat: 24.8, lng: -107.39 })
    expect(elegirPunto([{ lat: '24.80', lon: '-107.39' }], calle, dir)).toEqual({ lat: 24.8, lng: -107.39 })
    expect(elegirPunto([{ lat: '20.6', lon: '-103.3', address: { postcode: '44100' } }], calle, dir)).toBeNull()   // otra región
  })
  it('por colonia: OSM debe confirmar la colonia (caso real: calle homónima a 25 km)', () => {
    const lejos = { lat: '24.587', lon: '-107.395', address: { road: 'Calle Jorge Almada Salcido', village: 'Costa Rica', postcode: '80450' } }
    const bien = { lat: '24.79', lon: '-107.40', address: { suburb: 'Jorge Almada', postcode: '80200' } }
    expect(elegirPunto([lejos], colonia, dir)).toBeNull()
    expect(elegirPunto([lejos, bien], colonia, dir)).toEqual({ lat: 24.79, lng: -107.4 })
  })
  it('sin resultados', () => {
    expect(elegirPunto([], calle, dir)).toBeNull()
    expect(elegirPunto({}, calle, dir)).toBeNull()
  })
})
