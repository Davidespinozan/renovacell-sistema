// MENÚ SIN DUPLICADOS (26 nov 2026, auditoría de UX). Una capacidad no repite lo que el rol ya tiene dentro de un grupo;
// Diseño de Dirección es UNA entrada; y la lista de pestañas declarada (SUBPANTALLAS) es EXACTAMENTE la que la pantalla
// muestra (antes faltaban «Clasificar», «Pendientes» y «Horarios»: el buscador y los avisos no llegaban a ellas).
import { describe, it, expect } from 'vitest'
import { getNav, getRole, SUBPANTALLAS, resolverDestino } from './roles'
import registro from '../screens/registry.tsx?raw'

const nav = (rol: string, caps: string[]) => getNav(getRole(rol as never), undefined, caps)

describe('menú sin duplicados', () => {
  it('Dirección con todas las capacidades: ninguna etiqueta repetida, 7 secciones, Diseño en una entrada', () => {
    const n = nav('admin', ['diseno', 'eventos', 'anuncios', 'conversaciones', 'nuevos_clientes', 'contenido', 'dueno'])
    const etiquetas = n.map((x) => x.label)
    expect(new Set(etiquetas).size).toBe(etiquetas.length)
    expect(n).toHaveLength(19)
    expect(new Set(n.map((x) => x.section ?? 'hub')).size).toBe(7)
    expect(n.filter((x) => x.section === 'Catálogo y web').map((x) => x.key)).toEqual(['g_catalogo', 'av_sitio', 'g_diseno'])
    for (const k of ['asesorias', 'av_catalogo', 'eventos', 'vev', 'dis_solicitudes', 'dis_calendario']) expect(n.some((x) => x.key === k)).toBe(false)
  })
  it('lo que salió del menú sigue alcanzable como pestaña (avisos y enlaces profundos)', () => {
    const n = nav('admin', ['diseno', 'eventos', 'conversaciones', 'contenido'])
    expect(resolverDestino(n, 'asesorias')).toEqual({ screen: 'g_conversaciones', pestana: 'asesorias' })
    expect(resolverDestino(n, 'vev')).toEqual({ screen: 'g_inventario', pestana: 'vev' })
    expect(resolverDestino(n, 'dis_calendario')).toEqual({ screen: 'g_diseno', pestana: 'dis_calendario' })
    expect(resolverDestino(n, 'av_clasificar')).toEqual({ screen: 'g_clientes', pestana: 'av_clasificar' })
    expect(resolverDestino(n, 'seguimientos')).toEqual({ screen: 'g_conversaciones', pestana: 'seguimientos' })
    expect(resolverDestino(n, 'agenda_entregas')).toEqual({ screen: 'g_envios', pestana: 'agenda_entregas' })
  })
  it('Dirección sin la capacidad Diseño no ve la entrada; los demás roles no cambian', () => {
    expect(nav('admin', []).some((x) => x.key === 'g_diseno')).toBe(false)
    expect(nav('warehouse', ['diseno', 'eventos', 'contenido']).map((x) => x.key)).toEqual(expect.arrayContaining(['dis_solicitudes', 'dis_calendario', 'eventos', 'vev', 'av_catalogo']))
    expect(nav('pos', ['conversaciones', 'eventos']).map((x) => x.key)).toEqual(expect.arrayContaining(['asesorias', 'seguimientos', 'eventos', 'vev']))
  })
  it('SUBPANTALLAS = pestañas reales de cada grupo en el registro', () => {
    for (const [grupo, declaradas] of Object.entries(SUBPANTALLAS)) {
      const m = new RegExp(`\\n  ${grupo}: \\(\\) => <Pestanas grupo="${grupo}" pestanas=\\{\\[(.*?)\\]\\} />`, 's').exec(registro)
      expect(m, `grupo ${grupo} en el registro`).toBeTruthy()
      const reales = [...m![1].matchAll(/\{ key: '([a-z_0-9]+)', label: '([^']+)'/g)].map((x) => ({ key: x[1], label: x[2] }))
      expect(reales, `pestañas de ${grupo}`).toEqual(declaradas)
    }
  })
})
