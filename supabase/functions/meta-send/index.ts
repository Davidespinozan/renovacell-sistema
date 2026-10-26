// Edge Function: DESPACHO de salida por Meta. Entrega lo que está en las colas de salida del chat (cc_wa_salida y
// cc_meta_salida) por la Cloud API de WhatsApp y el Send API de la página (Instagram/Messenger). La base decide qué sale
// (solo canal en modo activo, solo dentro de la ventana de 24 h) y reparte cada envío una sola vez.
// La llaman la tarea de cada minuto (con su secreto) y, a mano, el personal autenticado (reintento). Sin llaves: 501.
// Se despliega CON --no-verify-jwt (config.toml: [functions.meta-send] verify_jwt = false; WA-RESTORE-R2): la tarea de
// cada minuto no trae JWT. La función autentica por sí misma: x-cron-secret (CORREOS_CRON_SECRET, ≥ 32, comparación por
// hash) o, si no, sesión de equipo vía resolverQuien (401 sin sesión, 403 doctor/sin perfil/suspendido).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien } from '../_shared/quien.ts'
import { despacharWhatsApp } from '../_shared/whatsappEnvio.ts'
import { despacharMeta } from '../_shared/metaEnvio.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Comparación de tiempo constante (por hash) para el secreto de la tarea programada.
async function iguales(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const h = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const hayWA = !!(Deno.env.get('WHATSAPP_TOKEN') && Deno.env.get('WHATSAPP_PHONE_ID'))
  const hayMeta = !!(Deno.env.get('META_PAGE_TOKEN') && Deno.env.get('META_PAGE_ID'))
  if (!hayWA && !hayMeta) return json(501, { error: 'Envío por Meta no configurado' })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const despachar = async () => ({ whatsapp: hayWA ? await despacharWhatsApp(admin) : null, meta: hayMeta ? await despacharMeta(admin) : null })

  // WA-2 · la tarea de cada minuto (con su secreto) entrega lo pendiente de las colas de salida del chat.
  const secretoCron = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
  if (secretoCron.length >= 32 && await iguales(req.headers.get('x-cron-secret') ?? '', secretoCron)) return json(200, await despachar())

  // A mano: solo el personal autenticado (no un doctor) puede pedir un reintento.
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (q.quien.role === '' || q.quien.role === 'doctor') return json(403, { error: 'Solo el equipo puede despachar.' })
  return json(200, await despachar())
}))
