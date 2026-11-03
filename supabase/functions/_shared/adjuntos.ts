// FOTOS EN EL CHAT · piezas compartidas de la Edge `chat`. La imagen viaja como un mensaje normal con este texto
// (lo que ven la IA, los avisos y el historial); el archivo vive en el bucket privado `chat` y solo se entrega con
// enlaces temporales a quien YA está leyendo esa conversación.

export const TEXTO_IMAGEN = 'Envió una imagen.'
// ALTA-DESDE-CONVERSACIÓN · la foto que llega por WhatsApp también queda guardada con su mensaje ("Envió una imagen por WhatsApp.").
export const esMensajeConImagen = (content: unknown): boolean => typeof content === 'string' && (content === TEXTO_IMAGEN || content.startsWith('Envió una imagen por WhatsApp.'))
const MAX_BYTES_ADJUNTO = 3_000_000
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
/** Guarda en el bucket privado `chat` la imagen entrante de WhatsApp (ya descargada para la IA) y la registra con SU mensaje.
 *  Solo JPG/PNG de hasta 3 MB (lo que acepta cc_adjuntos); cualquier falla deja el mensaje como estaba. */
// deno-lint-ignore no-explicit-any
export async function guardarImagenWA(admin: any, conv: string, messageId: string, adj: { tipo: string; media_type: string; data: string }): Promise<boolean> {
  const ext = EXT[adj.media_type]
  if (adj.tipo !== 'image' || !ext || !messageId) return false
  try {
    const bin = atob(adj.data); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    if (!bytes.length || bytes.length > MAX_BYTES_ADJUNTO) return false
    const ruta = `${conv}/${crypto.randomUUID()}.${ext}`
    const { error: eSub } = await admin.storage.from('chat').upload(ruta, bytes, { contentType: adj.media_type })
    if (eSub) return false
    const { error } = await admin.rpc('cc_adjunto_registrar_wa', { p_message: messageId, p_ruta: ruta, p_tipo: adj.media_type, p_bytes: bytes.length })
    if (error) { await admin.storage.from('chat').remove([ruta]).then(() => {}, () => {}); return false }
    return true
  } catch { return false }
}
export const VIGENCIA_ENLACE_SEG = 600

// CHAT-ARCHIVOS (mig 20270324) · videos y documentos: bucket privado `chat_archivos`, tabla cc_archivos. El mensaje dice
// qué llegó ("Envió un video." / "Envió un documento: Ficha.pdf."); el archivo solo se entrega con enlaces temporales.
export const BUCKET_ARCHIVOS = 'chat_archivos'
export const MAX_BYTES_ARCHIVO = 52_428_800
export const EXT_ARCHIVO: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}
export const claseArchivo = (tipo: string): 'video' | 'documento' | null => (!EXT_ARCHIVO[tipo] ? null : tipo.startsWith('video/') ? 'video' : 'documento')
export const nombreArchivo = (n: unknown): string => (typeof n === 'string' ? n.replace(/[\u0000-\u001f/\\]+/g, ' ').trim().slice(0, 200) : '') || 'archivo'
export const textoArchivo = (tipo: string, nombre: string): string => (claseArchivo(tipo) === 'video' ? 'Envió un video.' : `Envió un documento: ${nombre.slice(0, 160)}.`)
/** El texto que marca un mensaje de archivo (no se le manda al cliente como pie en WhatsApp). */
export const esMarcadorArchivo = (t: unknown): boolean => typeof t === 'string' && (t === 'Envió un video.' || /^Envió un documento: .*\.$/s.test(t))
/** client_message_id de un archivo: siempre con prefijo `arc:` (así la base sabe que lleva archivo). */
export function idArchivo(entrada: unknown): string {
  const base = typeof entrada === 'string' ? entrada.replace(/^arc:/, '').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 70) : ''
  return 'arc:' + (base || crypto.randomUUID())
}
/** Ruta del archivo: <conversación>/<uuid>.<ext> (la que acepta cc_archivos). */
export const rutaArchivo = (conv: string, tipo: string): string => `${conv}/${crypto.randomUUID()}.${EXT_ARCHIVO[tipo]}`
export const RUTA_ARCHIVO = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/

/** client_message_id de una imagen: siempre con prefijo `img:` (así la base sabe que lleva adjunto). */
export function idImagen(entrada: unknown): string {
  const base = typeof entrada === 'string' ? entrada.replace(/^img:/, '').replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 70) : ''
  return 'img:' + (base || crypto.randomUUID())
}

