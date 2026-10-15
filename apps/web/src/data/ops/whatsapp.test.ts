// WHATSAPP (WA-1) · lectura de los mensajes de Meta y el camino al chat canónico.
import { describe, it, expect } from 'vitest'
import { extraerWhatsApp, modoWhatsApp } from '../../../../../supabase/functions/_shared/whatsapp'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'

const payload = (messages: unknown[], contacts: unknown[] = [{ wa_id: '5216671112233', profile: { name: 'Ana Ruiz' } }]) => ({
  object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts, messages } }] }],
})

describe('Mensajes de WhatsApp entrantes', () => {
  it('texto, botón, lista y multimedia (con su leyenda); el nombre viene del perfil de WhatsApp', () => {
    const r = extraerWhatsApp(payload([
      { from: '5216671112233', id: 'wamid.T1', type: 'text', text: { body: 'Hola' } },
      { from: '5216671112233', id: 'wamid.T2', type: 'button', button: { text: 'Sí, me interesa' } },
      { from: '5216671112233', id: 'wamid.T3', type: 'interactive', interactive: { list_reply: { title: 'Golden Mask' } } },
      { from: '5216671112233', id: 'wamid.T4', type: 'image', image: { caption: 'mi INE' } },
      { from: '5216671112233', id: 'wamid.T5', type: 'audio', audio: {} },
    ]))
    expect(r.map((m) => m.texto)).toEqual(['Hola', 'Sí, me interesa', 'Golden Mask', 'Envió una imagen por WhatsApp. «mi INE»', 'Envió un audio por WhatsApp.'])
    expect(r[0]).toMatchObject({ wa_id: '5216671112233', nombre: 'Ana Ruiz', wamid: 'wamid.T1' })
  })
  it('ignora acuses de entrega, otros objetos y mensajes sin número o sin wamid', () => {
    expect(extraerWhatsApp({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] })).toEqual([])
    expect(extraerWhatsApp({ object: 'page', entry: [] })).toEqual([])
    expect(extraerWhatsApp(payload([{ from: 'abc', id: 'wamid.T1', type: 'text', text: { body: 'x' } }, { from: '5216671112233', type: 'text', text: { body: 'x' } }]))).toEqual([])
  })
  it('modo espejo por defecto; activo solo si se pide', () => {
    expect(modoWhatsApp(() => undefined)).toBe('espejo'); expect(modoWhatsApp(() => 'ACTIVO')).toBe('activo'); expect(modoWhatsApp(() => 'si')).toBe('espejo')
  })
  it('webhook: firma primero, cada mensaje a cc_wa_entrante por su wamid, 500 si la base falla (Meta reintenta) y ya no a la bandeja vieja', () => {
    const firma = webhook.indexOf('validSignature(body'); const wa = webhook.indexOf("admin.rpc('cc_wa_entrante'")
    expect(firma).toBeGreaterThan(0); expect(wa).toBeGreaterThan(firma)
    expect(webhook).toMatch(/if \(error\) \{ obs\('whatsapp', 'internal_error'[^\n]*return new Response\('reintentar', \{ status: 500 \}\)/)
    expect(webhook).not.toMatch(/prospects|extractMessages/)
    expect(webhook.indexOf("admin.rpc('cc_meta_entrante'")).toBeGreaterThan(wa)   // META-CANALES · Instagram/Messenger por su mid, después de WhatsApp
  })
})
