// Cuentas internas · los pedidos de prueba de una cuenta oculta no entran a metas ni comisiones de Dirección.
import { describe, it, expect } from 'vitest'
import { sinCuentasOcultas } from './comisiones'
import pantalla from '../screens/admin/Comisiones.tsx?raw'

const o = (id: string, sid?: string) => ({ id, shipping_meta: sid ? { seller_profile_id: sid, seller: 'x@y' } : {} })

describe('sinCuentasOcultas', () => {
  it('quita los pedidos cuyo vendedor no está en el equipo visible (cuenta interna)', () => {
    const r = sinCuentasOcultas([o('a', 'roberto'), o('b', 'oculta'), o('c')], new Set(['roberto', 'alejandra']))
    expect(r.map((x) => x.id)).toEqual(['a', 'c'])   // los pedidos sin vendedor siguen (mostrador / autoservicio)
  })
  it('una cuenta interna ve todo (su equipo incluye las internas)', () => {
    expect(sinCuentasOcultas([o('b', 'oculta')], new Set(['oculta'])).length).toBe(1)
  })
  it('mientras el equipo no carga no esconde nada a ciegas', () => {
    expect(sinCuentasOcultas([o('b', 'oculta')], new Set()).length).toBe(1)
  })
  it('la pantalla de Metas y comisiones lo aplica a pedidos y cobros', () => {
    expect(pantalla).toMatch(/sinCuentasOcultas\(orders, new Set\(team\.map/)
    expect(pantalla).toMatch(/orders: pedidos,/)
  })
})
