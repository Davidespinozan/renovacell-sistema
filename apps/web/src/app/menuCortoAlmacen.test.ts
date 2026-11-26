// MENÚ CORTO DE ALMACÉN (26 nov 2026, auditoría de UX; Alberto: «demasiadas opciones en el menú lateral»).
// De 20 entradas a 6 a la vista + 4 en «Más»; nada se pierde: las pantallas de siempre son pestañas y siguen alcanzables.
import { describe, it, expect } from 'vitest'
import { getNav, getRole, resolverDestino, pantallasAlcanzables, SECCION_MAS } from './roles'
import { BARRA_POR_ROL } from './BottomNav'

const nav = (rol: string, caps: string[]) => getNav(getRole(rol as never), undefined, caps)
const ALBERTO = ['anuncios', 'contenido', 'eventos', 'diseno', 'stryv_care']

describe('menú corto de Almacén', () => {
  it('Alberto: 3 del equipo + Pedidos, Inventario, Entradas; lo ocasional en «Más»', () => {
    const n = nav('warehouse', ALBERTO)
    expect(n.map((x) => x.key)).toEqual(['inicio', 'comun', 'chat', 'g_pedidos', 'g_inv_alm', 'g_ent_alm', 'g_promo_alm', 'g_catsitio', 'g_eventos', 'g_diseno'])
    expect(n.filter((x) => x.section === 'Almacén').map((x) => x.label)).toEqual(['Pedidos', 'Inventario', 'Entradas'])
    expect(n.filter((x) => x.section === SECCION_MAS).map((x) => x.label)).toEqual(['Promociones', 'Catálogo y sitio', 'Eventos', 'Diseño'])
  })
  it('todo lo que tenía en el menú sigue alcanzable y abre su pestaña', () => {
    const n = nav('warehouse', ALBERTO); const alc = pantallasAlcanzables(n)
    for (const k of ['stock', 'caduc', 'devoluciones', 'consigna_alm', 'entradas', 'compras', 'carga_inventario', 'av_promociones', 'plantillas_wa', 'av_catalogo', 'av_sitio', 'eventos', 'caja', 'vev', 'dis_solicitudes', 'dis_calendario', 'surtido', 'guia', 'seguimiento']) expect(alc.has(k), k).toBe(true)
    expect(resolverDestino(n, 'entradas')).toEqual({ screen: 'g_ent_alm', pestana: 'entradas' })
    expect(resolverDestino(n, 'caduc')).toEqual({ screen: 'g_inv_alm', pestana: 'caduc' })
    expect(resolverDestino(n, 'plantillas_wa')).toEqual({ screen: 'g_promo_alm', pestana: 'plantillas_wa' })
    expect(resolverDestino(n, 'caja')).toEqual({ screen: 'g_eventos', pestana: 'caja' })
  })
  it('sin responsabilidades extra no hay «Más» (ninguna sección de una sola opción)', () => {
    const n = nav('warehouse', [])
    expect(n.some((x) => x.section === SECCION_MAS)).toBe(false)
    expect(n.filter((x) => x.section === 'Almacén').map((x) => x.label)).toEqual(['Pedidos', 'Inventario', 'Entradas', 'Promociones'])
  })
  it('Blanca: Pedidos e Inventario (Existencias · Por caducar); no gana pantallas de Alberto', () => {
    const n = nav('packing', []); const alc = pantallasAlcanzables(n)
    expect(n.map((x) => x.key)).toEqual(['inicio', 'comun', 'chat', 'g_pedidos_aux', 'g_inv_aux'])
    expect(resolverDestino(n, 'caduc')).toEqual({ screen: 'g_inv_aux', pestana: 'caduc' })
    for (const k of ['entradas', 'devoluciones', 'consigna_alm', 'guia', 'seguimiento', 'compras']) expect(alc.has(k), k).toBe(false)
  })
  it('la barra del celular apunta a entradas que existen', () => {
    for (const [rol, caps] of [['warehouse', ALBERTO], ['packing', []]] as const) {
      const keys = new Set(nav(rol, [...caps]).map((x) => x.key))
      for (const k of BARRA_POR_ROL[rol]) expect(keys.has(k), `${rol}:${k}`).toBe(true)
    }
  })
})
