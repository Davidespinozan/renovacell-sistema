// NOTAS DE VOZ (15 nov 2026) · el audio y el video del cliente de WhatsApp se reconocen para guardarlos en la conversación.
import { describe, expect, it } from 'vitest'
import { extraerWhatsApp } from '../../../../../supabase/functions/_shared/whatsapp'
import { esMarcadorArchivo } from '../../../../../supabase/functions/_shared/adjuntos'

const pl = (m: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '5215512345678', profile: { name: 'Ana' } }], messages: [{ from: '5215512345678', id: 'wamid.ABCDEFGH', ...m }] } }] }] })

describe('notas de voz de WhatsApp', () => {
  it('una nota de voz (ogg/opus) trae archivo de audio y el texto marcador', () => {
    const [e] = extraerWhatsApp(pl({ type: 'audio', audio: { id: '123456789', mime_type: 'audio/ogg; codecs=opus', voice: true } }))
    expect(e.archivo).toEqual({ id: '123456789', mime: 'audio/ogg', tipo: 'audio' })
    expect(e.media).toBeUndefined()
    expect(esMarcadorArchivo(e.texto)).toBe(true)
  })
  it('un video mp4 también; un formato raro no', () => {
    expect(extraerWhatsApp(pl({ type: 'video', video: { id: '123456789', mime_type: 'video/mp4' } }))[0].archivo?.tipo).toBe('video')
    expect(extraerWhatsApp(pl({ type: 'audio', audio: { id: '123456789', mime_type: 'audio/x-raro' } }))[0].archivo).toBeUndefined()
  })
  it('el texto normal no es marcador de archivo', () => {
    expect(esMarcadorArchivo('Envió un audio')).toBe(false)
    expect(esMarcadorArchivo('hola')).toBe(false)
  })
})
