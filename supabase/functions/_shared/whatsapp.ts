// WHATSAPP (WA-1) · piezas puras del canal: leer los mensajes entrantes del payload de Meta (Cloud API) y el modo del
// canal. Sin red ni base de datos: se prueban en vitest.

export interface EntranteWA { wa_id: string; nombre: string; wamid: string; texto: string }

const ETIQUETA: Record<string, string> = {
  image: 'Envió una imagen por WhatsApp.', audio: 'Envió un audio por WhatsApp.', voice: 'Envió un audio por WhatsApp.',
  video: 'Envió un video por WhatsApp.', document: 'Envió un documento por WhatsApp.', sticker: 'Envió un sticker por WhatsApp.',
  location: 'Compartió una ubicación por WhatsApp.', contacts: 'Compartió un contacto por WhatsApp.',
}

/** Mensajes ENTRANTES de WhatsApp (entry[].changes[].value.messages[]). Ignora acuses (statuses) y lo que no trae wamid. */
export function extraerWhatsApp(payload: unknown): EntranteWA[] {
  const out: EntranteWA[] = []
  const p = (payload ?? {}) as Record<string, unknown>
  if (p.object !== 'whatsapp_business_account') return out
  for (const entry of (Array.isArray(p.entry) ? p.entry : []) as Record<string, unknown>[]) {
    for (const change of (Array.isArray(entry.changes) ? entry.changes : []) as Record<string, unknown>[]) {
      const v = (change.value ?? {}) as Record<string, unknown>
      const nombres = new Map<string, string>()
      for (const c of (Array.isArray(v.contacts) ? v.contacts : []) as Record<string, unknown>[]) {
        const wa = String(c?.wa_id ?? ''); if (wa) nombres.set(wa, String((c?.profile as Record<string, unknown>)?.name ?? ''))
      }
      for (const m of (Array.isArray(v.messages) ? v.messages : []) as Record<string, unknown>[]) {
        const wa_id = String(m.from ?? '').replace(/\D/g, ''); const wamid = String(m.id ?? '')
        if (!/^[0-9]{8,15}$/.test(wa_id) || wamid.length < 8) continue
        const tipo = String(m.type ?? 'text')
        let texto = ''
        if (tipo === 'text') texto = String((m.text as Record<string, unknown>)?.body ?? '')
        else if (tipo === 'button') texto = String((m.button as Record<string, unknown>)?.text ?? '')
        else if (tipo === 'interactive') {
          const i = (m.interactive ?? {}) as Record<string, Record<string, unknown> | undefined>
          texto = String(i.button_reply?.title ?? i.list_reply?.title ?? '')
        }
        const pie = String(((m as Record<string, Record<string, unknown>>)[tipo])?.caption ?? '').trim()
        if (!texto.trim()) texto = (ETIQUETA[tipo] ?? 'Envió un mensaje por WhatsApp.') + (pie ? ` «${pie}»` : '')
        out.push({ wa_id, nombre: (nombres.get(wa_id) ?? '').trim().slice(0, 120), wamid: wamid.slice(0, 200), texto: texto.slice(0, 4000) })
      }
    }
  }
  return out
}

/** espejo (por defecto): solo registra en Conversaciones. activo: además entra a la cola de su vendedora o Dirección. */
export function modoWhatsApp(env: (k: string) => string | undefined): 'espejo' | 'activo' {
  return (env('WA_MODO') ?? '').trim().toLowerCase() === 'activo' ? 'activo' : 'espejo'
}

// ── WA-2 · salida ─────────────────────────────────────────────────────────────────────────────────
export interface ConfigWA { token: string; phoneId: string; version: string }
/** Llaves de envío (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID). Sin ellas no se manda nada (falla cerrado). */
export function configWA(env: (k: string) => string | undefined): ConfigWA | null {
  const token = (env('WHATSAPP_TOKEN') ?? '').trim(); const phoneId = (env('WHATSAPP_PHONE_ID') ?? '').trim()
  return token && /^[0-9]{5,30}$/.test(phoneId) ? { token, phoneId, version: (env('META_GRAPH_VERSION') ?? 'v21.0').trim() } : null
}
/** Cuerpo de un mensaje de texto de la Cloud API (vista previa de enlaces activada). */
export function cuerpoTexto(para: string, texto: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: true, body: texto.slice(0, 4096) } }
}
/** R4-C8 · marca el mensaje del cliente como leído y muestra "escribiendo…" (hasta 25 s o hasta la respuesta). No es un mensaje. */
export function cuerpoEscribiendo(wamid: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', status: 'read', message_id: wamid, typing_indicator: { type: 'text' } }
}
/** Lee la respuesta de Meta: wamid si se aceptó; si no, el error en una línea (sin datos del token). */
export function leerRespuestaEnvio(status: number, cuerpo: unknown): { ok: true; wamid: string } | { ok: false; error: string } {
  const c = (cuerpo ?? {}) as { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number } }
  const wamid = c.messages?.[0]?.id
  if (status >= 200 && status < 300 && wamid) return { ok: true, wamid }
  return { ok: false, error: `Meta ${status}${c.error?.code ? ` (${c.error.code})` : ''}: ${(c.error?.message ?? 'sin detalle').slice(0, 200)}` }
}
/** Acuses de entrega (statuses): sent | delivered | read | failed de NUESTROS mensajes. */
export function extraerEstados(payload: unknown): Array<{ wamid: string; estado: string; error: string | null }> {
  const out: Array<{ wamid: string; estado: string; error: string | null }> = []
  const p = (payload ?? {}) as Record<string, unknown>
  if (p.object !== 'whatsapp_business_account') return out
  for (const entry of (Array.isArray(p.entry) ? p.entry : []) as Record<string, unknown>[]) {
    for (const change of (Array.isArray(entry.changes) ? entry.changes : []) as Record<string, unknown>[]) {
      const v = (change.value ?? {}) as Record<string, unknown>
      for (const s of (Array.isArray(v.statuses) ? v.statuses : []) as Record<string, unknown>[]) {
        const wamid = String(s.id ?? ''); const estado = String(s.status ?? '')
        if (wamid.length < 8 || !['sent', 'delivered', 'read', 'failed'].includes(estado)) continue
        const e = (Array.isArray(s.errors) ? s.errors[0] : null) as { title?: string; message?: string } | null
        out.push({ wamid, estado, error: e ? String(e.message ?? e.title ?? '').slice(0, 200) : null })
      }
    }
  }
  return out
}
