// CHV2-B.1 · Presentación de nombres: solo visual, sin tocar el dato.
import { describe, it, expect } from 'vitest'
import { capitalizarNombre, nombrePersona, primerNombre, saludo, esNombreTecnico } from './nombres'

describe('nombres', () => {
  it('minúsculas/mayúsculas → mayúscula inicial; mixtas se respetan; partículas en minúscula', () => {
    expect(capitalizarNombre('david espinoza')).toBe('David Espinoza')
    expect(capitalizarNombre('MARÍA DE LA LUZ PÉREZ')).toBe('María de la Luz Pérez')
    expect(capitalizarNombre('McDonald Ruiz')).toBe('McDonald Ruiz')
    expect(capitalizarNombre('ana-sofía ruiz')).toBe('Ana-Sofía Ruiz')
    expect(capitalizarNombre('correo@renovacell.mx')).toBe('correo@renovacell.mx')
  })
  it('cuentas técnicas o de rol no se saludan como personas', () => {
    for (const n of ['almacen', 'almacén', 'ventas1', 'admin', 'chofer2@renovacell.mx', 'user_01']) expect(esNombreTecnico(n)).toBe(true)
    expect(saludo('almacen')).toBe('Hola')
    expect(nombrePersona('almacen')).toBeNull()
  })
  it('saludo natural con el primer nombre, sin títulos ni sufijo de rol', () => {
    expect(saludo('Dra. Ana Ruiz')).toBe('Hola, Ana')
    expect(saludo('Lucía Hernández · Ventas')).toBe('Hola, Lucía')
    expect(saludo('david espinoza')).toBe('Hola, David')
    expect(primerNombre('Alberto Gutiérrez')).toBe('Alberto')
    expect(saludo(null)).toBe('Hola')
  })
})
