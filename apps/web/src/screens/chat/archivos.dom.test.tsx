// @vitest-environment jsdom
// CHAT-ARCHIVOS (3 nov 2026) · videos y documentos en Conversaciones: el mismo clip manda una foto (camino de siempre) o
// un archivo (preparar → subida firmada → enviar), la burbuja muestra el reproductor o la tarjeta del documento, y las
// piezas del servidor: marcador del mensaje, enlaces solo para lo autorizado y cómo sale por WhatsApp.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'
import { conArchivos, esMarcadorArchivo, idArchivo, textoArchivo, claseArchivo, RUTA_ARCHIVO } from '../../../../../supabase/functions/_shared/adjuntos'
import { cuerpoMedia } from '../../../../../supabase/functions/_shared/whatsapp'
import { tipoWA } from '../../../../../supabase/functions/_shared/whatsappEnvio'
import { mapearErrorChat } from '../../../../../supabase/functions/_shared/chat'

afterEach(cleanup)
const ahora = new Date().toISOString()
const conv = (mensajes: Conversacion['mensajes']): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: mensajes.length, mensajes })
const abierta = { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }

describe('Videos y documentos (pantalla)', () => {
  it('muestra el video con reproductor y el documento con nombre, tipo y peso', async () => {
    const c = new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? abierta : { data: body.action === 'leer' ? conv([
      { id: 'm1', seq: 1, actor: 'seller', content: 'Envió un video.', created_at: ahora, propio: false, archivo: { id: 'f1', url: 'https://firmada/v.mp4', tipo: 'video/mp4', clase: 'video', bytes: 5_000_000, nombre: 'demo.mp4' } },
      { id: 'm2', seq: 2, actor: 'seller', content: 'Envió un documento: Ficha.pdf.', created_at: ahora, propio: false, archivo: { id: 'f2', url: 'https://firmada/f.pdf', tipo: 'application/pdf', clase: 'documento', bytes: 307200, nombre: 'Ficha.pdf' } },
      { id: 'm3', seq: 3, actor: 'seller', content: 'Envió un documento: Viejo.pdf.', created_at: ahora, propio: false, archivo: { id: 'f3', url: null, tipo: 'application/pdf', clase: 'documento', bytes: 1, nombre: 'Viejo.pdf' } }]) : { ok: true }, error: null }, () => null)
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} />)
    const v = await screen.findByTestId('msg-video')
    expect((v.querySelector('video') as HTMLVideoElement).src).toBe('https://firmada/v.mp4')
    const docs = screen.getAllByTestId('msg-documento')
    expect(docs[0]).toHaveTextContent('Ficha.pdf'); expect(docs[0]).toHaveTextContent('PDF · 300 KB')
    expect((docs[0].querySelector('a') as HTMLAnchorElement).href).toBe('https://firmada/f.pdf')
    expect(docs[1]).toHaveTextContent('Viejo.pdf · no disponible')
  })
  it('mandar un PDF: preparar, subir con el permiso firmado y enviar con id arc:', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    const c = new ClienteChat(async (_f, { body }) => {
      llamadas.push(body)
      if (body.action === 'abrir') return abierta
      if (body.action === 'leer') return { data: conv([]), error: null }
      if (body.action === 'archivo_preparar') return { data: { ruta: 'C1/x.pdf', token: 'T', bucket: 'chat_archivos' }, error: null }
      return { data: { id: 'm9', seq: 1, idempotente: false, modo: 'ai_active', ia: 'omitida' }, error: null }
    }, () => null)
    const subir = vi.fn(async () => null)
    const original = c.archivo.bind(c)
    c.archivo = (id, f, tipo) => original(id, f, tipo, subir)
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} />)
    await waitFor(() => expect((screen.getByTestId('btn-imagen') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId('btn-imagen')).toHaveAttribute('aria-label', 'Mandar foto, video o documento')
    const f = new File([new Uint8Array(2048)], 'Ficha técnica.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByTestId('input-imagen'), { target: { files: [f] } })
    await waitFor(() => expect(llamadas.some((b) => b.action === 'archivo_enviar')).toBe(true))
    expect(llamadas.find((b) => b.action === 'archivo_preparar')).toMatchObject({ conversation_id: 'C1', tipo: 'application/pdf', bytes: 2048 })
    expect(subir).toHaveBeenCalledWith('chat_archivos', 'C1/x.pdf', 'T', f, 'application/pdf')
    const e = llamadas.find((b) => b.action === 'archivo_enviar')!
    expect(e).toMatchObject({ ruta: 'C1/x.pdf', nombre: 'Ficha técnica.pdf' }); expect(String(e.client_message_id)).toMatch(/^arc:/)
    expect(llamadas.some((b) => b.action === 'adjuntar')).toBe(false)
  })
  it('un archivo no permitido no se manda y se dice por qué; si el servidor lo rechaza, se muestra su motivo', async () => {
    const c = new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? abierta
      : body.action === 'archivo_preparar' ? { data: null, error: { context: { json: async () => ({ error: 'archivo_canal', message: 'por Instagram solo se mandan textos y fotos; comparte el archivo como enlace' }) } } }
      : { data: body.action === 'leer' ? conv([]) : { ok: true }, error: null }, () => null)
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} />)
    await waitFor(() => expect((screen.getByTestId('btn-imagen') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByTestId('input-imagen'), { target: { files: [new File(['x'], 'app.exe', { type: 'application/x-msdownload' })] } })
    expect(await screen.findByText(/«app.exe» no es una imagen, un video ni un documento/)).toBeTruthy()
    fireEvent.change(screen.getByTestId('input-imagen'), { target: { files: [new File(['x'], 'lista.xlsx', { type: '' })] } })
    expect(await screen.findByText(/por Instagram solo se mandan textos y fotos/)).toBeTruthy()
  })
})

