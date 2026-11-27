// BARRA INFERIOR DEL CELULAR · verde oscuro, como el menú lateral (dueño, 26 nov 2026: «quedó blanco, no me gusta»).
// La capa final de estilos la aclaraba; este candado evita que vuelva a pasar sin que el dueño lo pida.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = (f: string) => readFileSync(resolve(__dirname, '../styles', f), 'utf8')
const ux = css('ux-moderno.css'), shell = css('shell.css'), movil = css('mobile.css')

describe('barra inferior del celular', () => {
  it('su fondo es el verde oscuro del menú', () => {
    expect(shell).toMatch(/\.bnav\{display:flex;[^}]*background-color:var\(--side-bg\)/)
  })
  it('la capa final no la pinta de blanco ni cambia el color de sus letras', () => {
    expect(ux).not.toMatch(/\.bnav\{[^}]*background:/)
    expect(ux).not.toMatch(/\.bnav a(\.on)?\{[^}]*color:/)
  })
  it('lo activo va en blanco con su ícono resaltado', () => {
    expect(movil).toMatch(/\.bnav a\.on \{[^}]*color: #fff/)
    expect(movil).toMatch(/\.bnav a\.on svg \{[^}]*var\(--green-soft\)/)
  })
})
