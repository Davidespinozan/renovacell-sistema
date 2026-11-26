// UBICACIÓN DEL CLIENTE POR WHATSAPP (26 nov 2026): se guarda con dirección y enlace de Maps, no solo «Compartió una ubicación».
import { describe, it, expect } from 'vitest'
import { extraerWhatsApp } from '../../../../../supabase/functions/_shared/whatsapp'

const payload = (location: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
  contacts: [{ wa_id: '5215591056427', profile: { name: 'Adriana' } }],
  messages: [{ from: '5215591056427', id: 'wamid.UBICACION01', type: 'location', location }] } }] }] })

describe('ubicación entrante de WhatsApp', () => {
  it('con coordenadas: pin, nombre, dirección y enlace de Maps', () => {
    const [m] = extraerWhatsApp(payload({ latitude: 24.7903, longitude: -107.4112, name: 'Consultorio', address: 'Av. Obregón 100, Culiacán' }))
    expect(m.texto).toBe('📍 Consultorio\nAv. Obregón 100, Culiacán\nhttps://www.google.com/maps/search/?api=1&query=24.7903,-107.4112')
  })
  it('ubicación actual sin nombre ni dirección: igual trae el enlace', () => {
    const [m] = extraerWhatsApp(payload({ latitude: 24.79, longitude: -107.41 }))
    expect(m.texto).toMatch(/^📍 Ubicación que compartió el cliente\nhttps:\/\/www\.google\.com\/maps\/search\/\?api=1&query=24\.79,-107\.41$/)
  })
  it('sin datos usables: el aviso de siempre', () => {
    const [m] = extraerWhatsApp(payload({}))
    expect(m.texto).toBe('Compartió una ubicación por WhatsApp.')
  })
})
