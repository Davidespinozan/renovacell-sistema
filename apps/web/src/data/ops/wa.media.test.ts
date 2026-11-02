// FOTOS AL CLIENTE (2 nov 2026) · un mensaje con foto sale como FOTO por WhatsApp (antes salía el texto "Envió una imagen.").
import { describe, it, expect, vi } from 'vitest'
import { cuerpoMedia } from '../../../../../supabase/functions/_shared/whatsapp'
import { adjuntoParaEnviar } from '../../../../../supabase/functions/_shared/whatsappEnvio'

const admin = (adj: { ruta: string; tipo: string } | null, firma: { signedUrl?: string; error?: unknown } = { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/chat/a.jpg?token=t' }) => ({
  from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: adj }) }) }) }) }) }),
  storage: { from: () => ({ createSignedUrl: vi.fn(async () => (firma.error ? { data: null, error: firma.error } : { data: { signedUrl: firma.signedUrl }, error: null })) }) },
})

describe('cuerpo de WhatsApp con archivo', () => {
  it('imagen por enlace; el marcador no va como pie, un texto real sí', () => {
    expect(cuerpoMedia('521', 'image', 'https://f/a.jpg', null)).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '521', type: 'image', image: { link: 'https://f/a.jpg' } })
    expect(cuerpoMedia('521', 'image', 'https://f/a.jpg', 'Lista de precios')).toMatchObject({ image: { link: 'https://f/a.jpg', caption: 'Lista de precios' } })
    expect(cuerpoMedia('521', 'document', 'https://f/a.pdf', null, 'lista.pdf')).toMatchObject({ type: 'document', document: { link: 'https://f/a.pdf', filename: 'lista.pdf' } })
  })
})

describe('archivo del mensaje', () => {
  it('sin archivo: texto como siempre; con foto: enlace temporal; si no se puede firmar: error (no se manda el marcador)', async () => {
    expect(await adjuntoParaEnviar(admin(null), 'm1')).toBeNull()
    expect(await adjuntoParaEnviar(admin({ ruta: 'c/a.jpg', tipo: 'image/jpeg' }), 'm1')).toMatchObject({ tipo: 'image', enlace: expect.stringContaining('/sign/chat/') })
    expect(await adjuntoParaEnviar(admin({ ruta: 'c/a.jpg', tipo: 'image/jpeg' }, { error: 'x' }), 'm1')).toBe('error')
    expect(await adjuntoParaEnviar({}, 'm1')).toBeNull()   // sin acceso a la tabla: no rompe el envío de texto
  })
})
