// CALIDAD VISUAL · el editor de la landing ya no muestra HTML: ida y vuelta sin perder nada.
import { describe, it, expect } from 'vitest'
import { htmlAAmigable, amigableAHtml } from './Contenido'

describe('títulos de la landing sin HTML a la vista', () => {
  it('<br> y <span class="green"> ↔ Enter y *asteriscos*', () => {
    const html = 'La regeneración celular<br> <span class="green">que sí se nota</span>'
    expect(htmlAAmigable(html)).toBe('La regeneración celular\n*que sí se nota*')
    expect(amigableAHtml('La regeneración celular\n*que sí se nota*')).toBe('La regeneración celular<br><span class="green">que sí se nota</span>')
  })
  it('otro HTML → se deja tal cual (null = mostrar el original)', () => {
    expect(htmlAAmigable('Hola <i>doctor</i>')).toBeNull()
    expect(htmlAAmigable('Hola <b>doctor</b>')).toBe('Hola **doctor**')
    expect(amigableAHtml('Hola **doctor** y *verde*')).toBe('Hola <b>doctor</b> y <span class="green">verde</span>')
  })
  it('texto sin HTML no cambia', () => {
    expect(htmlAAmigable('Simple')).toBe('Simple')
    expect(amigableAHtml('Simple')).toBe('Simple')
  })
})
