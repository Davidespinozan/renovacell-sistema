// DOCUMENTOS DE WHATSAPP (20 nov 2026) · lo que el cliente manda "como documento" (PDF, Word, Excel, foto sin comprimir) se
// reconoce, se descarga con sus límites y se guarda con su nombre; el chat sabe cuándo el archivo aún no llega o ya no llegó.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extraerWhatsApp, MIME_DOC_WA } from '../../../../../supabase/functions/_shared/whatsapp'
import { descargarArchivoWA, MAX_DOC_WA } from '../../../../../supabase/functions/_shared/whatsappEnvio'
import { esMarcadorArchivo, guardarArchivoWA, nombreDocumentoWA, RUTA_ARCHIVO } from '../../../../../supabase/functions/_shared/adjuntos'
import { archivoPendienteWA, pieArchivoWA, textoCita } from './chat'
import migracion from '../../../../../supabase/migrations/20270407360000_wa_documentos.sql?raw'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'

afterEach(() => { vi.unstubAllGlobals() })
const pl = (m: Record<string, unknown>) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '5215512345678', profile: { name: 'Ana' } }], messages: [{ from: '5215512345678', id: 'wamid.ABCDEFGH', ...m }] } }] }] })
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const CONV = '3c5da8aa-1043-45d7-814f-7c00eba786de'

describe('parser: el documento de WhatsApp trae archivo para guardarse', () => {
  it('un PDF trae archivo con su nombre (y sigue yendo a la IA como media)', () => {
    const [e] = extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: 'application/pdf', filename: 'Comprobante SPEI.pdf' } }))
    expect(e.archivo).toEqual({ id: '123456789', mime: 'application/pdf', tipo: 'document', nombre: 'Comprobante SPEI.pdf' })
    expect(e.media).toEqual({ id: '123456789', mime: 'application/pdf', tipo: 'document' })
    expect(e.texto).toBe('Envió un documento por WhatsApp.')
    expect(esMarcadorArchivo(e.texto)).toBe(true)
  })
  it('Word, Excel y una foto mandada como documento también; con pie de foto sigue siendo marcador', () => {
    const [w] = extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: DOCX, filename: 'Receta.docx', caption: 'mi receta' } }))
    expect(w.archivo).toMatchObject({ tipo: 'document', mime: DOCX, nombre: 'Receta.docx' })
    expect(w.media).toBeUndefined()
    expect(w.texto).toBe('Envió un documento por WhatsApp. «mi receta»')
    expect(esMarcadorArchivo(w.texto)).toBe(true)
    expect(extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: 'image/jpeg', filename: 'IMG_0012.jpg' } }))[0].archivo).toMatchObject({ tipo: 'document', mime: 'image/jpeg' })
    expect(extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: 'application/vnd.ms-excel' } }))[0].archivo).toEqual({ id: '123456789', mime: 'application/vnd.ms-excel', tipo: 'document' })
  })
  it('un tipo que no se guarda (zip, html) o un id raro no traen archivo; el nombre nunca lleva rutas', () => {
    expect(extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: 'application/zip', filename: 'x.zip' } }))[0].archivo).toBeUndefined()
    expect(extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: 'text/html', filename: 'x.html' } }))[0].archivo).toBeUndefined()
    expect(extraerWhatsApp(pl({ type: 'document', document: { id: 'abc', mime_type: 'application/pdf' } }))[0].archivo).toBeUndefined()
    expect(extraerWhatsApp(pl({ type: 'document', document: { id: '123456789', mime_type: 'application/pdf', filename: '../../etc/pass\nwd.pdf' } }))[0].archivo?.nombre).toBe('.. .. etc pass wd.pdf')
    expect(MIME_DOC_WA).not.toContain('image/svg+xml')
  })
  it('audio y video siguen igual que antes', () => {
    expect(extraerWhatsApp(pl({ type: 'audio', audio: { id: '123456789', mime_type: 'audio/ogg; codecs=opus' } }))[0].archivo).toEqual({ id: '123456789', mime: 'audio/ogg', tipo: 'audio' })
    expect(extraerWhatsApp(pl({ type: 'video', video: { id: '123456789', mime_type: 'video/mp4' } }))[0].archivo).toEqual({ id: '123456789', mime: 'video/mp4', tipo: 'video' })
  })
})

