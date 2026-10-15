// META (Instagram + Messenger) · entrega lo que está en la cola de salida (cc_meta_salida) por el Send API de la
// página. La base decide qué sale (solo canal en modo activo, solo dentro de la ventana de 24 h) y reparte cada envío
// una sola vez (reclamar/resolver). Lo llaman el chat (al contestar), meta-webhook (tras la IA) y la tarea de cada
// minuto (reintentos). Nunca lanza.
import { configMeta, cuerpoMeta, leerRespuestaMeta, nombreDePerfil, urlPerfil, type CanalMeta } from './meta.ts'

// deno-lint-ignore no-explicit-any
export async function despacharMeta(admin: any, fetchImpl: typeof fetch = fetch): Promise<{ enviados: number; fallidos: number }> {
  const cfg = configMeta((k) => Deno.env.get(k))
  const r = { enviados: 0, fallidos: 0 }
  if (!cfg) return r
  try {
    const { data: lote, error } = await admin.rpc('cc_meta_salida_reclamar', { p_limite: 20 })
    if (error || !Array.isArray(lote)) return r
    for (const s of lote as Array<{ id: string; canal: CanalMeta; psid: string; texto: string }>) {
      let res: { ok: true; mid: string } | { ok: false; error: string }
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000)
        const resp = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${cfg.pageId}/messages`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpoMeta(s.canal, s.psid, s.texto)),
        })
        clearTimeout(t)
        res = leerRespuestaMeta(resp.status, await resp.json().catch(() => null))
      } catch (e) { res = { ok: false, error: (e as Error)?.name === 'AbortError' ? 'sin respuesta de Meta (timeout)' : 'sin respuesta de Meta' } }
      await admin.rpc('cc_meta_salida_resolver', { p_id: s.id, p_ok: res.ok, p_mid: res.ok ? res.mid : null, p_error: res.ok ? null : res.error }).then(() => {}, () => {})
      if (res.ok) r.enviados++; else r.fallidos++
    }
  } catch { /* la cola queda para la siguiente vuelta */ }
  return r
}

/** Nombre del contacto (best effort, 4 s): Meta no lo manda con el mensaje. Si no se consigue, queda "Contacto". */
// deno-lint-ignore no-explicit-any
export async function completarNombreMeta(admin: any, canal: CanalMeta, psid: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const cfg = configMeta((k) => Deno.env.get(k))
  if (!cfg) return
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4_000)
    const resp = await fetchImpl(urlPerfil(canal, psid, cfg), { headers: { Authorization: `Bearer ${cfg.token}` }, signal: ctl.signal })
    clearTimeout(t)
    if (!resp.ok) return
    const nombre = nombreDePerfil(await resp.json().catch(() => null))
    if (nombre) await admin.rpc('cc_meta_nombre', { p_canal: canal, p_psid: psid, p_nombre: nombre }).then(() => {}, () => {})
  } catch { /* sin nombre no pasa nada */ }
}
