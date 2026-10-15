// @vitest-environment jsdom
// FOTOS EN EL CHAT · mandar una imagen (reducida, con su id), verla en la burbuja con su enlace temporal, y las piezas
// del servidor: prefijo img:, enlaces solo para lo ya autorizado, y la IA que no responde a fotos.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ChatCanonico } from './ChatCanonico'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'
import { idImagen, conAdjuntos, TEXTO_IMAGEN } from '../../../../../supabase/functions/_shared/adjuntos'
import chatEdge from '../../../../../supabase/functions/chat/index.ts?raw'
import verifEdge from '../../../../../supabase/functions/verificacion/index.ts?raw'
import mig from '../../../../../supabase/migrations/20261210120000_chat_adjuntos.sql?raw'

afterEach(cleanup)
const ahora = new Date().toISOString()
const conv = (mensajes: Conversacion['mensajes']): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'dueno', ultimo_seq: mensajes.length, mensajes })

describe('Fotos en la conversación (pantalla)', () => {
  it('muestra la imagen con su enlace temporal, y "no disponible" si el enlace no llegó', async () => {
    const c = new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
      : { data: body.action === 'leer' ? conv([
          { id: 'm1', seq: 1, actor: 'doctor', content: TEXTO_IMAGEN, created_at: ahora, propio: true, adjunto: { id: 'a1', url: 'https://firmada/a1', tipo: 'image/jpeg', uso: null } },
          { id: 'm2', seq: 2, actor: 'doctor', content: TEXTO_IMAGEN, created_at: ahora, propio: true, adjunto: { id: 'a2', url: null, tipo: 'image/jpeg', uso: 'ine-front' } }]) : { ok: true }, error: null }, () => null)
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} />)
    const imgs = await screen.findAllByTestId('msg-imagen')
    expect((imgs[0].querySelector('img') as HTMLImageElement).src).toBe('https://firmada/a1')
    expect(imgs[1].textContent).toMatch(/Imagen no disponible/); expect(imgs[1].textContent).toMatch(/Usada como INE frente/)
  })
  it('mandar una foto: se reduce, viaja con id img: y se recarga el hilo', async () => {
    const llamadas: Array<Record<string, unknown>> = []
    const c = new ClienteChat(async (_f, { body }) => { llamadas.push(body); return body.action === 'abrir' ? { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null } : { data: body.action === 'leer' ? conv([]) : { id: 'm9', seq: 1, idempotente: false, modo: 'ai_active', ia: 'omitida' }, error: null } }, () => null)
    const reducir = vi.fn(async () => 'data:image/jpeg;base64,/9j/AA==')
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} reducir={reducir} />)
    await screen.findByTestId('btn-imagen')
    await waitFor(() => expect((screen.getByTestId('btn-imagen') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByTestId('input-imagen'), { target: { files: [new File(['x'], 'ine.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(llamadas.some((b) => b.action === 'adjuntar')).toBe(true))
    const a = llamadas.find((b) => b.action === 'adjuntar')!
    expect(a.imagen).toBe('data:image/jpeg;base64,/9j/AA=='); expect(String(a.client_message_id)).toMatch(/^img:/)
    await waitFor(() => expect(llamadas.filter((b) => b.action === 'leer').length).toBeGreaterThanOrEqual(2))
  })
  it('las acciones bajo la imagen las decide quien monta (p. ej. "Usar como INE" solo para quien verifica)', async () => {
    const c = new ClienteChat(async (_f, { body }) => ({ data: body.action === 'leer' ? { ...conv([{ id: 'm1', seq: 1, actor: 'doctor', content: TEXTO_IMAGEN, created_at: ahora, propio: false, adjunto: { id: 'a1', url: 'https://f/1', tipo: 'image/jpeg', uso: null } }]), rol: 'asesor' } : { ok: true }, error: null }), () => null)
    render(<ChatCanonico cliente={c} asesor conversationId="C1" conCarrito={false} intervaloMs={600_000} accionesAdjunto={(m) => <button type="button">Usar {m.adjunto?.id}</button>} />)
    expect(await screen.findByText('Usar a1')).toBeTruthy()
  })
})

describe('Fotos en el chat (servidor)', () => {
  it('id de imagen siempre con prefijo img: y saneado', () => {
    expect(idImagen('img:abc')).toBe('img:abc'); expect(idImagen('<x>')).toBe('img:x'); expect(idImagen(null)).toMatch(/^img:[0-9a-f-]{36}$/)
  })
  it('enlaces temporales SOLO para los mensajes que ya devolvió la lectura autorizada', async () => {
    const tablas: string[] = []
    const admin = {
      from: (t: string) => { tablas.push(t); return { select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.includes('m1') ? [{ id: 'a1', message_id: 'm1', ruta: 'C/x.jpg', tipo: 'image/jpeg', uso: null }] : [] }) }) } },
      storage: { from: () => ({ createSignedUrls: async (rutas: string[], seg: number) => ({ data: rutas.map((p) => ({ path: p, signedUrl: `https://f/${p}?${seg}` })) }) }) },
    }
    const r = await conAdjuntos(admin, { mensajes: [{ id: 'm1', content: TEXTO_IMAGEN }, { id: 'm2', content: 'Hola' }] }) as { mensajes: Array<{ adjunto?: { url: string } }> }
    expect(r.mensajes[0].adjunto?.url).toBe('https://f/C/x.jpg?600'); expect(r.mensajes[1].adjunto).toBeUndefined(); expect(tablas).toEqual(['cc_adjuntos'])
    expect(await conAdjuntos(admin, { mensajes: [{ id: 'm2', content: 'Hola' }] })).toEqual({ mensajes: [{ id: 'm2', content: 'Hola' }] })   // sin imágenes no consulta nada más
  })
  it('subir: autoridad de cc_enviar_mensaje, limpieza si falla, la IA no responde a fotos; usar como INE autoriza antes de copiar', () => {
    const i = chatEdge.indexOf("if (action === 'adjuntar')"); const bloque = chatEdge.slice(i, chatEdge.indexOf("if (action === 'solicitar_asesor')"))
    expect(bloque).toMatch(/admin\.rpc\('cc_enviar_mensaje'/); expect(bloque).toMatch(/if \(error\) \{ await quitar\(\); return falla\(error\) \}/)
    expect(bloque).toMatch(/ia: 'omitida'/); expect(bloque).not.toMatch(/responderIA/)
    expect(verifEdge.indexOf("caller.rpc('cc_adjunto_para_verificacion'")).toBeLessThan(verifEdge.indexOf("storage.from('chat').download"))
    expect(mig).toMatch(/values \('chat', 'chat', false, 3000000/); expect(mig).not.toMatch(/create policy/i)
  })
})

describe('Mensajes con enlaces y nombre de quien entró por el enlace', () => {
  it('los enlaces se vuelven clicables (sin la puntuación final) y el resto queda como texto', async () => {
    const { conEnlaces } = await import('./ChatCanonico')
    render(<div data-testid="t">{conEnlaces('Llena esto: https://renovacell.mx/#contacto. Gracias')}</div>)
    const a = screen.getByTestId('t').querySelector('a') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('https://renovacell.mx/#contacto'); expect(a.rel).toMatch(/noopener/); expect(a.target).toBe('_blank')
    expect(screen.getByTestId('t').textContent).toBe('Llena esto: https://renovacell.mx/#contacto. Gracias')
    expect(conEnlaces('sin enlaces')).toBe('sin enlaces')
    render(<div data-testid="u">{conEnlaces('javascript:alert(1) no es enlace')}</div>)
    expect(screen.getByTestId('u').querySelector('a')).toBeNull()
  })
  it('el personal ve el nombre de quien entró por el enlace, no "Visitante"', async () => {
    const { etiquetaActor } = await import('../../data/ops/sesionesPresentacion')
    expect(etiquetaActor({ actor: 'visitor', propio: false }, 'personal', { nombreCliente: 'magaly (prerregistro)', etiquetaAsesor: 'Asesora' })).toBe('Magaly')
    expect(etiquetaActor({ actor: 'visitor', propio: false }, 'personal', { nombreCliente: null, etiquetaAsesor: 'Asesora' })).toBe('Visitante')
    expect(etiquetaActor({ actor: 'visitor', propio: false }, 'cliente', { nombreCliente: 'magaly', etiquetaAsesor: 'Asesora' })).toBe('Tú')
  })
})

describe('Palomitas', () => {
  const cli = (c: Conversacion) => new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? { data: { conversation_id: 'C1', estado: 'abierta', modo: c.modo, nuevo: false }, error: null } : { data: body.action === 'leer' ? c : { ok: true }, error: null }, () => null)
  it('dos grises = entregado; azules = el otro ya lo leyó (su cursor) o ya respondió después', async () => {
    const c = { ...conv([
      { id: 'm1', seq: 1, actor: 'visitor', content: 'Hola', created_at: ahora, propio: true },
      { id: 'm2', seq: 2, actor: 'ai', content: 'Hola, ¿en qué te ayudo?', created_at: ahora, propio: false },
      { id: 'm3', seq: 3, actor: 'visitor', content: '¿Precio?', created_at: ahora, propio: true },
      { id: 'm4', seq: 4, actor: 'visitor', content: '¿Envío?', created_at: ahora, propio: true }]), leido_otro: 3 } as Conversacion
    render(<ChatCanonico cliente={cli(c)} conCarrito={false} intervaloMs={600_000} />)
    await screen.findByText('¿Envío?')
    expect(screen.getAllByTestId('tick-visto')).toHaveLength(2)        // m1 (respondió el asistente) y m3 (cursor del asesor)
    expect(screen.getAllByTestId('tick-entregado')).toHaveLength(1)    // m4 aún no lo ve nadie
    expect(screen.queryByText('Enviando…')).toBeNull()
  })
  it('mientras se envía: una palomita gris, sin la palabra "Enviando…"', async () => {
    const c = new ClienteChat(async (_f, { body }) => body.action === 'abrir' ? { data: { conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', nuevo: false }, error: null }
      : body.action === 'enviar' ? new Promise(() => {}) as never : { data: body.action === 'leer' ? conv([]) : { ok: true }, error: null }, () => null)
    render(<ChatCanonico cliente={c} conCarrito={false} intervaloMs={600_000} />)
    const area = await screen.findByLabelText('Escribe tu mensaje')
    await waitFor(() => expect((area as HTMLTextAreaElement).disabled).toBe(false))
    fireEvent.change(area, { target: { value: 'Hola' } }); fireEvent.click(screen.getByTestId('btn-enviar'))
    expect(await screen.findByTestId('tick-enviando')).toBeTruthy(); expect(screen.queryByText('Enviando…')).toBeNull()
  })
  it('el servidor cuenta la lectura del OTRO lado (asesor para el cliente; dueño para el personal)', () => {
    expect(chatEdge).toMatch(/conLecturaAjena\(admin, conv, actor\.actor, await conAdjuntos\(admin, data\)\)/)
  })
})
