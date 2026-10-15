// Edge Function PÚBLICA: WEBHOOK de Meta (WhatsApp Cloud API + Messenger + Instagram).
// Es el reemplazo DIRECTO de Leadsales: los mensajes de los tres canales llegan aquí de la
// mano de Meta —sin intermediario que cobre suscripción— y entran a Conversaciones (el chat
// canónico): WhatsApp por cc_wa_entrante (167/168) e Instagram/Messenger por cc_meta_entrante (170).
//
// FLUJO
//   GET  → verificación de suscripción de Meta (hub.challenge). Se hace una vez al
//          conectar el webhook en el panel de Meta.
//   POST → mensajes entrantes. Verificamos la firma (X-Hub-Signature-256) y cada mensaje entra
//          por su identificador (wamid / mid): un reintento de Meta nunca duplica. El modo
//          (espejo | activo) lo decide la base por canal.
//
// SEAM (listo-para-credencial, como el resto de integraciones): sin META_VERIFY_TOKEN
// y META_APP_SECRET la función responde 501. Al pegar los secrets del app de Meta del
// cliente, se enciende — sin tocar código. Nada de esto usa Leadsales.
//
// IMPORTANTE al desplegar: --no-verify-jwt (Meta no manda JWT de Supabase).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { observador } from '../_shared/observa.ts'
import { extraerWhatsApp, extraerEstados } from '../_shared/whatsapp.ts'
import { despacharWhatsApp } from '../_shared/whatsappEnvio.ts'
import { extraerMeta } from '../_shared/meta.ts'
import { completarNombreMeta, despacharMeta } from '../_shared/metaEnvio.ts'
import { responderIA } from '../_shared/ia/responder.ts'
import { avisarPush, enSegundoPlano } from '../_shared/avisoChat.ts'
import { IA_PUEDE } from '../_shared/chat.ts'

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('meta-webhook')

// Firma HMAC-SHA256 del cuerpo con el App Secret. Meta la manda en 'sha256=<hex>'.
// Comparación en tiempo (casi) constante para no filtrar por temporización.
async function validSignature(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const expected = `sha256=${hex}`
  if (header.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  const verifyToken = Deno.env.get('META_VERIFY_TOKEN')
  const appSecret = Deno.env.get('META_APP_SECRET')
  // Seam: sin credenciales del app de Meta, dormida (inofensiva).
  if (!verifyToken || !appSecret) return new Response('Meta no configurado', { status: 501 })

  // ── Verificación de suscripción (Meta la llama al conectar el webhook) ──
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const mode = u.searchParams.get('hub.mode')
    const token = u.searchParams.get('hub.verify_token')
    const challenge = u.searchParams.get('hub.challenge')
    if (mode === 'subscribe' && token === verifyToken) return new Response(challenge ?? '', { status: 200 })
    return new Response('Verificación fallida', { status: 403 })
  }

  if (req.method !== 'POST') return new Response('método no permitido', { status: 405 })

  // ── Mensaje entrante: firma + parseo ──
  const body = await req.text()
  if (!(await validSignature(body, req.headers.get('x-hub-signature-256'), appSecret))) {
    return new Response('Firma inválida', { status: 401 })
  }
  let payload: Record<string, unknown>
  try { payload = JSON.parse(body) } catch { return new Response('JSON inválido', { status: 400 }) }

  try {
  // ── WA-1 · WhatsApp → conversación canónica (Conversaciones). Cada mensaje por su wamid: un reintento de Meta no
  //    duplica. Si la base falla, 500 para que Meta reintente (antes respondía 200 y el mensaje se perdía).
  //    El modo (espejo | activo) lo decide la base (cc_wa_config). En activo: aviso al teléfono de su vendedora, la IA
  //    contesta como en el chat y la respuesta sale por WhatsApp; todo DESPUÉS de responder a Meta (no la hace esperar).
  const wa = extraerWhatsApp(payload)
  const estados = extraerEstados(payload)
  if (wa.length > 0 || estados.length > 0) {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    for (const e of estados) await admin.rpc('cc_wa_estado', { p_wamid: e.wamid, p_estado: e.estado, p_error: e.error }).then(() => {}, () => {})
    for (const m of wa) {
      const { data, error } = await admin.rpc('cc_wa_entrante', { p_wa_id: m.wa_id, p_nombre: m.nombre || null, p_wamid: m.wamid, p_texto: m.texto, p_encolar: false })
      if (error) { obs('whatsapp', 'internal_error', { code: 'cc_wa_entrante', error }); return new Response('reintentar', { status: 500 }) }
      const r = data as { duplicado: boolean; conversation_id: string; seq: number; actor: 'visitor' | 'doctor'; profile_id: string | null; visitor_hash: string | null; activo: boolean; modo: string }
      if (r.duplicado || !r.activo) continue
      enSegundoPlano((async () => {
        await avisarPush(admin, r.conversation_id, r.actor, m.texto)
        if (IA_PUEDE(r.modo as never)) {
          const ia = await responderIA(admin, r.conversation_id, r.seq, r.actor, r.profile_id, r.visitor_hash, m.texto, 'wa:' + m.wa_id)
          if (ia === 'respondio') await despacharWhatsApp(admin)
        }
      })())
    }
  }

  // ── META-CANALES (170) · Instagram y Messenger → la misma conversación canónica, por su mid. En activo: aviso al
  //    teléfono de su vendedora, la IA contesta y la respuesta sale por el mismo canal; todo DESPUÉS de responder a Meta.
  const mt = extraerMeta(payload)
  if (mt.length > 0) {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    for (const m of mt) {
      const { data, error } = await admin.rpc('cc_meta_entrante', { p_canal: m.canal, p_psid: m.psid, p_nombre: null, p_mid: m.mid, p_texto: m.texto, p_encolar: false })
      if (error) { obs('meta', 'internal_error', { code: 'cc_meta_entrante', error }); return new Response('reintentar', { status: 500 }) }
      const r = data as { duplicado: boolean; conversation_id: string; seq: number; visitor_hash: string | null; nuevo: boolean; activo: boolean; modo: string }
      if (r.duplicado) continue
      enSegundoPlano((async () => {
        if (r.nuevo) await completarNombreMeta(admin, m.canal, m.psid)   // Meta no manda el nombre con el mensaje
        if (!r.activo) return
        await avisarPush(admin, r.conversation_id, 'visitor', m.texto)
        if (IA_PUEDE(r.modo as never)) {
          const ia = await responderIA(admin, r.conversation_id, r.seq, 'visitor', null, r.visitor_hash, m.texto, 'meta:' + m.psid)
          if (ia === 'respondio') await despacharMeta(admin)
        }
      })())
    }
  }

  // Meta EXIGE 200 aunque no haya nada que procesar (si no, reintenta y duplica).
  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    // Firma válida y fallo interno al procesar: se reporta y se relanza (el runtime
    // responde 500 y Meta reintenta, exactamente como antes).
    obs('procesar', 'internal_error', { code: 'exception', error: e })
    throw e
  }
})