// CANDADO DEL SISTEMA DE DISEÑO (15 nov 2026, portado de STRYV app/ds.test.ts). Renovacell llegó a 52 tamaños de letra,
// 175 colores sueltos y ~2,900 estilos a mano porque nada lo impedía. Esta prueba lo impide en lo ya migrado:
//   · los tokens obligatorios existen en styles/ds.css;
//   · fuera del bloque de tokens de ds.css no hay colores literales;
//   · cada archivo de MIGRADOS no usa colores literales (hex, rgb/rgba), emojis, window.confirm ni alert().
// Para migrar una pantalla: quítale los colores sueltos (usa var(--ds-…)) y agrégala a MIGRADOS. La lista solo crece.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — módulo de node sin tipos en este proyecto (mismo patrón que las otras pruebas que leen CSS)
import { readFileSync } from 'node:fs'
// Se lee del disco (en las pruebas, un .css importado llega vacío y el candado pasaría sin revisar nada).
const leer = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB = /rgba?\(/
const EMOJI = /\p{Extended_Pictographic}/u
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

export const MIGRADOS = [
  'styles/ux-moderno.css',
  'app/Toast.tsx', 'app/Hoja.tsx', 'app/PageHead.tsx', 'app/BottomNav.tsx', 'app/TopBar.tsx', 'app/Sidebar.tsx', 'app/GuiaInventario.tsx',
  'screens/home/HomeDoctor.tsx', 'screens/doctor/BarraCarrito.tsx', 'screens/doctor/Catalogo.tsx', 'screens/doctor/OrderCard.tsx',
  'screens/chat/Asesorias.tsx',
  'screens/sales/LlamarHoy.tsx', 'data/ops/prospeccion.ts',
]

describe('Sistema de diseño · candado', () => {
  const ds = leer('styles/ds.css')
  it('tokens obligatorios en styles/ds.css', () => {
    for (const t of ['--ds-canvas', '--ds-surface', '--ds-ink', '--ds-text-2', '--ds-muted', '--ds-border', '--ds-brand', '--ds-brand-soft',
      '--ds-success', '--ds-warning', '--ds-danger', '--ds-info', '--ds-neutral', '--ds-fs-xs', '--ds-fs-sm', '--ds-fs-md', '--ds-fs-lg', '--ds-fs-xl', '--ds-fs-2xl',
      '--ds-r-sm', '--ds-r', '--ds-r-lg', '--ds-shadow', '--ds-ease']) expect(ds).toContain(`${t}:`)
  })
  it('ds.css: fuera del bloque de tokens no hay colores literales', () => {
    const fuera = sinComentarios(ds.replace(/\/\* ds:tokens:inicio \*\/[\s\S]*?\/\* ds:tokens:fin \*\//, ''))
    expect(fuera.split('\n').filter((l) => HEX.test(l) || RGB.test(l))).toEqual([])
  })
  for (const f of MIGRADOS) it(`${f}: sin colores literales, emojis, window.confirm ni alert()`, () => {
    const src = sinComentarios(leer(f))
    const malas = src.split('\n').filter((l) => HEX.test(l) || RGB.test(l) || EMOJI.test(l) || /window\.confirm|(^|[^.\w])alert\(/.test(l))
    expect(malas).toEqual([])
  })
  it('los archivos se leen de verdad (no vacíos)', () => { for (const f of ['styles/ds.css', ...MIGRADOS]) expect(leer(f).length).toBeGreaterThan(200) })
  it('las reglas detectan lo prohibido y no marcan lo correcto', () => {
    expect(HEX.test("color: '#fff'")).toBe(true); expect(RGB.test('rgba(0,0,0,.2)')).toBe(true); expect(EMOJI.test('Listo ✅')).toBe(true)
    expect(HEX.test("color: 'var(--ds-ink)'")).toBe(false)
  })
})
