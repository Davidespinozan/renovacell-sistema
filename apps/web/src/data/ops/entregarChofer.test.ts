import { describe, expect, it } from 'vitest'
import { choferSugerido, textoSiguientePaso } from './entregarChofer'

describe('almacén · chofer que ya viene elegido', () => {
  it('con un solo chofer, es ese', () => { expect(choferSugerido([{ id: 'a' }], null)).toBe('a') })
  it('con varios, el último que se eligió, si sigue en la lista', () => {
    expect(choferSugerido([{ id: 'a' }, { id: 'b' }], 'b')).toBe('b')
    expect(choferSugerido([{ id: 'a' }, { id: 'b' }], 'x')).toBe('')
  })
  it('con varios y sin historial no adivina: se elige', () => { expect(choferSugerido([{ id: 'a' }, { id: 'b' }], null)).toBe('') })
  it('sin choferes no hay sugerencia', () => { expect(choferSugerido([], 'a')).toBe('') })
})

describe('almacén · el botón dice el paso que sigue', () => {
  it('según cómo se vendió', () => {
    expect(textoSiguientePaso('recoge')).toBe('Listo para recoger')
    expect(textoSiguientePaso('chofer')).toBe('Entregar al chofer')
    expect(textoSiguientePaso('paqueteria')).toBe('Generar guía')
    expect(textoSiguientePaso(null)).toBe('Asignar envío')
  })
})
