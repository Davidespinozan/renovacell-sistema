// WHATSAPP (WA-2) · entrega lo que está en la cola de salida (cc_wa_salida) por la Cloud API de Meta. La base decide qué
// sale (solo modo activo, solo dentro de la ventana de 24 h) y reparte cada envío una sola vez (reclamar/resolver).
// Lo llaman el chat (al contestar), meta-webhook (tras la IA) y la tarea de cada minuto (reintentos). Nunca lanza.
// R4-B2-2 · antes de CADA POST se vuelve a preguntar a la base (pausa / canal fuera de activo → se retiene, no se envía);
// el resultado se clasifica (definitivo / reintentable / incierto) y un incierto nunca se reintenta.
import { configWA, cuerpoEscribiendo, cuerpoTexto, MIME_IMAGEN, type MediaWA } from './whatsapp.ts'
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

export async function despacharWhatsApp(admin: any, fetchImpl: typeof fetch = fetch): Promise<Despacho> {
  const cfg = configWA((k) => Deno.env.get(k))
  const r: Despacho = { enviados: 0, fallidos: 0, retenidos: 0, inciertos: 0 }
  if (!cfg) return r
  const resolver = (id: string, res: ResultadoEnvio | { ok: false; clase: 'retener'; detalle: string }) =>
    admin.rpc('cc_wa_salida_resolver', { p_id: id, p_ok: res.ok, p_wamid: res.ok ? res.id : null, p_error: res.ok ? null : lineaResolucion(res.clase, res.detalle) }).then(() => {}, () => {})
  try {
    const { data: lote, error } = await admin.rpc('cc_wa_salida_reclamar', { p_limite: 20 })
    if (error || !Array.isArray(lote)) return r
    for (const s of lote as Array<{ id: string; wa_id: string; texto: string }>) {
      // justo antes del POST: si se pausó (o el canal dejó de estar activo) desde el reclamo, este mensaje NO sale
      const puede = await admin.rpc('cc_wa_salida_puede_enviar', { p_id: s.id }).then((x: { data: unknown; error: unknown }) => x, () => ({ data: null, error: true }))
      if (puede.error || puede.data !== true) { await resolver(s.id, { ok: false, clase: 'retener', detalle: 'canal pausado o fuera de activo antes del envío' }); r.retenidos++; continue }
      let res: ResultadoEnvio
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000)
        const resp = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpoTexto(s.wa_id, s.texto)),
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
