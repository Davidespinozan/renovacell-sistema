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
