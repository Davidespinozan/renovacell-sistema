// MIS VENTAS · la lista debe sumar EXACTAMENTE lo que muestran las cifras de Inicio (misma regla que CifrasVendedor).
import { describe, expect, it } from 'vitest'
import { buscarVentas, filtrarVentas } from './MisVentas'
import type { OrderWithItems } from '../../data/hooks/useOrders'

const p = (id: string, created_at: string, status: string, payment_status: string, total: number) =>
  ({ id, created_at, status, payment_status, total, items: [] }) as unknown as OrderWithItems

const pedidos = [
  p('a', '2026-11-23T17:31:00Z', 'pending_payment', 'pending', 55000),
  p('b', '2026-11-23T17:39:00Z', 'pending_payment', 'pending', 3600),
  p('c', '2026-11-23T17:14:00Z', 'cancelled', 'pending', 16200),   // cancelado: nunca cuenta
  p('d', '2026-11-10T18:00:00Z', 'delivered', 'paid', 9000),
  p('e', '2026-10-20T18:00:00Z', 'pending_payment', 'pending', 1000),   // octubre, por cobrar
  p('f', '2026-11-05T18:00:00Z', 'draft', 'pending', 500),   // borrador: nunca cuenta
]
const suma = (l: OrderWithItems[]) => l.reduce((s, o) => s + Number(o.total), 0)

describe('filtrarVentas', () => {
  it('este mes: vivos del mes del negocio (pagados y por cobrar)', () => {
    const l = filtrarVentas(pedidos, 'mes', '2026-11')
    expect(l.map((o) => o.id).sort()).toEqual(['a', 'b', 'd'])
    expect(suma(l)).toBe(67600)
  })
  it('por cobrar: vivos sin pagar de cualquier mes', () => {
    const l = filtrarVentas(pedidos, 'cobrar', '2026-11')
    expect(l.map((o) => o.id).sort()).toEqual(['a', 'b', 'e'])
    expect(suma(l)).toBe(59600)
  })
  it('todos: sin cancelados ni borradores', () => {
    expect(filtrarVentas(pedidos, 'todos', '2026-11').map((o) => o.id).sort()).toEqual(['a', 'b', 'd', 'e'])
  })
})

describe('buscarVentas', () => {
  const lista = [
    { id: 'a', external_ref: 'S700101', doctor_id: null, shipping_meta: { customer: { name: 'ROCÍO UGALDE PEDROZA' } } },
    { id: 'b', external_ref: 'S700102', doctor_id: null, shipping_meta: { customer: { name: 'Jorge Beltrán' } } },
  ] as never[]
  const ids = (t: string) => buscarVentas(lista, t).map((o: { id: string }) => o.id)
  it('encuentra por cliente sin importar acentos ni mayúsculas', () => {
    expect(ids('rocio')).toEqual(['a'])
    expect(ids('BELTRAN')).toEqual(['b'])
  })
  it('encuentra por folio, completo o por un pedazo', () => {
    expect(ids('S700102')).toEqual(['b'])
    expect(ids('7001')).toEqual(['a', 'b'])
  })
  it('sin texto devuelve todo; sin coincidencias, nada', () => {
    expect(ids('  ')).toEqual(['a', 'b'])
    expect(ids('zzz')).toEqual([])
  })
})
