// CAJAS-MEDIOS · la IA habla en cajas; por dentro, medias cajas.
import { describe, it, expect } from 'vitest'
import { argsAInterno, salidaEnCajas } from '../../../../../supabase/functions/_shared/ia/herramientas.ts'

const ULT = '11111111-1111-4111-8111-111111111111', OTRO = '22222222-2222-4222-8222-222222222222'
const media = new Set([ULT])

describe('IA · cajas con medios', () => {
  it('1 caja = 2 medias; ½ caja = 1; cotizar por línea', () => {
    expect(argsAInterno('agregar_al_carrito', { product_id: ULT, cantidad: 1 }, media)).toEqual({ ok: true, args: { product_id: ULT, cantidad: 2 } })
    expect(argsAInterno('agregar_al_carrito', { product_id: ULT, cantidad: 0.5 }, media)).toEqual({ ok: true, args: { product_id: ULT, cantidad: 1 } })
    expect(argsAInterno('cotizar', { lineas: [{ product_id: ULT, cantidad: 1.5 }, { product_id: OTRO, cantidad: 3 }] }, media))
      .toEqual({ ok: true, args: { lineas: [{ product_id: ULT, cantidad: 3 }, { product_id: OTRO, cantidad: 3 }] } })
  })
  it('un producto por pieza no acepta medios', () => {
    expect(argsAInterno('agregar_al_carrito', { product_id: OTRO, cantidad: 1.5 }, media)).toEqual({ ok: false })
  })
  it('la salida llega en cajas y precio por caja, con la nota de unidad', () => {
    const r = salidaEnCajas({ items: [{ product_id: ULT, cantidad: 3, precio: { unitario: 7500 } }, { product_id: OTRO, cantidad: 3, precio: { unitario: 100 } }] }, media) as { items: Array<Record<string, unknown>> }
    expect(r.items[0]).toMatchObject({ cantidad: 1.5, precio: { unitario: 15000 } })
    expect(r.items[0].unidad_venta).toBeTruthy()
    expect(r.items[1]).toEqual({ product_id: OTRO, cantidad: 3, precio: { unitario: 100 } })
  })
})
