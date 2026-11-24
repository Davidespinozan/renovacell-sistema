// ENTREGA EN VENTAS · cada venta dice cómo se entrega (mostrador, recoge, local con chofer, foráneo con su paquetería).
import { describe, it, expect } from 'vitest'
import { entregaDeVenta } from './entrega'

const ent = (x: Record<string, unknown>) => ({ shipping_meta: { entrega: { salida: '2026-11-24', llega_desde: '2026-11-25', llega_hasta: '2026-11-25', ...x } } })

describe('entregaDeVenta', () => {
  it('local con chofer y su horario', () => {
    const r = entregaDeVenta(ent({ tipo: 'local', paqueteria: 'chofer', horario: { fecha: '2026-11-24', inicio: '17:00', fin: '17:30' } }), '2026-11-24')
    expect(r.tipo).toBe('local'); expect(r.corto).toBe('Local · chofer'); expect(r.promesa).toBe('Llega hoy entre 17:00 y 17:30')
  })
  it('foráneo con paquetería, también camión, y envíos extra', () => {
    expect(entregaDeVenta(ent({ tipo: 'foraneo', paqueteria: 'dhl' })).corto).toBe('Foráneo · DHL')
    expect(entregaDeVenta(ent({ tipo: 'foraneo', paqueteria: 'tus' })).corto).toBe('Foráneo · Unidos de Sinaloa')
    expect(entregaDeVenta(ent({ tipo: 'foraneo', paqueteria: 'estafeta', extras: [{ paquete: 1 }, { paquete: 2 }] })).corto).toBe('Foráneo · Estafeta +2 envíos')
  })
  it('mostrador y recoge', () => {
    expect(entregaDeVenta(ent({ tipo: 'mostrador' })).corto).toBe('Mostrador')
    expect(entregaDeVenta(ent({ tipo: 'recoge' })).tipo).toBe('recoge')
  })
  it('pedidos viejos sin entrega: method, caja o sin dato', () => {
    expect(entregaDeVenta({ shipping_meta: { method: 'chofer' } }).corto).toBe('Local · chofer')
    expect(entregaDeVenta({ shipping_meta: { method: 'recoge' } }).tipo).toBe('recoge')
    expect(entregaDeVenta({ shipping_meta: { channel: 'pos' }, external_ref: 'POS-AB12' }).tipo).toBe('mostrador')
    expect(entregaDeVenta({ shipping_meta: {} }).tipo).toBe('sin_dato')
  })
})
