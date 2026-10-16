// META (Instagram + Messenger) · piezas puras del canal: leer los mensajes entrantes del webhook de Meta (objetos
// `instagram` y `page`), las llaves de envío y el cuerpo/respuesta del Send API. Sin red ni base: se prueban en vitest.
// Diseño igual al de WhatsApp (_shared/whatsapp.ts): un contacto es un PSID de la página, nunca un teléfono.

export type CanalMeta = 'instagram' | 'messenger'
export interface EntranteMeta { canal: CanalMeta; psid: string; mid: string; texto: string; destino: string }

const NOMBRE: Record<CanalMeta, string> = { instagram: 'Instagram', messenger: 'Facebook' }
const ETIQUETA: Record<string, string> = {
  image: 'Envió una imagen por', video: 'Envió un video por', audio: 'Envió un audio por', file: 'Envió un archivo por',
  share: 'Compartió una publicación por', story_mention: 'Te mencionó en una historia de', reel: 'Compartió un reel por',
  ig_reel: 'Compartió un reel por', template: 'Envió un mensaje por', fallback: 'Envió un mensaje por', location: 'Compartió una ubicación por',
}

/** Mensajes ENTRANTES de Instagram (object=instagram) y Messenger (object=page): entry[].messaging[]. Ignora los ecos
 *  (lo que la página mandó), las lecturas/entregas y lo que no trae PSID o mid. */
export function extraerMeta(payload: unknown): EntranteMeta[] {
  const out: EntranteMeta[] = []
  const p = (payload ?? {}) as Record<string, unknown>
  const canal: CanalMeta | null = p.object === 'instagram' ? 'instagram' : p.object === 'page' ? 'messenger' : null
  if (!canal) return out
  for (const entry of (Array.isArray(p.entry) ? p.entry : []) as Record<string, unknown>[]) {
    if (String(entry.id ?? '') === '0') continue   // la prueba del panel de Meta (entry.id "0", remitente inventado): no se guarda como contacto
    // Un DM real llega en entry[].messaging[]; la prueba del panel de Meta (y algún producto) lo manda como
    // entry[].changes[] con field "messages" y el mismo contenido en value. Se aceptan los dos.
    const eventos: Record<string, unknown>[] = [...((Array.isArray(entry.messaging) ? entry.messaging : []) as Record<string, unknown>[])]
    for (const ch of (Array.isArray(entry.changes) ? entry.changes : []) as Record<string, unknown>[]) {
      if (ch.field === 'messages' && ch.value && typeof ch.value === 'object') eventos.push(ch.value as Record<string, unknown>)
    }
    for (const ev of eventos) {
      const m = ev.message as Record<string, unknown> | undefined
      if (!m || m.is_echo === true) continue
      const psid = String((ev.sender as Record<string, unknown>)?.id ?? '').trim()
      const mid = String(m.mid ?? '').trim()
      if (!/^[0-9]{5,40}$/.test(psid) || mid.length < 8) continue
      let texto = String(m.text ?? '')
      if (!texto.trim()) {
        const a = (Array.isArray(m.attachments) ? m.attachments[0] : null) as Record<string, unknown> | null
        const tipo = String(a?.type ?? 'fallback')
        texto = `${ETIQUETA[tipo] ?? 'Envió un mensaje por'} ${NOMBRE[canal]}.`
      }
      out.push({ canal, psid, mid: mid.slice(0, 200), texto: texto.slice(0, 4000), destino: String((ev.recipient as Record<string, unknown>)?.id ?? '') })
    }
  }
  return out
}

// ── salida ───────────────────────────────────────────────────────────────────────────────────────
export interface ConfigMeta { token: string; pageId: string; version: string }
/** Llaves de envío (META_PAGE_TOKEN, META_PAGE_ID). Sin ellas no se manda nada (falla cerrado). */
export function configMeta(env: (k: string) => string | undefined): ConfigMeta | null {
  const token = (env('META_PAGE_TOKEN') ?? '').trim(); const pageId = (env('META_PAGE_ID') ?? '').trim()
  return token && /^[0-9]{5,30}$/.test(pageId) ? { token, pageId, version: (env('META_GRAPH_VERSION') ?? 'v21.0').trim() } : null
}
/** Cuerpo del Send API (Messenger e Instagram): respuesta dentro de la ventana de 24 h. Instagram acepta hasta 1000 caracteres. */
export function cuerpoMeta(canal: CanalMeta, psid: string, texto: string): Record<string, unknown> {
  return { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: texto.slice(0, canal === 'instagram' ? 1000 : 2000) } }
}
/** Lee la respuesta de Meta: mid si se aceptó; si no, el error en una línea (sin datos del token). */
export function leerRespuestaMeta(status: number, cuerpo: unknown): { ok: true; mid: string } | { ok: false; error: string } {
  const c = (cuerpo ?? {}) as { message_id?: string; error?: { message?: string; code?: number } }
  if (status >= 200 && status < 300 && c.message_id) return { ok: true, mid: c.message_id }
  return { ok: false, error: `Meta ${status}${c.error?.code ? ` (${c.error.code})` : ''}: ${(c.error?.message ?? 'sin detalle').slice(0, 200)}` }
}
/** Nombre del contacto, que Meta no manda con el mensaje: GET /{psid}?fields=name (Messenger) o username (Instagram). */
export function urlPerfil(canal: CanalMeta, psid: string, cfg: ConfigMeta): string {
  return `https://graph.facebook.com/${cfg.version}/${psid}?fields=${canal === 'instagram' ? 'name,username' : 'name'}`
}
export function nombreDePerfil(cuerpo: unknown): string {
  const c = (cuerpo ?? {}) as { name?: string; username?: string; first_name?: string; last_name?: string }
  return (c.name || [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.username ? '@' + c.username : '')).trim().slice(0, 120)
}
