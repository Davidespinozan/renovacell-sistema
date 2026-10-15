// FOTOS EN EL CHAT · piezas compartidas de la Edge `chat`. La imagen viaja como un mensaje normal con este texto
// (lo que ven la IA, los avisos y el historial); el archivo vive en el bucket privado `chat` y solo se entrega con
// enlaces temporales a quien YA está leyendo esa conversación.

export const TEXTO_IMAGEN = 'Envió una imagen.'
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
  const ids = msgs.filter((m) => m.content === TEXTO_IMAGEN && typeof m.id === 'string').map((m) => m.id as string)
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

/**
 * PALOMITAS · hasta qué mensaje leyó EL OTRO LADO de la conversación. Para el dueño (doctor o visitante) cuenta lo
 * que leyó su asesor; para el personal, lo que leyó el dueño (que Dirección lo lea no es que el cliente lo vio).
 * Se calcula después de que la base autorizó la lectura; nunca dice quién leyó, solo hasta dónde.
 */
// deno-lint-ignore no-explicit-any
export async function conLecturaAjena(admin: any, conv: string, actor: string, data: unknown): Promise<unknown> {
  try {
    const roles = actor === 'visitor' || actor === 'doctor' ? ['asesor', 'supervisor'] : ['dueno']
    const { data: ps } = await admin.from('cc_participants').select('last_read_seq, rol').eq('conversation_id', conv).in('rol', roles)
    const leido = ((ps ?? []) as Array<{ last_read_seq: number | null }>).reduce((m, p) => Math.max(m, Number(p.last_read_seq ?? 0)), 0)
    return { ...(data as Record<string, unknown>), leido_otro: leido }
  } catch { return data }
}
