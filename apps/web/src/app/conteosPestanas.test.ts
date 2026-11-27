import { describe, expect, it } from 'vitest'
import { contarPedidos, pestanaConTrabajo } from './conteosPestanas'

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const o = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, payment_status: 'paid', created_at: `${HOY}T10:00:00Z`, items: [], shipping_meta: extra }) as never
const s = (id: string, order_id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, order_id, status, created_at: `${HOY}T11:00:00Z`, incident: null, ...extra }) as never

describe('pestañas de Pedidos · cuántos hay en cada una', () => {
  it('cuenta con las reglas de cada pantalla', () => {
    const orders = [o('a', 'paid'), o('b', 'paid'), o('c', 'packed'), o('d', 'packed'), o('e', 'shipped', { method: 'recoge' }), o('f', 'delivered')]
    const envios = [s('1', 'd', 'por_despachar'), s('2', 'x', 'out_for_delivery', { incident: { type: 'Cliente ausente', resolved: false } }), s('3', 'y', 'delivered', { incident: { type: 'Otro', resolved: false } })]
    expect(contarPedidos(orders, () => true, envios)).toEqual({ surtido: 2, cola: 2, despacho: 1, para_recoger: 1, seguimiento: 1 })
  })
  it('lo que no está liberado no cuenta para preparar', () => {
    expect(contarPedidos([o('a', 'paid'), o('b', 'paid')], (x: { id: string }) => x.id === 'a', []).surtido).toBe(1)
  })
})

describe('pestañas · con cuál abrir', () => {
  const claves = ['surtido', 'cola', 'guia', 'despacho']
  it('sin historial abre en la primera que tiene trabajo', () => {
    expect(pestanaConTrabajo(claves, null, { surtido: 0, cola: 3, despacho: 1 })).toBe('cola')
  })
  it('respeta la última usada si tiene trabajo', () => {
    expect(pestanaConTrabajo(claves, 'despacho', { surtido: 2, cola: 3, despacho: 1 })).toBe('despacho')
  })
  it('si la última usada es de trabajo y quedó vacía, pasa a la que sí tiene', () => {
    expect(pestanaConTrabajo(claves, 'surtido', { surtido: 0, cola: 3, despacho: 1 })).toBe('cola')
  })
  it('una pestaña de consulta (sin número) nunca se cambia', () => {
    expect(pestanaConTrabajo(claves, 'guia', { surtido: 5, cola: 3, despacho: 1 })).toBe('guia')
  })
  it('sin trabajo en ninguna se queda donde estaba', () => {
    expect(pestanaConTrabajo(claves, 'surtido', { surtido: 0, cola: 0, despacho: 0 })).toBe('surtido')
    expect(pestanaConTrabajo(claves, null, { surtido: 0, cola: 0, despacho: 0 })).toBeNull()
  })
})
