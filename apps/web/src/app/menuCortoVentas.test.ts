// MENÚ CORTO DE VENTAS (27 nov 2026, parte 3 de la auditoría del menú; «Mi cartera» llegó a tener 8 entradas).
// De 12 entradas propias a 6; nada se pierde: las pantallas de siempre son pestañas y siguen alcanzables. El menú de
// Dirección y el de Almacén no cambian aunque compartan pantallas con Ventas.
import { describe, it, expect } from 'vitest'
import { getNav, getRole, resolverDestino, pantallasAlcanzables } from './roles'
import { BARRA_POR_ROL } from './BottomNav'

const nav = (rol: string, caps: string[]) => getNav(getRole(rol as never), undefined, caps)
const VENDEDOR = ['conversaciones', 'nuevos_clientes']
const JEFE = ['conversaciones', 'nuevos_clientes', 'jefe_ventas']
const ANTES = ['caja', 'links_pago', 'mis_ventas', 'clientes', 'llamar_hoy', 'seguimientos', 'cartera_plazos', 'crm_embudo', 'productos_clientes', 'consigna', 'difusiones', 'av_promociones', 'asesorias']

describe('menú corto de Ventas', () => {
  it('vendedor: Vender (3) y Mi cartera (Clientes, Seguimiento, Herramientas, Conversaciones)', () => {
    const n = nav('pos', VENDEDOR)
    expect(n.map((x) => x.key)).toEqual(['inicio', 'comun', 'chat', 'caja', 'links_pago', 'mis_ventas', 'clientes', 'g_seg_ven', 'g_herr_ven', 'asesorias'])
    expect(n.filter((x) => x.section === 'Vender').map((x) => x.label)).toEqual(['Punto de venta', 'Cobrar pedidos', 'Mis ventas'])
    expect(n.filter((x) => x.section === 'Mi cartera').map((x) => x.label)).toEqual(['Clientes', 'Seguimiento', 'Herramientas', 'Conversaciones'])
  })
  it('todo lo que tenía en el menú sigue alcanzable y abre su pestaña', () => {
    const n = nav('pos', VENDEDOR)
    const alcanza = pantallasAlcanzables(n)
    for (const k of ANTES) expect(alcanza.has(k), k).toBe(true)
    for (const k of ['llamar_hoy', 'seguimientos', 'cartera_plazos', 'crm_embudo']) expect(resolverDestino(n, k), k).toEqual({ screen: 'g_seg_ven', pestana: k })
    for (const k of ['productos_clientes', 'consigna', 'difusiones', 'av_promociones']) expect(resolverDestino(n, k), k).toEqual({ screen: 'g_herr_ven', pestana: k })
    for (const k of ['caja', 'links_pago', 'mis_ventas', 'clientes', 'asesorias']) expect(resolverDestino(n, k), k).toEqual({ screen: k })
  })
  it('jefe de ventas: «Mi equipo» en una entrada, con Ventas del equipo y Metas y comisiones', () => {
    const n = nav('pos', JEFE)
    expect(n.filter((x) => x.section === 'Mi cartera').map((x) => x.label)).toEqual(['Clientes', 'Seguimiento', 'Herramientas', 'Conversaciones', 'Mi equipo'])
    expect(resolverDestino(n, 'ventas_equipo')).toEqual({ screen: 'g_equipo_ven', pestana: 'ventas_equipo' })
    expect(resolverDestino(n, 'av_comisiones')).toEqual({ screen: 'g_equipo_ven', pestana: 'av_comisiones' })
    expect(nav('pos', VENDEDOR).some((x) => x.key === 'g_equipo_ven')).toBe(false)     // quien no es jefe no gana nada
    expect(pantallasAlcanzables(nav('pos', VENDEDOR)).has('ventas_equipo')).toBe(false)
  })
  it('ninguna sección queda con una sola opción, con o sin responsabilidades extra', () => {
    for (const caps of [[], VENDEDOR, JEFE, [...VENDEDOR, 'eventos']]) {
      const n = nav('pos', caps).filter((x) => x.section && x.section !== 'Hub Renovacell')
      const porSeccion = new Map<string, number>()
      for (const x of n) porSeccion.set(x.section!, (porSeccion.get(x.section!) ?? 0) + 1)
      for (const [seccion, cuantas] of porSeccion) expect(cuantas, `${seccion} con ${caps.join(',') || 'nada'}`).toBeGreaterThan(1)
    }
  })
  it('no gana pantallas de Dirección ni de Almacén', () => {
    const alcanza = pantallasAlcanzables(nav('pos', JEFE))
    for (const k of ['av_ventas', 'av_fin', 'av_pagos', 'av_equipo', 'av_config', 'surtido', 'cola', 'stock', 'entradas', 'plantillas_wa']) expect(alcanza.has(k), k).toBe(false)
  })
  it('Dirección y Almacén siguen abriendo esas pantallas en SUS grupos', () => {
    const d = nav('admin', [])
    expect(resolverDestino(d, 'crm_embudo')).toEqual({ screen: 'g_clientes', pestana: 'crm_embudo' })
    expect(resolverDestino(d, 'difusiones')).toEqual({ screen: 'g_conversaciones', pestana: 'difusiones' })
    expect(resolverDestino(d, 'av_comisiones')).toEqual({ screen: 'g_equipo', pestana: 'av_comisiones' })
    expect(d.some((x) => ['g_seg_ven', 'g_herr_ven', 'g_equipo_ven'].includes(x.key))).toBe(false)
    const a = nav('warehouse', [])
    expect(resolverDestino(a, 'av_promociones')).toEqual({ screen: 'g_promo_alm', pestana: 'av_promociones' })
    expect(a.some((x) => ['g_seg_ven', 'g_herr_ven', 'g_equipo_ven'].includes(x.key))).toBe(false)
  })
  it('la barra del celular apunta a entradas que existen', () => {
    const claves = new Set(nav('pos', VENDEDOR).map((x) => x.key))
    for (const k of BARRA_POR_ROL.pos) expect(claves.has(k), k).toBe(true)
  })
})
