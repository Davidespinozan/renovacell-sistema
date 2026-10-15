// AVISOS PUSH del chat, compartidos por la Edge chat y la de WhatsApp: tras un mensaje humano avisa al teléfono del otro
// lado (asesor ↔ cliente). Nunca bloquea ni rompe el envío.
import { configPush, destinosDe, armarAviso, enviarAvisos } from './push.ts'
import webpush from 'npm:web-push@3.6.7'

// deno-lint-ignore no-explicit-any
export function enSegundoPlano(p: Promise<unknown>) { const er = (globalThis as any).EdgeRuntime; if (er?.waitUntil) er.waitUntil(p.catch(() => {})); else void p.catch(() => {}) }
// deno-lint-ignore no-explicit-any
export async function avisarPush(admin: any, conv: string, actor: string, texto: string): Promise<void> {
  const cfg = configPush((k) => Deno.env.get(k))
  if (!cfg) return
  const { data: c } = await admin.from('cc_conversations').select('profile_id, visitor_id, seller_profile_id').eq('id', conv).maybeSingle()
  if (!c) return
  const d = destinosDe(actor, c)
  if (!d) return
  const { data: destinos } = await admin.rpc('push_destinos', { p_profiles: d.perfiles, p_visitors: d.visitantes })
  if (!destinos?.length) return
  let remitente = 'Renovacell'
  if (d.para === 'personal') {
    const { data: n } = await admin.rpc('_cc_nombre_dueno', { p_conv: conv })
    remitente = typeof n === 'string' ? n.replace(/\s*\([^)]*\)\s*$/, '') : 'Tu cliente'
  } else if (c.seller_profile_id) {
    const { data: s } = await admin.from('profiles').select('full_name, meta').eq('id', c.seller_profile_id).maybeSingle()
    remitente = ((s?.meta?.name as string | undefined) ?? s?.full_name ?? 'Tu asesora').split('·')[0].trim()
  }
  webpush.setVapidDetails(cfg.sujeto, cfg.publica, cfg.privada)
  await enviarAvisos(admin, (sub, carga) => webpush.sendNotification(sub, carga, { TTL: 3600, urgency: 'high' }), destinos,
    armarAviso({ para: d.para, remitente, texto, conv, visitante: !c.profile_id }))
}
