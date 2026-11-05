// WHATSAPP (WA-2) · entrega lo que está en la cola de salida (cc_wa_salida) por la Cloud API de Meta. La base decide qué
// sale (solo modo activo, solo dentro de la ventana de 24 h) y reparte cada envío una sola vez (reclamar/resolver).
// Lo llaman el chat (al contestar), meta-webhook (tras la IA) y la tarea de cada minuto (reintentos). Nunca lanza.
// R4-B2-2 · antes de CADA POST se vuelve a preguntar a la base (pausa / canal fuera de activo → se retiene, no se envía);
// el resultado se clasifica (definitivo / reintentable / incierto) y un incierto nunca se reintenta.
import { configWA, cuerpoEscribiendo, cuerpoMedia, cuerpoTexto, MIME_IMAGEN, type MediaWA } from './whatsapp.ts'
import { esMarcadorArchivo, esMensajeConImagen } from './adjuntos.ts'
import { cuerpoUbicacion, leerUbicacion } from './ubicacion.ts'
import { clasificarEnvio, lineaResolucion, resultadoDeExcepcion, type ResultadoEnvio } from './salidaClase.ts'

export interface Despacho { enviados: number; fallidos: number; retenidos: number; inciertos: number }

// deno-lint-ignore no-explicit-any
/** R4-C8 · "leído" + "escribiendo…" para el mensaje del cliente mientras la IA prepara la respuesta. Mejor esfuerzo: sin
 *  llaves no hace nada; cualquier error o tardanza (> 3 s) se ignora y nunca bloquea ni cambia la respuesta. */
export async function mostrarEscribiendo(wamid: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const cfg = configWA((k) => Deno.env.get(k))
  if (!cfg || !wamid) return false
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3_000)
    const resp = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
      method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpoEscribiendo(wamid)),
    })
    clearTimeout(t); await resp.body?.cancel().catch(() => {})
    return resp.ok
  } catch { return false }
}

// R4-C13 · descarga el archivo del cliente para que la IA lo VEA en este turno (no se guarda en ningún lado). Dos pasos de la
// Cloud API: metadatos (url temporal, tipo y tamaño) y luego el binario con el mismo token. Límites: 3.5 MB imagen (≈ 4.7 MB en
// base64, bajo el tope de 5 MB por imagen del modelo), 10 MB PDF,
// 8 s por paso. Cualquier falla → null (la IA dice que un asesor lo revisa).
export interface AdjuntoIA { tipo: 'image' | 'document'; media_type: string; data: string }
export const MAX_IMAGEN = 3.5 * 1024 * 1024, MAX_PDF = 10 * 1024 * 1024
export async function descargarMedia(media: MediaWA, fetchImpl: typeof fetch = fetch): Promise<AdjuntoIA | null> {
  const cfg = configWA((k) => Deno.env.get(k))
  if (!cfg) return null
  const limite = media.tipo === 'image' ? MAX_IMAGEN : MAX_PDF
  const conTiempo = async (url: string) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8_000)
    try { return await fetchImpl(url, { signal: ctl.signal, headers: { Authorization: `Bearer ${cfg.token}` } }) } finally { clearTimeout(t) }
  }
  try {
    const meta = await conTiempo(`https://graph.facebook.com/${cfg.version}/${media.id}`)
    if (!meta.ok) return null
    const info = await meta.json().catch(() => null) as { url?: string; mime_type?: string; file_size?: number } | null
    const mime = String(info?.mime_type ?? media.mime).toLowerCase().split(';')[0].trim()
    const valido = media.tipo === 'image' ? MIME_IMAGEN.includes(mime) : mime === 'application/pdf'
    if (!info?.url || !/^https:\/\//.test(info.url) || !valido || Number(info.file_size ?? 0) > limite) return null
    const bin = await conTiempo(info.url)
    if (!bin.ok) return null
    const bytes = new Uint8Array(await bin.arrayBuffer())
    if (!bytes.length || bytes.length > limite) return null
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return { tipo: media.tipo, media_type: mime, data: btoa(s) }
  } catch { return null }
}

/** Archivo del mensaje (si lo tiene) con enlace temporal para que Meta lo descargue. null = sin archivo; 'error' = tiene
 *  archivo pero no se pudo firmar (no se manda el texto marcador en su lugar).
 *  CHAT-ARCHIVOS (3 nov 2026): también videos y documentos (cc_archivos). WhatsApp acepta video MP4/3GP de hasta 16 MB;
 *  uno más grande o de otro formato sale como documento (el cliente lo descarga igual). */
