// MC-3 · layout móvil de la barra del carrito: sobre la navegación inferior con safe-area, debajo de la burbuja y
// su vista previa (que suben mientras la barra está visible), espacio extra al lienzo, oculta con overlays/hojas/
// chat y sin animación con reduced-motion. Escritorio: nunca.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — módulo de node sin tipos en este proyecto
import { readFileSync } from 'node:fs'

const css: string = readFileSync(new URL('../../styles/shell.css', import.meta.url), 'utf8')
const bloque = css.slice(css.indexOf('MC-3 · Barra contextual'))

describe('MC-3 · CSS', () => {
  it('escritorio: oculta; móvil: fija sobre la navegación inferior con safe-area', () => {
    expect(bloque).toMatch(/^[^@]*\.rc-cart-bar\{display:none\}/m)
    expect(bloque).toMatch(/\.rc-cart-bar\{display:flex;[^}]*position:fixed;[^}]*bottom:calc\(72px \+ env\(safe-area-inset-bottom,0px\)\);z-index:56/)
  })
  it('burbuja y vista previa (D2/D3) suben con la barra; el lienzo gana espacio', () => {
    expect(bloque).toMatch(/body\.rc-barra-carrito \.chat-fab\{bottom:calc\(160px \+ env\(safe-area-inset-bottom,0px\)\)\}/)
    expect(bloque).toMatch(/body\.rc-barra-carrito \.chat-vista-zona\{bottom:calc\(160px \+ env\(safe-area-inset-bottom,0px\)\)\}/)
    expect(bloque).toMatch(/body\.rc-barra-carrito \.canvas\{padding-bottom:calc\(160px/)
  })
  it('z-index: barra (56) < burbuja (57) < navegación (58) < cajón (70) < overlay (80)', () => {
    const z = (re: RegExp) => Number(css.match(re)?.[1])
    expect(z(/\.chat-fab\{[^}]*z-index:(\d+)/)).toBe(57)
    expect(z(/\.bnav\{display:flex;[^}]*z-index:(\d+)/)).toBe(58)
    expect(56).toBeLessThan(57)
  })
  it('respaldo CSS: oculta con overlay, hoja, cajón de chat, chat-open y menú lateral; reduced-motion sin animación', () => {
    expect(bloque).toMatch(/body:has\(\.overlay\) \.rc-cart-bar, body:has\(\.sheet-wrap\) \.rc-cart-bar, body:has\(\.chat-drawer-wrap\) \.rc-cart-bar, body\.chat-open \.rc-cart-bar, body\.drawer-open \.rc-cart-bar\{display:none\}/)
    expect(bloque).toMatch(/prefers-reduced-motion:reduce\)\{\.rc-cart-bar\{animation:none\}\}/)
    expect(bloque).toMatch(/\.rc-cart-bar-btn\{[^}]*min-height:44px/)
  })
})
