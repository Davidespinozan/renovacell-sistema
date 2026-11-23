// CÉDULA ÚNICA · una sola regla (solo números, 5 a 8 dígitos, guardada limpia) en todas las puertas.
import { describe, expect, it } from 'vitest'
import { cedulaCanonica } from '../../../../../supabase/functions/_shared/cedula'
import { validarVerificarme, limpiarPrerregistro } from '../../../../../supabase/functions/_shared/visitante'
import { validarCompletar } from '../../../../../supabase/functions/_shared/verificacion'

describe('Cédula única', () => {
  it('canónica: solo dígitos, 5 a 8', () => {
    expect(cedulaCanonica(' 12.345.678 ')).toBe('12345678')
    expect(cedulaCanonica('123456')).toBe('123456')     // antigua
    expect(cedulaCanonica('1234')).toBeNull()
    expect(cedulaCanonica('123456789')).toBeNull()
  })
  it('las puertas del chat y del portal aplican la misma regla y guardan limpio', () => {
    expect(validarVerificarme({ cedula: '12 345 678', password: 'secreto123' })).toMatchObject({ ok: true, cedula: '12345678' })
    expect(validarVerificarme({ cedula: '123456789', password: 'secreto123' })).toMatchObject({ ok: false, campo: 'cedula' })
    expect(validarCompletar({ cedula: '123 456' })).toMatchObject({ ok: true, cedula: '123456' })
    expect(validarCompletar({ cedula: '1234' })).toMatchObject({ ok: false })
    const pre = limpiarPrerregistro({ nombre: 'Ana López', telefono: '6671234567', email: 'ana@x.mx', es_medico: true, cedula: '12-345-678', consent: true })
    expect(pre).toMatchObject({ ok: true, datos: { cedula: '12345678' } })
  })
})