// deno-lint-ignore no-explicit-any
export async function adjuntoParaEnviar(admin: any, messageId: string | null | undefined): Promise<{ tipo: 'image' | 'document' | 'video'; enlace: string; nombre: string | null } | null | 'error'> {
  if (!messageId) return null
  let a: { ruta?: string; tipo?: string } | null = null
  try { a = (await admin.from('cc_adjuntos').select('ruta, tipo').eq('message_id', messageId).order('created_at').limit(1).maybeSingle()).data } catch { return null }
  if (!a?.ruta) return archivoParaEnviar(admin, messageId)
  try {
    const { data: f, error } = await admin.storage.from('chat').createSignedUrl(a.ruta, 15 * 60)
    if (error || !f?.signedUrl) return 'error'
    const tipo = String(a.tipo ?? '').startsWith('image/') ? 'image' : 'document'
    return { tipo, enlace: f.signedUrl, nombre: tipo === 'document' ? String(a.ruta).split('/').pop() ?? null : null }
  } catch { return 'error' }
}
export const MAX_VIDEO_WA = 16 * 1024 * 1024
export const tipoWA = (tipo: string, bytes: number): 'video' | 'document' => ((tipo === 'video/mp4' || tipo === 'video/3gpp') && bytes <= MAX_VIDEO_WA ? 'video' : 'document')
// deno-lint-ignore no-explicit-any
async function archivoParaEnviar(admin: any, messageId: string): Promise<{ tipo: 'document' | 'video'; enlace: string; nombre: string | null } | null | 'error'> {
  let a: { ruta?: string; tipo?: string; bytes?: number; nombre?: string } | null = null
  try { a = (await admin.from('cc_archivos').select('ruta, tipo, bytes, nombre').eq('message_id', messageId).maybeSingle()).data } catch { return null }
  if (!a?.ruta) return null
  try {
    const { data: f, error } = await admin.storage.from('chat_archivos').createSignedUrl(a.ruta, 15 * 60)
    if (error || !f?.signedUrl) return 'error'
    const tipo = tipoWA(String(a.tipo ?? ''), Number(a.bytes ?? 0))
    return { tipo, enlace: f.signedUrl, nombre: tipo === 'document' ? (a.nombre || String(a.ruta).split('/').pop() || null) : null }
  } catch { return 'error' }
}

export async function despacharWhatsApp(admin: any, fetchImpl: typeof fetch = fetch): Promise<Despacho> {
  const cfg = configWA((k) => Deno.env.get(k))
  const r: Despacho = { enviados: 0, fallidos: 0, retenidos: 0, inciertos: 0 }
  if (!cfg) return r
  const resolver = (id: string, res: ResultadoEnvio | { ok: false; clase: 'retener'; detalle: string }) =>
    admin.rpc('cc_wa_salida_resolver', { p_id: id, p_ok: res.ok, p_wamid: res.ok ? res.id : null, p_error: res.ok ? null : lineaResolucion(res.clase, res.detalle) }).then(() => {}, () => {})
  try {
    const { data: lote, error } = await admin.rpc('cc_wa_salida_reclamar', { p_limite: 20 })
    if (error || !Array.isArray(lote)) return r
    for (const s of lote as Array<{ id: string; wa_id: string; texto: string; message_id?: string | null }>) {
      // justo antes del POST: si se pausó (o el canal dejó de estar activo) desde el reclamo, este mensaje NO sale
      const puede = await admin.rpc('cc_wa_salida_puede_enviar', { p_id: s.id }).then((x: { data: unknown; error: unknown }) => x, () => ({ data: null, error: true }))
      if (puede.error || puede.data !== true) { await resolver(s.id, { ok: false, clase: 'retener', detalle: 'canal pausado o fuera de activo antes del envío' }); r.retenidos++; continue }
      // FOTOS AL CLIENTE (2 nov 2026) · si el mensaje lleva un archivo, sale el archivo (enlace temporal de 15 min del bucket
      // privado `chat`); antes solo salía el texto "Envió una imagen." y el cliente nunca veía la foto.
      const media = await adjuntoParaEnviar(admin, s.message_id)
      if (media === 'error') { await resolver(s.id, { ok: false, clase: 'definitivo', detalle: 'no se pudo preparar el archivo para enviarlo' }); r.fallidos++; continue }
      // UBICACIÓN EN EL CHAT · «📍 …» con coordenadas sale como ubicación nativa (pin); sin coordenadas, como texto con su enlace.
      const ubic = media ? null : leerUbicacion(s.texto)
      const cuerpoEnvio = media ? cuerpoMedia(s.wa_id, media.tipo, media.enlace, esMensajeConImagen(s.texto) || esMarcadorArchivo(s.texto) ? null : s.texto, media.nombre)
        : (ubic && cuerpoUbicacion(s.wa_id, ubic)) || cuerpoTexto(s.wa_id, s.texto)
      let res: ResultadoEnvio
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000)
        const resp = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpoEnvio),
        })
        clearTimeout(t)
        const cuerpo = await resp.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null
        res = clasificarEnvio(resp.status, cuerpo, cuerpo?.messages?.[0]?.id)
      } catch (e) { res = resultadoDeExcepcion(e) }
      await resolver(s.id, res)
      if (res.ok) r.enviados++; else if (res.clase === 'incierto') r.inciertos++; else r.fallidos++
    }
  } catch { /* la cola queda para la siguiente vuelta */ }
  return r
}
