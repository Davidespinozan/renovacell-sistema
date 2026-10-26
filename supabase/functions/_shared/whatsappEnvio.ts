// WHATSAPP (WA-2) · entrega lo que está en la cola de salida (cc_wa_salida) por la Cloud API de Meta. La base decide qué
// sale (solo modo activo, solo dentro de la ventana de 24 h) y reparte cada envío una sola vez (reclamar/resolver).
// Lo llaman el chat (al contestar), meta-webhook (tras la IA) y la tarea de cada minuto (reintentos). Nunca lanza.
// R4-B2-2 · antes de CADA POST se vuelve a preguntar a la base (pausa / canal fuera de activo → se retiene, no se envía);
// el resultado se clasifica (definitivo / reintentable / incierto) y un incierto nunca se reintenta.
import { configWA, cuerpoTexto } from './whatsapp.ts'
import { clasificarEnvio, lineaResolucion, resultadoDeExcepcion, type ResultadoEnvio } from './salidaClase.ts'

export interface Despacho { enviados: number; fallidos: number; retenidos: number; inciertos: number }

// deno-lint-ignore no-explicit-any
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
