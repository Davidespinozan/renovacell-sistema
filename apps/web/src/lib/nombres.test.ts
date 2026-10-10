// CHV2-B.1 · Presentación de nombres: solo visual, sin tocar el dato.
import { describe, it, expect } from 'vitest'
import { capitalizarNombre, nombrePersona, primerNombre, saludo, saludoPorHora, horaNegocio, esNombreTecnico } from './nombres'

// Instantes fijos (zona del negocio America/Mazatlan = UTC−7): la bienvenida depende de la hora.
const MANANA = new Date('2026-10-10T16:00:00Z')  // 09:00
const TARDE = new Date('2026-10-10T22:00:00Z')   // 15:00
const NOCHE = new Date('2026-10-11T04:00:00Z')   // 21:00

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
    expect(saludo('almacen', MANANA)).toBe('Buenos días')
    expect(nombrePersona('almacen')).toBeNull()
  })
  it('saludo natural con el primer nombre, sin títulos ni sufijo de rol', () => {
    expect(saludo('Dra. Ana Ruiz', MANANA)).toBe('Buenos días, Ana')
    expect(saludo('Lucía Hernández · Ventas', TARDE)).toBe('Buenas tardes, Lucía')
    expect(saludo('david espinoza', NOCHE)).toBe('Buenas noches, David')
    expect(primerNombre('Alberto Gutiérrez')).toBe('Alberto')
    expect(saludo(null, TARDE)).toBe('Buenas tardes')
    // La hora es la del NEGOCIO, no la del dispositivo; y los tramos son 5–11, 12–18 y 19–4.
    expect([horaNegocio(MANANA), horaNegocio(TARDE), horaNegocio(NOCHE)]).toEqual([9, 15, 21])
    expect([4, 5, 11, 12, 18, 19, 0].map(saludoPorHora)).toEqual(['Buenas noches', 'Buenos días', 'Buenos días', 'Buenas tardes', 'Buenas tardes', 'Buenas noches', 'Buenas noches'])
  })
})
