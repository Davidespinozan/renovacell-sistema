// ENSAYO GO-LIVE (29 oct 2026) · lo que el recorrido real encontró desconectado: la estimada del chofer salía de
// "ahora + 2 días" (no de la promesa al cliente) y el chofer/Seguimiento mostraban "Doctor" en pedidos sin portal.
import { describe, expect, it } from 'vitest'
import { entregaDelPedido, estimadaDe } from './entrega'
import { clienteDePedido } from '../mock/profiles'

describe('estimadaDe · la estimada sale de la promesa', () => {
  it('entrega local con horario: fin de la ventana, hora del negocio (UTC-7)', () => {
    expect(estimadaDe({ llega_hasta: '2026-10-29', horario: { fecha: '2026-10-29', inicio: '10:30', fin: '11:00' } })).toBe('2026-10-29T18:00:00.000Z')
  })
  it('sin horario: el último día prometido a las 18:00', () => {
    expect(estimadaDe({ llega_hasta: '2026-11-03' })).toBe('2026-11-04T01:00:00.000Z')
  })
  it('sin promesa o con fecha rota: null (quien llama decide el respaldo)', () => {
    expect(estimadaDe(null)).toBeNull()
    expect(estimadaDe({ llega_hasta: 'mañana' })).toBeNull()
  })
  it('entregaDelPedido lee shipping_meta.entrega y tolera basura', () => {
    expect(entregaDelPedido({ entrega: { llega_hasta: '2026-10-30' } })?.llega_hasta).toBe('2026-10-30')
    expect(entregaDelPedido(null)).toBeNull()
    expect(entregaDelPedido('x')).toBeNull()
  })
})

describe('clienteDePedido · el nombre guardado en el pedido manda', () => {
  it('cliente sin portal (cartera Odoo): su nombre y teléfono, no "Doctor"', () => {
    const c = clienteDePedido({ doctor_id: null, shipping_meta: { customer: { id: 'c1', name: 'Dr. Jorge Prueba', phone: '6679876543' } } })
    expect(c.name).toBe('Dr. Jorge Prueba')
    expect(c.phone).toBe('6679876543')
    expect(c.clinic).toBe('')
  })
  it('sin snapshot: cae al perfil del doctor como antes', () => {
    expect(clienteDePedido({ doctor_id: null, shipping_meta: {} }).name).toBeTruthy()
  })
})
