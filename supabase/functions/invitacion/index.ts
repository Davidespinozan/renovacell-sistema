// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): INVITACIÓN DE CLIENTES EXISTENTES.
//
// Acciones:
//   crear       — con sesión (Dirección o el vendedor del cliente; lo decide la base con el JWT del llamante).
//                 Genera la invitación y devuelve el enlace. Con `correo: true` además la manda por correo si el
//                 proveedor está configurado (si no, lo dice: el enlace sigue sirviendo por WhatsApp).
//   ver         — sin sesión. ¿El enlace sirve? Nombre y correo sugerido.
//   aceptar     — sin sesión. Crea la cuenta (correo + contraseña) y la base la liga al expediente ya VERIFICADA.
//                 Si la base rechaza, la cuenta recién creada se borra: nunca queda una cuenta suelta.
// El secreto viaja solo en el cuerpo (nunca en la URL de esta función) y se reduce a su huella antes de la base.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { enlaceInvitacion, validarAceptacion, mapearErrorInvitacion, correoInvitacion, MENSAJE_ESTADO, URL_SISTEMA } from '../_shared/invitacion.ts'
import { enviarCorreo, leerConfig } from '../_shared/correo.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = p?.action === 'crear' || p?.action === 'ver' || p?.action === 'aceptar' ? p.action as string : null
  if (!action) return json(400, { error: 'Acción no reconocida.' })
  const base = Deno.env.get('INVITACION_URL_BASE') ?? URL_SISTEMA

  // ── crear: personal con sesión; la autoridad la decide la base con SU JWT ──
  if (action === 'crear') {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    const v = await limitarTodas(admin, [{ scope: 'invitacion_crear_uid', sujeto: sujetoUid(q.quien.uid) }])
    if (!v.permitido) return respuestaLimite(v)
    const customer = typeof p.customer_id === 'string' && UUID.test(p.customer_id) ? p.customer_id : null
    if (!customer) return json(400, { error: 'falta_cliente', message: 'Falta el cliente.' })
    const { data, error } = await caller.rpc('cliente_invitacion_crear', { p_customer: customer })
    if (error || !data) { const e = mapearErrorInvitacion(error?.message); return json(e.status, e.body) }
    const r = data as { token: string; expira_at: string; nombre: string; email: string | null; telefono: string | null }
    const enlace = enlaceInvitacion(r.token, base)
    let correo: 'no_pedido' | 'sin_correo' | 'no_configurado' | 'enviado' | 'fallido' | 'incierto' = 'no_pedido'
    if (p.correo === true) {
      const para = typeof p.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim()) ? p.email.trim().toLowerCase() : r.email
      const cfg = leerConfig((k) => Deno.env.get(k))
      if (!para) correo = 'sin_correo'
      else if (!cfg) correo = 'no_configurado'
      else {
        const m = correoInvitacion(r.nombre, enlace)
        const res = await enviarCorreo(cfg, { para, asunto: m.asunto, texto: m.texto, html: m.html, llaveIdempotencia: `invitacion:${(await hashToken(r.token)) ?? r.expira_at}` })
        correo = res.resultado
      }
    }
    return json(200, { enlace, expira_at: r.expira_at, nombre: r.nombre, email: r.email, telefono: r.telefono, correo })
  }

  // ── ver / aceptar: sin sesión, con el secreto del enlace ──
  const hash = await hashToken(p.token)
  if (!hash) return json(404, { error: 'inexistente', message: MENSAJE_ESTADO.inexistente })
  const sujeto = await sujetoPublico(req)

  if (action === 'ver') {
    const v = await limitarTodas(admin, [{ scope: 'invitacion_ver', sujeto }])
    if (!v.permitido) return respuestaLimite(v)
    const { data, error } = await admin.rpc('cliente_invitacion_ver', { p_hash: hash })
    if (error || !data) return json(503, { error: 'no_disponible', message: 'No se pudo consultar la invitación.' })
    const r = data as { estado: string; nombre?: string; email?: string | null }
    if (r.estado !== 'valida') return json(200, { estado: r.estado, message: MENSAJE_ESTADO[r.estado] ?? MENSAJE_ESTADO.inexistente })
    return json(200, { estado: 'valida', nombre: r.nombre, email: r.email ?? null })
  }

  // aceptar
  const v = await limitarTodas(admin, [{ scope: 'invitacion_aceptar', sujeto }, { scope: 'invitacion_aceptar_global', sujeto: 'global' }])
  if (!v.permitido) return respuestaLimite(v)
  const datos = validarAceptacion(p)
  if (!datos.ok) return json(400, { error: 'datos_invalidos', campo: datos.campo, message: datos.mensaje })
  const { data: est } = await admin.rpc('cliente_invitacion_ver', { p_hash: hash })
  const estado = (est as { estado?: string; nombre?: string } | null)?.estado ?? 'inexistente'
  if (estado !== 'valida') return json(410, { error: estado, message: MENSAJE_ESTADO[estado] ?? MENSAJE_ESTADO.inexistente })
  // Correo con cuenta: no se intenta crear (GoTrue responde 500 opaco ante duplicados).
  const { data: dup } = await admin.from('profiles').select('id').ilike('email', datos.email).limit(1).maybeSingle()
  if (dup) return json(409, { error: 'correo_con_cuenta', message: 'Ese correo ya tiene una cuenta. Usa otro correo o inicia sesión.' })
  const nombre = (est as { nombre?: string }).nombre ?? ''
  const { data: creado, error: eCrear } = await admin.auth.admin.createUser({ email: datos.email, password: datos.password, email_confirm: true, user_metadata: { full_name: nombre } })
  if (eCrear || !creado?.user) {
    if ((eCrear?.message ?? '').toLowerCase().includes('already')) return json(409, { error: 'correo_con_cuenta', message: 'Ese correo ya tiene una cuenta. Usa otro correo o inicia sesión.' })
    return json(503, { error: 'no_disponible', message: 'No se pudo crear la cuenta. Intenta más tarde.' })
  }
  const uid = creado.user.id
  const { error: eLigar } = await admin.rpc('cliente_invitacion_aceptar', { p_hash: hash, p_profile: uid })
  if (eLigar) {
    await admin.auth.admin.deleteUser(uid).then(() => {}, () => {})   // compensación: nunca una cuenta suelta
    const e = mapearErrorInvitacion(eLigar.message); return json(e.status, e.body)
  }
  return json(200, { ok: true, email: datos.email })
}))