describe('descarga del documento (sin red real)', () => {
  const conEnv = () => vi.stubGlobal('Deno', { env: { get: (k: string) => ({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '1132605303277474' } as Record<string, string>)[k] } })
  const red = (meta: Record<string, unknown>, bytes: Uint8Array) => vi.fn(async (url: string) => (String(url).includes('graph.facebook.com')
    ? new Response(JSON.stringify(meta), { status: 200 }) : new Response(bytes as unknown as BodyInit, { status: 200 }))) as unknown as typeof fetch
  it('baja un PDF y devuelve sus bytes y su tipo', async () => {
    conEnv()
    const f = red({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'application/pdf', file_size: 4 }, new Uint8Array([1, 2, 3, 4]))
    const r = await descargarArchivoWA({ id: '123456789', mime: 'application/pdf', tipo: 'document' }, f)
    expect(r?.mime).toBe('application/pdf'); expect(r?.bytes.length).toBe(4)
  })
  it('falla cerrado: más de 25 MB, tipo distinto al anunciado, enlace sin https o sin llaves', async () => {
    conEnv()
    const doc = { id: '123456789', mime: 'application/pdf', tipo: 'document' as const }
    expect(await descargarArchivoWA(doc, red({ url: 'https://x/y', mime_type: 'application/pdf', file_size: MAX_DOC_WA + 1 }, new Uint8Array([1])))).toBeNull()
    expect(await descargarArchivoWA(doc, red({ url: 'https://x/y', mime_type: 'application/x-msdownload', file_size: 4 }, new Uint8Array([1])))).toBeNull()
    expect(await descargarArchivoWA(doc, red({ url: 'http://x/y', mime_type: 'application/pdf', file_size: 4 }, new Uint8Array([1])))).toBeNull()
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    expect(await descargarArchivoWA(doc, red({ url: 'https://x/y', mime_type: 'application/pdf', file_size: 4 }, new Uint8Array([1])))).toBeNull()
  })
  it('una nota de voz sigue con su tope de 16 MB y no acepta un PDF disfrazado', async () => {
    conEnv()
    expect(await descargarArchivoWA({ id: '123456789', mime: 'audio/ogg', tipo: 'audio' }, red({ url: 'https://x/y', mime_type: 'application/pdf', file_size: 4 }, new Uint8Array([1])))).toBeNull()
    expect(await descargarArchivoWA({ id: '123456789', mime: 'audio/ogg', tipo: 'audio' }, red({ url: 'https://x/y', mime_type: 'audio/ogg', file_size: 17 * 1024 * 1024 }, new Uint8Array([1])))).toBeNull()
  })
})

describe('guardar el documento con su mensaje', () => {
  const adminFalso = (errorRpc: unknown = null) => {
    const subidas: Array<{ bucket: string; ruta: string; tipo: string }> = []; const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []; const borradas: string[] = []
    const admin = {
      storage: { from: (bucket: string) => ({
        upload: async (ruta: string, _b: Uint8Array, o: { contentType: string }) => { subidas.push({ bucket, ruta, tipo: o.contentType }); return { error: null } },
        remove: async (rs: string[]) => { borradas.push(...rs); return { error: null } } }) },
      rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { error: errorRpc } },
    }
    return { admin, subidas, rpcs, borradas }
  }
  it('el PDF va al bucket privado con ruta válida y se registra con su nombre', async () => {
    const { admin, subidas, rpcs } = adminFalso()
    expect(await guardarArchivoWA(admin, CONV, 'm1', { bytes: new Uint8Array([1, 2]), mime: 'application/pdf', documento: true, nombre: 'Comprobante SPEI.pdf' })).toBe(true)
    expect(subidas[0].bucket).toBe('chat_archivos'); expect(subidas[0].ruta).toMatch(RUTA_ARCHIVO); expect(subidas[0].ruta.endsWith('.pdf')).toBe(true)
    expect(rpcs[0]).toMatchObject({ fn: 'cc_archivo_registrar_wa', args: { p_message: 'm1', p_tipo: 'application/pdf', p_bytes: 2, p_nombre: 'Comprobante SPEI.pdf' } })
  })
  it('la foto mandada como documento también; sin nombre se llama Documento.jpg', async () => {
    const { admin, subidas, rpcs } = adminFalso()
    expect(await guardarArchivoWA(admin, CONV, 'm1', { bytes: new Uint8Array([1]), mime: 'image/jpeg', documento: true })).toBe(true)
    expect(subidas[0].ruta.endsWith('.jpg')).toBe(true); expect(rpcs[0].args.p_nombre).toBe('Documento.jpg')
  })
  it('la nota de voz se registra igual que antes (sin p_nombre) y una foto que NO es documento no entra por aquí', async () => {
    const { admin, rpcs } = adminFalso()
    expect(await guardarArchivoWA(admin, CONV, 'm1', { bytes: new Uint8Array([1]), mime: 'audio/ogg' })).toBe(true)
    expect(Object.keys(rpcs[0].args)).toEqual(['p_message', 'p_ruta', 'p_tipo', 'p_bytes'])
    expect(await guardarArchivoWA(admin, CONV, 'm1', { bytes: new Uint8Array([1]), mime: 'image/jpeg' })).toBe(false)
  })
  it('si la base lo rechaza, el archivo subido se borra (no quedan huérfanos)', async () => {
    const { admin, subidas, borradas } = adminFalso({ code: '23514', message: 'ARCHIVO_INVALIDO' })
    expect(await guardarArchivoWA(admin, CONV, 'm1', { bytes: new Uint8Array([1]), mime: 'application/pdf', documento: true })).toBe(false)
    expect(borradas).toEqual([subidas[0].ruta])
  })
  it('el nombre siempre termina con extensión y cabe en 200', () => {
    expect(nombreDocumentoWA('Comprobante', 'pdf')).toBe('Comprobante.pdf')
    expect(nombreDocumentoWA('Receta.docx', 'docx')).toBe('Receta.docx')
    expect(nombreDocumentoWA('', 'xlsx')).toBe('Documento.xlsx')
    expect(nombreDocumentoWA('a'.repeat(400), 'pdf').length).toBeLessThanOrEqual(200)
  })
})

