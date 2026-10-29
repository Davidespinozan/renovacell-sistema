// R4-C13 · La IA de WhatsApp VE imágenes y PDF del cliente: el parser toma id y tipo, la descarga respeta límites (tamaño,
// tipo, https, tiempo) y falla cerrado, el modelo recibe el archivo junto al último mensaje SOLO en el canal, y el traspaso a
// asesor depende del texto (con archivo visible no se transfiere solo por mandarlo). Sin red real.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { extraerWhatsApp } from '../../../../../supabase/functions/_shared/whatsapp'
import { descargarMedia, MAX_IMAGEN } from '../../../../../supabase/functions/_shared/whatsappEnvio'
import * as politica from '../../../../../supabase/functions/_shared/ia/politica'
import * as herramientas from '../../../../../supabase/functions/_shared/ia/herramientas'
import * as validacion from '../../../../../supabase/functions/_shared/ia/validacion'
import { ejecutarTurno, type DepsOrquestador } from '../../../../../supabase/functions/_shared/ia/orquestador'
import { crearProveedorFalso, respuestaTexto } from '../../../../../supabase/functions/_shared/ia/proveedor'
import { responderIA } from '../../../../../supabase/functions/_shared/ia/responder'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'

afterEach(() => { vi.unstubAllGlobals() })
const payload = (m: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '5216671234567', profile: { name: 'Cli' } }], messages: [{ from: '5216671234567', id: 'wamid.X1234567', ...m }] } }] }] })
const ENV = (k: string) => ({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '1132605303277474' } as Record<string, string>)[k]

describe('parser: imagen y PDF con id y tipo', () => {
  it('imagen jpeg con pie de foto', () => {
    const [m] = extraerWhatsApp(payload({ type: 'image', image: { id: '987654321', mime_type: 'image/jpeg', caption: 'quiero 3 de estas' } }))
    expect(m.media).toEqual({ id: '987654321', mime: 'image/jpeg', tipo: 'image' }); expect(m.texto).toBe('Envió una imagen por WhatsApp. «quiero 3 de estas»')
  })
  it('PDF sí; Word, sticker, audio y texto no traen media', () => {
    expect(extraerWhatsApp(payload({ type: 'document', document: { id: '123456', mime_type: 'application/pdf' } }))[0].media).toMatchObject({ tipo: 'document' })
    for (const m of [{ type: 'document', document: { id: '123456', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }, { type: 'sticker', sticker: { id: '123456', mime_type: 'image/webp' } }, { type: 'audio', audio: { id: '123456', mime_type: 'audio/ogg' } }, { type: 'text', text: { body: 'hola' } }])
      expect(extraerWhatsApp(payload(m))[0].media).toBeUndefined()
  })
})

describe('descarga con límites (falla cerrado)', () => {
  const respuestas = (meta: unknown, bin: Uint8Array | null, metaStatus = 200) => vi.fn(async (url: string) =>
    url.includes('graph.facebook.com') ? new Response(JSON.stringify(meta), { status: metaStatus }) : new Response(bin, { status: bin ? 200 : 404 }))
  it('descarga y entrega base64 con el token en ambos pasos', async () => {
    vi.stubGlobal('Deno', { env: { get: ENV } })
    const f = respuestas({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', file_size: 3 }, new Uint8Array([1, 2, 3]))
    expect(await descargarMedia({ id: '987654321', mime: 'image/jpeg', tipo: 'image' }, f as never)).toEqual({ tipo: 'image', media_type: 'image/jpeg', data: 'AQID' })
    expect(f.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization)).toEqual(['Bearer t', 'Bearer t'])
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://graph.facebook.com/v21.0/987654321')
  })
  it('demasiado grande, tipo no permitido, url no https, error de Meta o de red → null', async () => {
    vi.stubGlobal('Deno', { env: { get: ENV } })
    const img = { id: '987654321', mime: 'image/jpeg', tipo: 'image' as const }
    expect(await descargarMedia(img, respuestas({ url: 'https://x/y', mime_type: 'image/jpeg', file_size: MAX_IMAGEN + 1 }, new Uint8Array([1])) as never)).toBeNull()
    expect(await descargarMedia(img, respuestas({ url: 'https://x/y', mime_type: 'image/svg+xml', file_size: 3 }, new Uint8Array([1])) as never)).toBeNull()
    expect(await descargarMedia(img, respuestas({ url: 'http://x/y', mime_type: 'image/jpeg', file_size: 3 }, new Uint8Array([1])) as never)).toBeNull()
    expect(await descargarMedia(img, respuestas({}, null, 400) as never)).toBeNull()
    expect(await descargarMedia(img, (async () => { throw new Error('red') }) as never)).toBeNull()
  })
  it('sin llaves de WhatsApp no descarga nada', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const f = vi.fn(); expect(await descargarMedia({ id: '987654321', mime: 'image/jpeg', tipo: 'image' }, f as never)).toBeNull(); expect(f).not.toHaveBeenCalled()
  })
})

describe('el modelo recibe el archivo junto al último mensaje (solo canal)', () => {
  const ADJ = { tipo: 'image' as const, media_type: 'image/jpeg', data: 'AQID' }
  function db() {
    const rpc: DepsOrquestador['rpc'] = async (fn) => {
      if (fn === 'cc_ia_contexto_actor') return { data: { actor: 'visitor', audiencia: 'public', puede_precio: false, puede_stock: false, puede_pedidos: false, verificado: false }, error: null }
      if (fn === 'cc_ia_turno_reclamar') return { data: { estado: 'reclamado', turn_id: 't1', operation_id: 'ai:9', attempts: 1 }, error: null }
      if (fn === 'cc_ia_estado_handoff') return { data: { horario_configurado: true, en_horario: true, modo: 'ai_active' }, error: null }
      if (fn === 'cc_ia_turno_responder') return { data: { persistido: true, idempotente: false }, error: null }
      return { data: [], error: null }
    }
    return rpc
  }
  const deps = (canal: boolean) => ({ rpc: db(), leerMensajes: async () => [{ actor: 'visitor', content: 'Envió una imagen por WhatsApp.' }], proveedor: crearProveedorFalso([respuestaTexto('Gracias, déjame revisar la etiqueta.')]),
    config: { maxTokens: 300, timeoutMs: 20_000, maxRondas: 3, historial: 12 }, politica: canal ? { ...politica, clasificarIntencion: politica.clasificarIntencionCanal } : politica, herramientas, validacion, reglasConocimiento: [] }) as DepsOrquestador & { proveedor: ReturnType<typeof crearProveedorFalso> }
  it('canal: [imagen base64, texto del mensaje]', async () => {
    const d = deps(true)
    await ejecutarTurno({ conv: 'c', triggerSeq: 9, actor: 'visitor', profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'Envió una imagen por WhatsApp.', canal: 'whatsapp', adjunto: ADJ }, d)
    const ultimo = d.proveedor.solicitudes[0].messages.at(-1)!
    expect(Array.isArray(ultimo.content)).toBe(true)
    expect((ultimo.content as Array<Record<string, unknown>>)[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } })
    expect((ultimo.content as Array<Record<string, unknown>>)[1]).toMatchObject({ type: 'text' })
  })
  it('portal: el adjunto se ignora', async () => {
    const d = deps(false)
    await ejecutarTurno({ conv: 'c', triggerSeq: 9, actor: 'visitor', profile: null, visitorHash: 'h'.repeat(64), textoUsuario: 'hola', canal: 'portal', adjunto: ADJ }, d)
    expect(typeof d.proveedor.solicitudes[0].messages.at(-1)!.content).toBe('string')
  })
  it('la política del canal pide leer la etiqueta, buscarla y no evaluar fotos de pacientes', () => {
    const c = politica.contextoCanal('whatsapp')
    expect(c).toContain('lee nombre, marca o presentación de la etiqueta y búscalo con buscar_productos'); expect(c).toContain('no la evalúes clínicamente')
  })
})

