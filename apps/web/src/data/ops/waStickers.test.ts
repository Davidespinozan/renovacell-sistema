// STICKERS, REACCIONES Y GIFS DE WHATSAPP (17 nov 2026)
import { describe, expect, it } from 'vitest'
import { extraerWhatsApp } from '../../../../../supabase/functions/_shared/whatsapp'
import { esMensajeConImagen } from '../../../../../supabase/functions/_shared/adjuntos'
import sql from '../../../../../supabase/migrations/20270407230000_wa_stickers_gif.sql?raw'

const evento = (m: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '5216671234567', profile: { name: 'Ana' } }], messages: [{ from: '5216671234567', id: 'wamid.ABCDEFGHIJ', ...m }] } }] }] })

describe('WhatsApp: stickers, reacciones y lo que no se puede ver', () => {
  it('el sticker se descarga como imagen WEBP y la IA no le contesta', () => {
    const [m] = extraerWhatsApp(evento({ type: 'sticker', sticker: { id: '1234567890', mime_type: 'image/webp', animated: true } }))
    expect(m.texto).toBe('Envió un sticker por WhatsApp.')
    expect(m.media).toEqual({ id: '1234567890', mime: 'image/webp', tipo: 'image' })
    expect(m.sinRespuesta).toBe(true)
    expect(esMensajeConImagen(m.texto)).toBe(true)
  })
  it('una imagen GIF o WEBP también se guarda', () => {
    const [m] = extraerWhatsApp(evento({ type: 'image', image: { id: '1234567890', mime_type: 'image/gif' } }))
    expect(m.media?.mime).toBe('image/gif')
  })
  it('la reacción se ve como «Reaccionó con 👍»; quitarla no es mensaje', () => {
    expect(extraerWhatsApp(evento({ type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } }))[0]).toMatchObject({ texto: 'Reaccionó con 👍', sinRespuesta: true })
    expect(extraerWhatsApp(evento({ type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '' } }))).toHaveLength(0)
  })
  it('emojis en el texto pasan tal cual; lo no compatible dice qué fue', () => {
    expect(extraerWhatsApp(evento({ type: 'text', text: { body: 'Gracias 🙌😊' } }))[0].texto).toBe('Gracias 🙌😊')
    expect(extraerWhatsApp(evento({ type: 'unsupported', errors: [{ code: 131051 }] }))[0].texto).toMatch(/no deja ver fuera del teléfono/)
  })
  it('la base acepta WEBP/GIF y el mensaje de sticker', () => {
    expect(sql).toMatch(/'image\/webp', 'image\/gif'/)
    expect(sql).toMatch(/Envió un sticker por WhatsApp\.%/)
  })
})
