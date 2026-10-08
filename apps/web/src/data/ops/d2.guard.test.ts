// CHAT V2-D2 · Guardas estáticas del lanzador no intrusivo: sin apertura automática en el código, CSS con movimiento
// reducido, áreas seguras en móvil, un solo pulso y sin overlay propio.
import { describe, it, expect } from 'vitest'
// @ts-expect-error — node:fs en pruebas (igual que v2.guard)
import { readFileSync } from 'node:fs'
import lanzadorSrc from '../../app/ChatFlotante.tsx?raw'

const shell = readFileSync(new URL('../../styles/shell.css', import.meta.url), 'utf8')
const codigo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('V2-D2 · lanzador no intrusivo', () => {
  it('ningún camino abre el chat solo: solo abrirManual hace setAbierto(true)', () => {
    const l = codigo(String(lanzadorSrc))
    expect(l).not.toMatch(/abrirAuto|apertura === 'auto'|setApertura/)
    expect((l.match(/setAbierto\(true\)/g) ?? []).length).toBe(1)
    expect(l).toMatch(/const abrirManual = useCallback/)
    expect(l).toMatch(/if \(d\.abrir\) \{[\s\S]*?notificar\(/)          // la decisión de C4 NOTIFICA
  })
  it('27/29 · CSS: movimiento reducido, áreas seguras en móvil, oculto bajo modales, un solo pulso', () => {
    expect(shell).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.chat-vista,/)
    expect(shell).toMatch(/\.chat-vista-zona\{right:78px;bottom:calc\(96px \+ env\(safe-area-inset-bottom,0px\)\)/)   // V2-D3 · junto a la burbuja
    expect(shell).toMatch(/body:has\(\.overlay\) \.chat-vista-zona/)
    expect(shell).toMatch(/\.chat-fab--pulso\{animation:rcpulso 1\.2s ease-out 1\}/)
    expect(shell).not.toMatch(/\.chat-vista-zona\{[^}]*inset:0/)            // nunca a pantalla completa
  })
})