type Msj = { id?: unknown; content?: unknown; adjunto?: unknown }
// deno-lint-ignore no-explicit-any
export async function conAdjuntos(admin: any, data: unknown): Promise<unknown> {
  const d = data as { mensajes?: Msj[] } | null
  const msgs = Array.isArray(d?.mensajes) ? d!.mensajes! : []
  const ids = msgs.filter((m) => esMensajeConImagen(m.content) && typeof m.id === 'string').map((m) => m.id as string)
  if (!ids.length) return data
  try {
    const { data: ads } = await admin.from('cc_adjuntos').select('id, message_id, ruta, tipo, uso').in('message_id', ids)
    const lista = (ads ?? []) as Array<{ id: string; message_id: string; ruta: string; tipo: string; uso: string | null }>
    if (!lista.length) return data
    const { data: firmadas } = await admin.storage.from('chat').createSignedUrls(lista.map((a) => a.ruta), VIGENCIA_ENLACE_SEG)
    const url = new Map<string, string>(((firmadas ?? []) as Array<{ path: string; signedUrl: string }>).map((f) => [f.path, f.signedUrl]))
    const porMsj = new Map(lista.map((a) => [a.message_id, { id: a.id, url: url.get(a.ruta) ?? null, tipo: a.tipo, uso: a.uso }]))
    return { ...(d as Record<string, unknown>), mensajes: msgs.map((m) => (porMsj.has(m.id as string) ? { ...m, adjunto: porMsj.get(m.id as string) } : m)) }
  } catch { return data }   // sin enlaces el mensaje sigue ahí ("Envió una imagen."): nunca se rompe la lectura
}

/** CHAT-ARCHIVOS · a los mensajes que traen video o documento les pone `archivo` con su enlace temporal. */
// deno-lint-ignore no-explicit-any
export async function conArchivos(admin: any, data: unknown): Promise<unknown> {
  const d = data as { mensajes?: Msj[] } | null
  const msgs = Array.isArray(d?.mensajes) ? d!.mensajes! : []
  const ids = msgs.filter((m) => esMarcadorArchivo(m.content) && typeof m.id === 'string').map((m) => m.id as string)
  if (!ids.length) return data
  try {
    const { data: filas } = await admin.from('cc_archivos').select('id, message_id, ruta, tipo, clase, bytes, nombre').in('message_id', ids)
    const lista = (filas ?? []) as Array<{ id: string; message_id: string; ruta: string; tipo: string; clase: string; bytes: number; nombre: string }>
    if (!lista.length) return data
    const { data: firmadas } = await admin.storage.from(BUCKET_ARCHIVOS).createSignedUrls(lista.map((a) => a.ruta), VIGENCIA_ENLACE_SEG)
    const url = new Map<string, string>(((firmadas ?? []) as Array<{ path: string; signedUrl: string }>).map((f) => [f.path, f.signedUrl]))
    const porMsj = new Map(lista.map((a) => [a.message_id, { id: a.id, url: url.get(a.ruta) ?? null, tipo: a.tipo, clase: a.clase, bytes: a.bytes, nombre: a.nombre }]))
    return { ...(d as Record<string, unknown>), mensajes: msgs.map((m) => (porMsj.has(m.id as string) ? { ...m, archivo: porMsj.get(m.id as string) } : m)) }
  } catch { return data }
}

/** CHAT PRO · ¿el otro lado está escribiendo? (su marca vence sola en unos segundos). */
export function escribiendoAhora(hastas: Array<string | null>, ahora = Date.now()): boolean {
  return hastas.some((h) => { const t = h ? Date.parse(h) : NaN; return Number.isFinite(t) && t > ahora })
}

/**
 * PALOMITAS · hasta qué mensaje leyó EL OTRO LADO de la conversación. Para el dueño (doctor o visitante) cuenta lo
 * que leyó su asesor; para el personal, lo que leyó el dueño (que Dirección lo lea no es que el cliente lo vio).
 * Se calcula después de que la base autorizó la lectura; nunca dice quién leyó, solo hasta dónde. Igual con
 * "escribiendo…": solo si el otro lado está tecleando, nunca qué.
 */
// deno-lint-ignore no-explicit-any
export async function conLecturaAjena(admin: any, conv: string, actor: string, data: unknown): Promise<unknown> {
  try {
    const roles = actor === 'visitor' || actor === 'doctor' ? ['asesor', 'supervisor'] : ['dueno']
    const { data: ps } = await admin.from('cc_participants').select('last_read_seq, rol, escribiendo_hasta').eq('conversation_id', conv).in('rol', roles)
    const filas = (ps ?? []) as Array<{ last_read_seq: number | null; escribiendo_hasta?: string | null }>
    const leido = filas.reduce((m, p) => Math.max(m, Number(p.last_read_seq ?? 0)), 0)
    return { ...(data as Record<string, unknown>), leido_otro: leido, escribiendo_otro: escribiendoAhora(filas.map((f) => f.escribiendo_hasta ?? null)) }
  } catch { return data }
}
