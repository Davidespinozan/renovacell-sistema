// UBICACIÓN EN EL CHAT (5 nov 2026, pedido de Alejandra) · formato del mensaje, lectura de enlaces de Maps y envío nativo por WhatsApp.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SUCURSAL, coordsDeTexto, cuerpoUbicacion, enlaceMaps, leerUbicacion, textoUbicacion } from '../../../../../supabase/functions/_shared/ubicacion'
import { despacharWhatsApp } from '../../../../../supabase/functions/_shared/whatsappEnvio'

describe('ubicación · formato', () => {
  it('ida y vuelta con coordenadas', () => {
    const t = textoUbicacion({ nombre: 'Clínica Tres Ríos', direccion: 'Blvd. Pedro Infante 2911', lat: 24.8069123, lng: -107.3938456 })
    expect(t).toBe('📍 Clínica Tres Ríos\nBlvd. Pedro Infante 2911\nhttps://www.google.com/maps/search/?api=1&query=24.806912,-107.393846')
    expect(leerUbicacion(t)).toEqual({ nombre: 'Clínica Tres Ríos', direccion: 'Blvd. Pedro Infante 2911', lat: 24.806912, lng: -107.393846 })
  })
  it('sucursal sin coordenadas: enlace de búsqueda por dirección y SIN pin nativo', () => {
    const t = textoUbicacion(SUCURSAL)
    expect(t).toContain('query=Boulevard%20Pedro%20Infante%202911')
    const u = leerUbicacion(t)!
    expect(u.nombre).toBe(SUCURSAL.nombre)
    expect(u.lat).toBeNull()
    expect(cuerpoUbicacion('521', u)).toBeNull()
  })
  it('un texto normal con 📍 o con un enlace de Maps no es ubicación', () => {
    expect(leerUbicacion('📍 nos vemos ahí')).toBeNull()
    expect(leerUbicacion('mira https://www.google.com/maps/search/?api=1&query=1,2')).toBeNull()
  })
  it('coordenadas de los enlaces comunes de Google Maps y escritas a mano', () => {
    expect(coordsDeTexto('https://www.google.com/maps/place/Renovacell/@24.8069,-107.3938,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d24.80695!4d-107.39381')).toEqual({ lat: 24.80695, lng: -107.39381 })
    expect(coordsDeTexto('https://www.google.com/maps/@24.8069,-107.3938,15z')).toEqual({ lat: 24.8069, lng: -107.3938 })
    expect(coordsDeTexto('https://maps.google.com/?q=24.8069,-107.3938')).toEqual({ lat: 24.8069, lng: -107.3938 })
    expect(coordsDeTexto('https://www.google.com/maps/search/?api=1&query=24.8069%2C-107.3938')).toEqual({ lat: 24.8069, lng: -107.3938 })
    expect(coordsDeTexto('24.8069, -107.3938')).toEqual({ lat: 24.8069, lng: -107.3938 })
    expect(coordsDeTexto('https://maps.app.goo.gl/AbCdEf123')).toBeNull()   // enlace corto: no trae coordenadas
    expect(coordsDeTexto('95.1, 10.2')).toBeNull()
    expect(coordsDeTexto('https://x.com/%E0%A4%A')).toBeNull()               // % sueltos no truenan
  })
  it('enlaceMaps redondea a 6 decimales', () => expect(enlaceMaps({ direccion: '', lat: 1.23456789, lng: -2.5 })).toMatch(/query=1\.234568,-2\.5$/))
})

describe('ubicación · WhatsApp', () => {
  beforeEach(() => { vi.stubGlobal('Deno', { env: { get: (k: string) => ({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123456789' } as Record<string, string>)[k] } }) })
  const admin = (texto: string) => ({ rpc: async (fn: string) => (fn.endsWith('_reclamar') ? { data: [{ id: 'S1', wa_id: '5216671112233', texto }], error: null } : fn.endsWith('_puede_enviar') ? { data: true, error: null } : { data: null, error: null }) })
  const enviado = (f: ReturnType<typeof vi.fn>) => JSON.parse(String(((f.mock.calls[0] as unknown[])[1] as RequestInit).body))
  it('con coordenadas sale como ubicación nativa (pin)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }))
    await despacharWhatsApp(admin(textoUbicacion({ nombre: 'Sucursal', direccion: 'Blvd 1', lat: 24.8, lng: -107.39 })), f as unknown as typeof fetch)
    expect(enviado(f)).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '5216671112233', type: 'location', location: { latitude: 24.8, longitude: -107.39, name: 'Sucursal', address: 'Blvd 1' } })
  })
  it('sin coordenadas sale como texto con su enlace', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }))
    await despacharWhatsApp(admin(textoUbicacion(SUCURSAL)), f as unknown as typeof fetch)
    const b = enviado(f)
    expect(b.type).toBe('text')
    expect(b.text.body).toContain('https://www.google.com/maps/search/?api=1&query=')
  })
})
