// Navegación por rol y detalles de estatus/pills (cierre de cobertura).
import { describe, it, expect } from 'vitest'
import { getRole, getNav, resolverDestino } from './roles'
import { statusView } from '../screens/doctor/orderStatus'

describe('getNav — contenido por rol', () => {
  it('Almacén incluye existencias y surtido', () => {
    const keys = getNav(getRole('warehouse')).map((s) => s.key)
    expect(keys).toContain('g_inv_alm')   // MENÚ CORTO (26 nov 2026) · Existencias vive en la pestaña de "Inventario"
    expect(resolverDestino(getNav(getRole('warehouse')), 'stock')).toEqual({ screen: 'g_inv_alm', pestana: 'stock' })
    expect(keys).toContain('g_pedidos')   // UX MODERNO · Preparar vive en la pestaña de "Pedidos"
    expect(resolverDestino(getNav(getRole('warehouse')), 'surtido')).toEqual({ screen: 'g_pedidos', pestana: 'surtido' })
    expect(resolverDestino(getNav(getRole('admin')), 'despacho')).toEqual({ screen: 'g_envios', pestana: 'despacho' })   // Dirección sigue en Envíos
  })
  it('el doctor incluye catálogo, mis pedidos e historial', () => {
    const keys = getNav(getRole('doctor')).map((s) => s.key)
    expect(keys).toContain('catalogo')
    expect(keys).toContain('g_pedidosdr')   // MENÚ (17 oct 2026): Mis pedidos = En curso · Historial en una entrada
    expect(resolverDestino(getNav(getRole('doctor')), 'pedidosdr')).toEqual({ screen: 'g_pedidosdr', pestana: 'pedidosdr' })
  })
  it('cada rol tiene navegación no vacía', () => {
    ;(['admin', 'warehouse', 'pos', 'driver', 'doctor'] as const).forEach((k) =>
      expect(getNav(getRole(k)).length).toBeGreaterThan(0))
  })
  it('todas las pantallas de un rol tienen key y label', () => {
    getNav(getRole('admin')).forEach((s) => {
      expect(typeof s.key).toBe('string')
      expect(typeof s.label).toBe('string')
    })
  })
})

describe('statusView — colores (pills)', () => {
  it('pagado es azul', () => { expect(statusView('paid').pill).toBe('p-blue') })
  it('entregado es verde (ok)', () => { expect(statusView('delivered').pill).toBe('p-ok') })
  it('pendiente de pago es de advertencia', () => { expect(statusView('pending_payment').pill).toBe('p-warn') })
  it('borrador es neutro', () => { expect(statusView('draft').pill).toBe('p-neu') })
})

describe('statusView — pasos monótonos del tracking', () => {
  it('el paso crece con el avance', () => {
    expect(statusView('paid').step).toBeGreaterThanOrEqual(statusView('pending_payment').step)
    expect(statusView('shipped').step).toBeGreaterThan(statusView('packed').step)
    expect(statusView('delivered').step).toBeGreaterThan(statusView('shipped').step)
  })
})
