// CC-5 · Lógica pura compartida con la Edge `cart` y cliente del carrito: cantidades estrictas,
// operation_id seguro, errores mapeados; el cliente nunca manda autoridad.
import { describe, it, expect } from 'vitest'
import { validarCantidad, validarOperacion, mapearErrorCarrito, MAX_CANTIDAD } from '../../../../../supabase/functions/_shared/carrito'
import { ClienteCarrito, nuevaOperacion, formatoMXN } from './carrito'

describe('cantidad y operación', () => {
  it('K · entero 1..999; 0 solo al actualizar; NaN/decimal/negativo/infinito/texto ambiguo → null', () => {
    expect(validarCantidad(1)).toBe(1); expect(validarCantidad('12')).toBe(12); expect(validarCantidad(MAX_CANTIDAD)).toBe(999)
    for (const v of [0, -1, 1.5, NaN, Infinity, 1000, '1.5', '-2', 'dos', '', null, undefined, {}, true]) expect(validarCantidad(v), String(v)).toBeNull()
    expect(validarCantidad(0, true)).toBe(0); expect(validarCantidad('0', true)).toBe(0)
  })
  it('L · operation_id corto y seguro', () => {
    expect(validarOperacion('k:123e4567-e89b')).toBe('k:123e4567-e89b'); expect(validarOperacion('t1:tu_1')).toBe('t1:tu_1')
    for (const v of ['', 'x'.repeat(121), 'con espacios', 'a;b', 42, null]) expect(validarOperacion(v)).toBeNull()
    expect(nuevaOperacion()).toMatch(/^k:/); expect(nuevaOperacion()).not.toBe(nuevaOperacion())
  })
  it('errores de la base → HTTP controlado; desconocidos → null (cae al mapa de CC-2)', () => {
    expect(mapearErrorCarrito('CARRITO_CERRADO: merged')).toMatchObject({ status: 409, body: { error: 'carrito_cerrado' } })
    expect(mapearErrorCarrito('IDEMPOTENCIA_CONFLICTO')).toMatchObject({ status: 409 })
    expect(mapearErrorCarrito('PRODUCTO_NO_DISPONIBLE')).toMatchObject({ status: 404 })
    expect(mapearErrorCarrito('NO_AUTORIZADO')).toBeNull()
    expect(mapearErrorCarrito('No autorizado')).toMatchObject({ status: 403 }); expect(mapearErrorCarrito('OPERACION_INVALIDA')).toMatchObject({ status: 400 }); expect(mapearErrorCarrito('FALLO_INYECTADO: x')).toMatchObject({ status: 503 })
  })
})

describe('ClienteCarrito', () => {
  it('manda action + token + operation_id; nunca precio/descuento/lista/profile/seller/visitor_id', async () => {
    const cuerpos: Record<string, unknown>[] = []
    const c = new ClienteCarrito(async (_fn, opts) => { cuerpos.push(opts.body); return { data: { cart_id: 'c' }, error: null } }, () => 'tok')
    await c.abrir('conv-1'); await c.agregar('c', 'p', 2); await c.actualizar('c', 'p', 3); await c.quitar('c', 'p'); await c.vaciar('c'); await c.prepararCheckout('c'); await c.revisarCheckout('c', 'loc'); await c.confirmarCheckout('rev', 4, 'k:op')
    expect(cuerpos.map((b) => b.action)).toEqual(['abrir', 'agregar', 'actualizar', 'quitar', 'vaciar', 'preparar_checkout', 'revisar_checkout', 'confirmar_checkout'])   // CC-7 · sin "oferta"
    expect(cuerpos[7]).toEqual({ action: 'confirmar_checkout', review_id: 'rev', operation_id: 'k:op', expected_cart_rev: 4, factura: false, token: 'tok' })   // CHK8–13: nada más viaja (CC-7: + intención de factura)
    expect(cuerpos[6]).toEqual({ action: 'revisar_checkout', cart_id: 'c', location_id: 'loc', direccion: null, token: 'tok' })   // con location no viaja snapshot
    for (const b of cuerpos) { expect(b.token).toBe('tok'); expect(JSON.stringify(b)).not.toMatch(/price|precio|total|discount|descuento|price_list|profile_id|doctor|customer|seller|visitor_id/) }
    expect(cuerpos[1]).toMatchObject({ cart_id: 'c', product_id: 'p', cantidad: 2 }); expect(String(cuerpos[1].operation_id)).toMatch(/^k:/)
  })
  it('CC-7 · revisar sin location manda el snapshot de dirección del Catálogo; confirmar manda la intención de factura (nunca datos fiscales)', async () => {
    const cuerpos: Record<string, unknown>[] = []
    const c = new ClienteCarrito(async (_fn, opts) => { cuerpos.push(opts.body); return { data: {}, error: null } }, () => null)
    await c.revisarCheckout('c', null, { line1: 'Calle 5 #20', cp: '82010', city: 'Mazatlán' }); await c.confirmarCheckout('rev', 2, 'k:x', true)
    expect(cuerpos[0]).toMatchObject({ action: 'revisar_checkout', location_id: null, direccion: { line1: 'Calle 5 #20', cp: '82010', city: 'Mazatlán' } })
    expect(cuerpos[1]).toMatchObject({ action: 'confirmar_checkout', factura: true })
    expect(JSON.stringify(cuerpos)).not.toMatch(/rfc|regimen|precio|total|seller|profile_id/)
  })
  it('errores de la Edge → código y mensaje; formato MXN', async () => {
    const c = new ClienteCarrito(async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'carrito_cerrado', message: 'Cerrado.' })) } }), () => null)
    expect(await c.ver('c')).toEqual({ ok: false, error: { codigo: 'carrito_cerrado', mensaje: 'Cerrado.' } })
    expect(formatoMXN(1234.5)).toMatch(/1,234\.50/)
  })
})
