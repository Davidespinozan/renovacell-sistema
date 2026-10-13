import { describe, it, expect } from 'vitest'
import { cpSugerido, faltantesEntrega, receptorParaGuia, telefonoValido, cpValido } from './entregaGuia'
import { validateReceiver } from './validate'
import type { Receiver } from './model'

// Caso real S100001: domicilio capturado como texto libre.
const S100001: Receiver = { name: 'david espinoza', address: { line1: 'avenida federalismo 3119-25', city: 'tabachines, 80104, culiacan, sinaloa', phone: '—' } }
const COMPLETO: Receiver = { name: 'Clínica', address: { line1: 'Calle 1', cp: '80000', city: 'Culiacán', phone: '667 123 4567' } }

describe('entrega para la guía', () => {
  it('detecta lo que falta: C.P. no estructurado y teléfono "—"', () => {
    expect(faltantesEntrega(S100001)).toEqual({ cp: true, phone: true })
    expect(faltantesEntrega(COMPLETO)).toEqual({ cp: false, phone: false })
    expect(telefonoValido('—')).toBe(false); expect(telefonoValido('s/n')).toBe(false); expect(telefonoValido('+52 667 123 4567')).toBe(true)
    expect(cpValido('8010')).toBe(false); expect(cpValido(' 80104 ')).toBe(true)
  })
  it('sugiere el C.P. escrito en el domicilio solo si hay uno; nunca lo aplica solo', () => {
    expect(cpSugerido(S100001)).toBe('80104')
    expect(cpSugerido({ ...S100001, address: { ...S100001.address, city: 'entre 80104 y 80197' } })).toBeNull()
    expect(cpSugerido({ ...S100001, address: { ...S100001.address, city: 'culiacan', line1: 'av 3119-25 tel 6671234567' } })).toBeNull()
    const sinConfirmar = receptorParaGuia(S100001, { cp: '', phone: '' })
    expect(sinConfirmar.address.cp).toBe(''); expect(sinConfirmar.address.phone).toBe('')
    expect(validateReceiver(sinConfirmar)).toEqual(['código postal (CP) de entrega', 'teléfono de entrega'])
  })
  it('con lo capturado en empaque la guía ya se puede cotizar, sin tocar el resto del domicilio', () => {
    const r = receptorParaGuia(S100001, { cp: '80104', phone: '667 123 4567' })
    expect(validateReceiver(r)).toEqual([])
    expect(r.address).toMatchObject({ line1: S100001.address.line1, city: S100001.address.city, cp: '80104', phone: '667 123 4567' })
    expect(S100001.address.cp).toBeUndefined()
  })
  it('valores inválidos no pasan; un pedido completo ignora lo capturado', () => {
    expect(validateReceiver(receptorParaGuia(S100001, { cp: '8010', phone: '12345' }))).toEqual(['código postal (CP) de entrega', 'teléfono de entrega'])
    const r = receptorParaGuia(COMPLETO, { cp: '99999', phone: '0000000000' })
    expect(r.address.cp).toBe('80000'); expect(r.address.phone).toBe('667 123 4567')
  })
})
