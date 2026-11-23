// DUEÑO COMO VENDEDOR · la cabecera x-actuar-como va SOLO a la base (/rest/v1), nunca a las Edges (CORS), y solo en modo Ventas.
import { describe, expect, it, afterEach } from 'vitest'
import { conActuarComo, fijarActuarComo } from './supabase.region'

afterEach(() => fijarActuarComo(null))
describe('actuar como vendedor', () => {
  it('sin modo Ventas no agrega nada', () => {
    const init = { headers: { a: '1' } }
    expect(conActuarComo('https://x.supabase.co/rest/v1/rpc/f', init)).toBe(init)
  })
  it('en modo Ventas: solo a /rest/v1 y conserva las demás cabeceras', () => {
    fijarActuarComo('pos')
    const h = new Headers(conActuarComo('https://x.supabase.co/rest/v1/orders', { headers: { apikey: 'k' } })!.headers)
    expect(h.get('x-actuar-como')).toBe('pos'); expect(h.get('apikey')).toBe('k')
    const edge = { headers: { apikey: 'k' } }
    expect(conActuarComo('https://x.supabase.co/functions/v1/chat', edge)).toBe(edge)
  })
})
