// WHATSAPP (WA-2) · entrega lo que está en la cola de salida (cc_wa_salida) por la Cloud API de Meta. La base decide qué
// sale (solo modo activo, solo dentro de la ventana de 24 h) y reparte cada envío una sola vez (reclamar/resolver).
// Lo llaman el chat (al contestar), meta-webhook (tras la IA) y la tarea de cada minuto (reintentos). Nunca lanza.
import { configWA, cuerpoTexto, leerRespuestaEnvio } from './whatsapp.ts'

// deno-lint-ignore no-explicit-any
export async function despacharWhatsApp(admin: any, fetchImpl: typeof fetch = fetch): Promise<{ enviados: number; fallidos: number }> {
  const cfg = configWA((k) => Deno.env.get(k))
  const r = { enviados: 0, fallidos: 0 }
  if (!cfg) return r
  try {
    const { data: lote, error } = await admin.rpc('cc_wa_salida_reclamar', { p_limite: 20 })
    if (error || !Array.isArray(lote)) return r
    for (const s of lote as Array<{ id: string; wa_id: string; texto: string }>) {
      let res: { ok: true; wamid: string } | { ok: false; error: string }
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000)
        const resp = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
          method: 'POST', signal: ctl.signal,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpoTexto(s.wa_id, s.texto)),
        })
        clearTimeout(t)
        res = leerRespuestaEnvio(resp.status, await resp.json().catch(() => null))
      } catch (e) { res = { ok: false, error: (e as Error)?.name === 'AbortError' ? 'sin respuesta de Meta (timeout)' : 'sin respuesta de Meta' } }
      await admin.rpc('cc_wa_salida_resolver', { p_id: s.id, p_ok: res.ok, p_wamid: res.ok ? res.wamid : null, p_error: res.ok ? null : res.error }).then(() => {}, () => {})
      if (res.ok) r.enviados++; else r.fallidos++
    }
  } catch { /* la cola queda para la siguiente vuelta */ }
  return r
}