describe('traspaso con archivo', () => {
  function admin() { const llamadas: string[] = []; return { llamadas, rpc: async (fn: string) => { llamadas.push(fn); return fn === '_cc_canal_transferir' ? { data: true, error: null } : { data: {}, error: null } } } }
  it('archivo visible sin pie: la IA lo atiende, sin traspaso automático', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const a = admin(); await responderIA(a, 'c', 9, 'visitor', null, 'h'.repeat(64), 'Envió una imagen por WhatsApp.', 'wa:1', 'whatsapp', { tipo: 'image', media_type: 'image/jpeg', data: 'AQID' })
    expect(a.llamadas).not.toContain('_cc_canal_transferir')
  })
  it('archivo visible con pie de compra ("quiero 3 de estas") → traspaso', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const a = admin(); await responderIA(a, 'c', 9, 'visitor', null, 'h'.repeat(64), 'Envió una imagen por WhatsApp. «quiero 3 de estas»', 'wa:1', 'whatsapp', { tipo: 'image', media_type: 'image/jpeg', data: 'AQID' })
    expect(a.llamadas).toContain('_cc_canal_transferir')
  })
  it('archivo que no se pudo abrir → traspaso (como antes)', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const a = admin(); await responderIA(a, 'c', 9, 'visitor', null, 'h'.repeat(64), 'Envió una imagen por WhatsApp.', 'wa:1', 'whatsapp', null)
    expect(a.llamadas).toContain('_cc_canal_transferir')
  })
  it('el webhook descarga el archivo antes del turno y se lo pasa a la IA', () => {
    // ALTA-DESDE-CONVERSACIÓN · se descarga UNA vez al inicio (también se guarda en la conversación) y la IA recibe esa descarga.
    expect(webhook).toMatch(/const adjunto = m\.media \? await descargarMedia\(m\.media\) : null\n\s*if \(adjunto && r\.message_id\) await guardarImagenWA\(admin, r\.conversation_id, r\.message_id, adjunto\)/)
    expect(webhook).toMatch(/const ia = await responderIA\([^\n]*'whatsapp', adjunto\)/)
    expect(webhook.match(/descargarMedia\(m\.media\)/g)).toHaveLength(1)
  })
})
