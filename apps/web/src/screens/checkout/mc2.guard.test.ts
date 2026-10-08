// MC-2 · capas en móvil y escritorio: el checkout (.overlay, z 80) queda por ENCIMA del cajón del chat
// (.chat-drawer-wrap, z 70); con un overlay abierto la burbuja y su vista previa se ocultan y la navegación
// inferior también (no compiten con el checkout).
import { describe, it, expect } from 'vitest'
// @ts-expect-error — módulo de node sin tipos en este proyecto
import { readFileSync } from 'node:fs'

const shell: string = readFileSync(new URL('../../styles/shell.css', import.meta.url), 'utf8')
const z = (sel: RegExp) => Number((shell.match(sel)?.[1]) ?? NaN)

describe('MC-2 · capas', () => {
  it('overlay (checkout) z80 > cajón del chat z70', () => {
    const overlay = z(/\.overlay\{[^}]*z-index:(\d+)/)
    const cajon = z(/\.chat-drawer-wrap\{[^}]*z-index:(\d+)/)
    expect(overlay).toBe(80); expect(cajon).toBe(70); expect(overlay).toBeGreaterThan(cajon)
  })
  it('con un overlay abierto se ocultan la burbuja, la vista previa y la navegación inferior', () => {
    expect(shell).toMatch(/body:has\(\.overlay\) \.chat-fab/)
    expect(shell).toMatch(/body:has\(\.overlay\) \.chat-vista-zona/)
    expect(shell).toMatch(/body:has\(\.overlay\)[^{]*\.bnav/)
  })
})
