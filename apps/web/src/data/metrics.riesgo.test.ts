// Pruebas de "doctores en riesgo": verificados que compraban y dejaron de pedir.
import { describe, it, expect } from 'vitest'
import { doctoresEnRiesgo } from './metrics'
import { mkOrder } from '../test/factories'
import type { Profile } from './types'

const doc = (over: Partial<Profile>): Profile => ({
  id: 'd', email: 'd@x.mx', full_name: 'Dra. X', role_id: 'doctor',
  verified: true, organization: null, meta: {}, price_list_id: null,
  ...over,
} as unknown as Profile)

const NOW = new Date('2026-08-04T00:00:00Z')
const hace = (dias: number) => new Date(NOW.getTime() - dias * 86_400_000).toISOString()

describe('doctoresEnRiesgo', () => {
  it('lista solo a verificados con +N días sin pedir, por urgencia', () => {
    const orders = [
      mkOrder({ id: 'o1', doctor_id: 'a', status: 'paid', total: 1000, created_at: hace(40) }),
      mkOrder({ id: 'o2', doctor_id: 'b', status: 'paid', total: 500, created_at: hace(70) }),
      mkOrder({ id: 'o3', doctor_id: 'c', status: 'paid', total: 800, created_at: hace(5) }), // activo, no entra
    ]
    const doctors = [
      doc({ id: 'a', full_name: 'Dra. A' }),
      doc({ id: 'b', full_name: 'Dr. B' }),
      doc({ id: 'c', full_name: 'Dra. C' }),
    ]
    const r = doctoresEnRiesgo(orders, doctors, { days: 30, now: NOW })
    expect(r.map((x) => x.id)).toEqual(['b', 'a']) // b (70d) antes que a (40d)
    expect(r[0].diasSinPedir).toBe(70)
    expect(r[1].diasSinPedir).toBe(40)
  })

  it('excluye doctores NO verificados aunque tengan pedidos viejos', () => {
    const orders = [mkOrder({ id: 'o1', doctor_id: 'a', status: 'paid', total: 1000, created_at: hace(90) })]
    const r = doctoresEnRiesgo(orders, [doc({ id: 'a', verified: false })], { days: 30, now: NOW })
    expect(r).toHaveLength(0)
  })

  it('toma el ÚLTIMO pedido (no el primero) para medir el hueco', () => {
    const orders = [
      mkOrder({ id: 'o1', doctor_id: 'a', status: 'paid', total: 100, created_at: hace(200) }),
      mkOrder({ id: 'o2', doctor_id: 'a', status: 'paid', total: 100, created_at: hace(10) }), // pidió hace poco
    ]
    const r = doctoresEnRiesgo(orders, [doc({ id: 'a' })], { days: 30, now: NOW })
    expect(r).toHaveLength(0) // su último pedido fue hace 10 días → activo
  })

  it('trae el contacto para llamar', () => {
    const orders = [mkOrder({ id: 'o1', doctor_id: 'a', status: 'paid', total: 100, created_at: hace(50) })]
    const r = doctoresEnRiesgo(orders, [doc({ id: 'a', email: 'a@x.mx', meta: { phone: '6671234567' } })], { days: 30, now: NOW })
    expect(r[0].phone).toBe('6671234567')
    expect(r[0].email).toBe('a@x.mx')
  })
})