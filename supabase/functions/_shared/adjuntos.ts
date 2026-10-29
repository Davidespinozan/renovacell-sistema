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
