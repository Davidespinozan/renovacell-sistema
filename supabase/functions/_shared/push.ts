// AVISOS PUSH · lógica compartida (pura salvo el envío, que se inyecta). Web Push estándar con llaves VAPID.
// Sin llaves configuradas no se manda nada (falla cerrado). El aviso lleva solo quién escribió y el inicio del texto.

export interface ConfigPush { publica: string; privada: string; sujeto: string }
export function configPush(env: (k: string) => string | undefined): ConfigPush | null {
  const publica = (env('VAPID_PUBLIC_KEY') ?? '').trim(); const privada = (env('VAPID_PRIVATE_KEY') ?? '').trim(); const sujeto = (env('VAPID_SUBJECT') ?? '').trim()
  return publica && privada && /^(mailto:|https:)/.test(sujeto) ? { publica, privada, sujeto } : null
}

export interface Destinos { perfiles: string[]; visitantes: string[]; para: 'cliente' | 'personal' }
/** Quién debe enterarse de un mensaje humano: si escribió el cliente, su asesor; si escribió el personal, el cliente. */
export function destinosDe(actor: string, c: { profile_id: string | null; visitor_id: string | null; seller_profile_id: string | null }): Destinos | null {
  if (actor === 'visitor' || actor === 'doctor') return c.seller_profile_id ? { perfiles: [c.seller_profile_id], visitantes: [], para: 'personal' } : null
  if (actor === 'seller' || actor === 'admin') {
    if (c.profile_id) return { perfiles: [c.profile_id], visitantes: [], para: 'cliente' }
    if (c.visitor_id) return { perfiles: [], visitantes: [c.visitor_id], para: 'cliente' }
  }
  return null   // asistente y sistema: no se avisa (la persona suele estar en la conversación)
}

export interface Aviso { title: string; body: string; url: string; tag: string }
export function armarAviso(o: { para: 'cliente' | 'personal'; remitente: string; texto: string; conv: string; visitante: boolean }): Aviso {
  const recorte = o.texto.replace(/\s+/g, ' ').trim()
  const body = `${o.remitente.trim() || 'Renovacell'}: ${recorte.length > 110 ? recorte.slice(0, 107) + '…' : recorte}`
  const url = o.para === 'personal' ? 'https://sistema.renovacell.mx/sistema' : o.visitante ? 'https://renovacell.mx/contacto' : 'https://sistema.renovacell.mx/sistema'
  return { title: o.para === 'personal' ? 'Mensaje de un cliente' : 'Renovacell', body, url, tag: `rc-chat-${o.conv}` }
}

export type EnviarPush = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, carga: string) => Promise<{ statusCode?: number }>
/** Manda a cada dispositivo y deja el resultado (404/410 = la dirección ya no existe: se apaga). Nunca lanza. */
// deno-lint-ignore no-explicit-any
export async function enviarAvisos(admin: any, enviar: EnviarPush, destinos: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>, aviso: Aviso): Promise<number> {
  let ok = 0
  const carga = JSON.stringify(aviso)
  await Promise.all(destinos.map(async (d) => {
    try {
      await enviar({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, carga)
      ok++; await admin.rpc('push_resultado', { p_id: d.id, p_ok: true, p_baja: false }).then(() => {}, () => {})
    } catch (e) {
      const st = Number((e as { statusCode?: number })?.statusCode ?? 0)
      await admin.rpc('push_resultado', { p_id: d.id, p_ok: false, p_baja: st === 404 || st === 410 }).then(() => {}, () => {})
    }
  }))
  return ok
}
