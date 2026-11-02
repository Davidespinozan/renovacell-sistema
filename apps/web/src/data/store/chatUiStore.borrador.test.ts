// Regresión (2 nov 2026): "Hablar con mi asesor" pasaba el evento del clic como texto sugerido y la apertura del chat
// tronaba (event.trim no existe). Solo un texto se vuelve borrador; cualquier otra cosa abre el chat vacío.
import { describe, it, expect } from 'vitest'
import { pedirAbrirChat, tomarBorrador } from './chatUiStore'

describe('pedirAbrirChat', () => {
  it('un evento de clic no rompe la apertura ni se vuelve borrador', () => {
    expect(() => (pedirAbrirChat as unknown as (e: unknown) => void)({ type: 'click', target: {} })).not.toThrow()
    expect(tomarBorrador()).toBeNull()
  })
  it('un texto sí se vuelve borrador, una sola vez', () => {
    pedirAbrirChat('  Hola, me interesa Botox  ')
    expect(tomarBorrador()).toBe('Hola, me interesa Botox')
    expect(tomarBorrador()).toBeNull()
  })
})