describe('Videos y documentos (servidor)', () => {
  it('marcador del mensaje, id arc: y ruta', () => {
    expect(textoArchivo('video/mp4', 'x.mp4')).toBe('Envió un video.')
    expect(textoArchivo('application/pdf', 'Ficha.pdf')).toBe('Envió un documento: Ficha.pdf.')
    expect(esMarcadorArchivo('Envió un documento: Ficha.pdf.')).toBe(true); expect(esMarcadorArchivo('Envió un video.')).toBe(true); expect(esMarcadorArchivo('Hola')).toBe(false)
    expect(idArchivo('arc:abc')).toBe('arc:abc'); expect(idArchivo(null)).toMatch(/^arc:[0-9a-f-]{36}$/)
    expect(claseArchivo('image/jpeg')).toBeNull(); expect(claseArchivo('video/quicktime')).toBe('video')
    expect(RUTA_ARCHIVO.test('11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.pdf')).toBe(true)
    expect(RUTA_ARCHIVO.test('../x.pdf')).toBe(false)
  })
  it('enlaces temporales SOLO para los mensajes de archivo que ya devolvió la lectura autorizada', async () => {
    const pedidos: string[][] = []
    const admin = {
      from: () => ({ select: () => ({ in: async (_c: string, ids: string[]) => { pedidos.push(ids); return { data: [{ id: 'f1', message_id: 'm1', ruta: 'C/x.pdf', tipo: 'application/pdf', clase: 'documento', bytes: 9, nombre: 'Ficha.pdf' }] } } }) }),
      storage: { from: (b: string) => ({ createSignedUrls: async (rutas: string[], seg: number) => ({ data: rutas.map((p) => ({ path: p, signedUrl: `https://${b}/${p}?${seg}` })) }) }) },
    }
    const r = await conArchivos(admin, { mensajes: [{ id: 'm1', content: 'Envió un documento: Ficha.pdf.' }, { id: 'm2', content: 'Hola' }] }) as { mensajes: Array<{ archivo?: { url: string; nombre: string } }> }
    expect(pedidos).toEqual([['m1']])
    expect(r.mensajes[0].archivo).toMatchObject({ url: 'https://chat_archivos/C/x.pdf?600', nombre: 'Ficha.pdf' }); expect(r.mensajes[1].archivo).toBeUndefined()
  })
  it('por WhatsApp: video MP4 de hasta 16 MB sale como video; otro, como documento con su nombre', () => {
    expect(tipoWA('video/mp4', 10_000_000)).toBe('video'); expect(tipoWA('video/mp4', 20_000_000)).toBe('document'); expect(tipoWA('video/quicktime', 1000)).toBe('document')
    expect(cuerpoMedia('521', 'video', 'https://f', null, null)).toMatchObject({ type: 'video', video: { link: 'https://f' } })
    expect(cuerpoMedia('521', 'document', 'https://f', null, 'Ficha.pdf')).toMatchObject({ type: 'document', document: { link: 'https://f', filename: 'Ficha.pdf' } })
  })
  it('los rechazos de la base llegan con su motivo', () => {
    expect(mapearErrorChat('ARCHIVO_CANAL: por Instagram solo se mandan textos y fotos; comparte el archivo como enlace')).toEqual({ status: 400, body: { error: 'archivo_canal', message: 'por Instagram solo se mandan textos y fotos; comparte el archivo como enlace' } })
    expect(mapearErrorChat('ARCHIVO_TAMANO: el máximo es 50 MB').body.error).toBe('archivo_tamano')
  })
})