describe('el chat: archivo que aún no llega o ya no llegó', () => {
  const m = (content: string, hace_ms: number, extra: Record<string, unknown> = {}) => ({ actor: 'visitor' as const, content, created_at: new Date(1_800_000_000_000 - hace_ms).toISOString(), ...extra })
  const AHORA = 1_800_000_000_000
  it('recién llegado sin archivo = esperando; pasado el plazo = perdido', () => {
    expect(archivoPendienteWA(m('Envió un documento por WhatsApp.', 5_000), AHORA)).toBe('esperando')
    expect(archivoPendienteWA(m('Envió un documento por WhatsApp. «comprobante»', 10 * 60_000), AHORA)).toBe('perdido')
    expect(archivoPendienteWA(m('Envió un audio por WhatsApp.', 10 * 60_000), AHORA)).toBe('perdido')
    expect(archivoPendienteWA(m('Envió una imagen por WhatsApp.', 1_000), AHORA)).toBe('esperando')
  })
  it('con su archivo, o si no es un archivo de WhatsApp del cliente, no aplica', () => {
    expect(archivoPendienteWA(m('Envió un documento por WhatsApp.', 10 * 60_000, { archivo: { id: 'a', url: 'https://x', tipo: 'application/pdf', clase: 'documento', bytes: 1, nombre: 'a.pdf' } }), AHORA)).toBeNull()
    expect(archivoPendienteWA(m('Envió una imagen por WhatsApp.', 10 * 60_000, { adjunto: { id: 'a', url: 'https://x', tipo: 'image/jpeg', uso: null } }), AHORA)).toBeNull()
    expect(archivoPendienteWA(m('hola', 10 * 60_000), AHORA)).toBeNull()
    expect(archivoPendienteWA(m('Envió un sticker por WhatsApp.', 10 * 60_000), AHORA)).toBeNull()
    expect(archivoPendienteWA({ ...m('Envió un documento por WhatsApp.', 10 * 60_000), actor: 'seller' }, AHORA)).toBeNull()
  })
  it('el pie del archivo se lee del mensaje; al citarlo se ve como documento', () => {
    expect(pieArchivoWA('Envió un documento por WhatsApp. «mi comprobante»')).toBe('mi comprobante')
    expect(pieArchivoWA('Envió una imagen por WhatsApp. «quiero 3\nde estas»')).toBe('quiero 3\nde estas')
    expect(pieArchivoWA('Envió un documento por WhatsApp.')).toBeNull()
    expect(pieArchivoWA('hola «x»')).toBeNull()
    expect(textoCita('Envió un documento por WhatsApp.')).toBe('📄 Documento')
  })
})

describe('contrato de la migración y del webhook', () => {
  it('una sola firma de cc_archivo_registrar_wa, solo servidor, y acepta el mensaje de documento', () => {
    expect(migracion).toContain('drop function public.cc_archivo_registrar_wa(uuid, text, text, bigint);')
    expect(migracion).toContain('p_nombre text default null')
    expect(migracion).toMatch(/revoke all on function public\.cc_archivo_registrar_wa\(uuid, text, text, bigint, text\) from public, anon, authenticated/)
    expect(migracion).toContain("m.content ~ '^Envió un documento por WhatsApp\\.'")
    expect(migracion).toContain('_cc_es_service()')
  })
  it('la base y la Edge aceptan los mismos tipos de documento', () => {
    for (const t of MIME_DOC_WA) expect(migracion).toContain(`'${t}'`)
  })
  it('el webhook guarda el documento con su nombre y deja rastro si no pudo', () => {
    expect(webhook).toContain("documento: m.archivo.tipo === 'document', nombre: m.archivo.nombre")
    expect(webhook).toContain("etapa: 'wa_archivo'")
  })
})
