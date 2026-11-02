// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): APROBAR LA VERIFICACIÓN DE UN CONTACTO DE
// WHATSAPP (2 nov 2026). La IA juntó en el chat nombre, cédula, correo y foto (cc_solicitudes_alta); el responsable
// comercial o Dirección la revisa y la aprueba con un toque. En un solo paso, con la autoridad de quien aprueba:
//   1) ficha verificada desde la conversación (cc_alta_cliente_conversacion — mismas reglas y anti-duplicados);
//   2) cuenta del portal ya verificada y ligada a esa ficha (invitación creada y aceptada aquí; contraseña aleatoria: si
//      después quiere entrar al portal, usa "olvidé mi contraseña");
//   3) vínculo de su WhatsApp con esa cuenta y aviso al doctor por el mismo chat (cc_alta_wa_cerrar).
// Desde ahí la IA lo reconoce en WhatsApp: precios con su lista, cotización y pedido. Si un paso falla, se compensa
// (nunca queda una cuenta suelta) y se dice qué pasó.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario, tieneRol } from '../_shared/quien.ts'
import { hashToken } from '../_shared/visitante.ts'
import { despacharWhatsApp } from '../_shared/whatsappEnvio.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MENSAJE: Record<string, string> = {
  POSIBLE_DUPLICADO: 'Ya hay una ficha con ese correo o cédula: vincúlala desde el panel del cliente en lugar de crear otra.',
  YA_VINCULADA: 'Esta conversación ya tiene ficha.', NO_AUTORIZADO: 'No puedes aprobar esta verificación.',
  'DATO_INVALIDO:nombre': 'El nombre debe tener nombre y apellido.', 'DATO_INVALIDO:cedula': 'La cédula debe tener 7 u 8 dígitos.', 'DATO_INVALIDO:email': 'El correo no es válido.',
  ADJUNTO_NO_ES_DEL_CLIENTE: 'La foto debe ser una que mandó esta persona en esta conversación.',
}
const mensajeDe = (m?: string) => { const k = Object.keys(MENSAJE).find((x) => (m ?? '').includes(x)); return k ? MENSAJE[k] : 'No se pudo completar la aprobación. Intenta de nuevo.' }
const contrasena = () => { const b = new Uint8Array(24); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') + 'Aa1!' }

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin', 'pos'])) return json(403, { error: 'no_autorizado', message: MENSAJE.NO_AUTORIZADO })

  const p = await req.json().catch(() => ({})) as { solicitud_id?: string }
  if (!UUID.test(p.solicitud_id ?? '')) return json(400, { error: 'datos_invalidos', message: 'Falta la solicitud.' })
  const { data: s } = await admin.from('cc_solicitudes_alta').select('*').eq('id', p.solicitud_id).maybeSingle()
  if (!s || s.estado !== 'pendiente') return json(409, { error: 'no_pendiente', message: 'Esa solicitud ya no está pendiente.' })

  // 1) Ficha verificada (si la conversación ya tiene ficha de un intento anterior, se reutiliza).
  const { data: conv } = await admin.from('cc_conversations').select('customer_id').eq('id', s.conversation_id).maybeSingle()
  let customer: string | null = conv?.customer_id ?? null
  if (!customer) {
    const adj = (s.adjuntos ?? []) as string[]
    const { data: alta, error: eAlta } = await caller.rpc('cc_alta_cliente_conversacion', { p_conv: s.conversation_id, p_nombre: s.nombre, p_cedula: s.cedula, p_email: s.email, p_ciudad: s.ciudad, p_ine_frente: adj[0] ?? null, p_ine_reverso: adj[1] ?? null })
    if (eAlta || !alta) return json(409, { error: 'alta', message: mensajeDe(eAlta?.message) })
    customer = (alta as { customer_id: string }).customer_id
  }
  // 2) Cuenta verificada ligada a la ficha (si el correo ya tiene cuenta, se usa esa: no se crea otra).
  let perfil: string | null = null
  const { data: yaCuenta } = await admin.from('profiles').select('id').ilike('email', s.email).limit(1).maybeSingle()
  if (yaCuenta) perfil = yaCuenta.id
  else {
    const { data: inv, error: eInv } = await caller.rpc('cliente_invitacion_crear', { p_customer: customer })
    if (eInv || !inv) return json(409, { error: 'cuenta', message: 'La ficha quedó creada, pero no se pudo preparar su cuenta. Mándale acceso desde su ficha.' })
    const hash = await hashToken((inv as { token: string }).token)
    const { data: creado, error: eCrear } = await admin.auth.admin.createUser({ email: s.email, password: contrasena(), email_confirm: true, user_metadata: { full_name: s.nombre } })
    if (eCrear || !creado?.user) return json(503, { error: 'cuenta', message: 'La ficha quedó creada, pero no se pudo crear su cuenta. Intenta de nuevo.' })
    const { error: eLigar } = await admin.rpc('cliente_invitacion_aceptar', { p_hash: hash, p_profile: creado.user.id })
    if (eLigar) { await admin.auth.admin.deleteUser(creado.user.id).then(() => {}, () => {}); return json(409, { error: 'cuenta', message: 'No se pudo ligar la cuenta a la ficha. Intenta de nuevo.' }) }
    perfil = creado.user.id
  }
  // 3) Vínculo del WhatsApp y aviso al doctor por el mismo chat.
  const { data: fin, error: eFin } = await admin.rpc('cc_alta_wa_cerrar', { p_solicitud: s.id, p_customer: customer, p_profile: perfil, p_actor: q.quien.uid })
  if (eFin) return json(409, { error: 'cierre', message: 'La cuenta quedó creada, pero no se pudo cerrar la solicitud. Avísale a Dirección.' })
  await despacharWhatsApp(admin).catch(() => {})
  return json(200, { ok: true, customer_id: customer, profile_id: perfil, ...(fin as Record<string, unknown>) })
}))
