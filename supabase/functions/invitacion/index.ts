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
import { enlaceInvitacion, validarAceptacion, mapearErrorInvitacion, MENSAJE_ESTADO, URL_SISTEMA } from '../_shared/invitacion.ts'
import { correoInvitacion } from '../_shared/plantillas.ts'
import { enviarCorreo, leerConfig } from '../_shared/correo.ts'
import { configWA } from '../_shared/whatsapp.ts'
import { clasificarEnvio, resultadoDeExcepcion, type ResultadoEnvio as ResultadoMeta } from '../_shared/salidaClase.ts'
import { asientoCorreo, asientoWhatsApp, cuerpoPlantillaInvitacion, type Asiento } from '../_shared/invitacionMasiva.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Comparación de tiempo constante (por hash) para el secreto de la tarea programada (igual que meta-send).
async function iguales(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const h = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

type Lote = Array<{ envio_id: number; nombre: string; destino: string; token: string; plantilla_wa: string | null; idioma_wa: string }>

// INVITA-1 · un lote por canal y por minuto. La base ya revisó horario, límite diario y a cada cliente; aquí solo se
// manda y se asienta. Un rechazo del canal (retener) pausa la campaña: el resto del lote ni se intenta.
// deno-lint-ignore no-explicit-any
async function enviarMasivas(admin: any, base: string) {
  const r = { correo: { enviados: 0, fallidos: 0, inciertos: 0, retenidos: 0 }, whatsapp: { enviados: 0, fallidos: 0, inciertos: 0, retenidos: 0 } }
  const asentar = (canal: 'correo' | 'whatsapp', id: number, a: Asiento) => {
    const k = a.resultado === 'enviado' ? 'enviados' : a.resultado === 'fallido' ? 'fallidos' : a.resultado === 'incierto' ? 'inciertos' : 'retenidos'
    r[canal][k]++
    return admin.rpc('_invm_resolver', { p_envio: id, p_resultado: a.resultado, p_proveedor_id: a.resultado === 'enviado' ? a.id : null, p_error: a.resultado === 'enviado' ? null : a.error })
      .then(() => {}, () => {})
  }
  const cfgCorreo = leerConfig((k) => Deno.env.get(k))
  if (cfgCorreo) {
    const { data } = await admin.rpc('_invm_reclamar', { p_canal: 'correo', p_lote: 10 })
    const lote = (Array.isArray(data) ? data : []) as Lote
    for (let i = 0; i < lote.length; i++) {
      const e = lote[i]
      const m = correoInvitacion(e.nombre, enlaceInvitacion(e.token, base))
      const a = asientoCorreo(await enviarCorreo(cfgCorreo, { para: e.destino, asunto: m.asunto, texto: m.texto, html: m.html, llaveIdempotencia: `invitacion-masiva:${e.envio_id}:${(await hashToken(e.token))?.slice(0, 16) ?? ''}` }))
      await asentar('correo', e.envio_id, a)
      if (a.resultado === 'retener') { for (const resto of lote.slice(i + 1)) await asentar('correo', resto.envio_id, { resultado: 'retener', error: a.error }); break }
    }
  }
  const cfgWA = configWA((k) => Deno.env.get(k))
  if (cfgWA) {
    const { data } = await admin.rpc('_invm_reclamar', { p_canal: 'whatsapp', p_lote: 10 })
    const lote = (Array.isArray(data) ? data : []) as Lote
    for (let i = 0; i < lote.length; i++) {
      const e = lote[i]
      let res: ResultadoMeta
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000)
        const resp = await fetch(`https://graph.facebook.com/${cfgWA.version}/${cfgWA.phoneId}/messages`, {
          method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${cfgWA.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpoPlantillaInvitacion(e.destino, e.plantilla_wa ?? '', e.idioma_wa, e.nombre, enlaceInvitacion(e.token, base))),
        })
        clearTimeout(t)
        const cuerpo = await resp.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null
        res = clasificarEnvio(resp.status, cuerpo, cuerpo?.messages?.[0]?.id)
      } catch (err) { res = resultadoDeExcepcion(err) }
      const a = asientoWhatsApp(res)
      await asentar('whatsapp', e.envio_id, a)
      // canal pausado: lo que queda del lote vuelve a la cola sin intentarse
      if (a.resultado === 'retener') { for (const resto of lote.slice(i + 1)) await asentar('whatsapp', resto.envio_id, { resultado: 'retener', error: a.error }); break }
    }
  }
  return r
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = p?.action === 'crear' || p?.action === 'ver' || p?.action === 'aceptar' || p?.action === 'masiva' ? p.action as string : null
  if (!action) return json(400, { error: 'Acción no reconocida.' })
  const base = Deno.env.get('INVITACION_URL_BASE') ?? URL_SISTEMA

  // ── masiva: solo la tarea de cada minuto (x-cron-secret). La base reclama el lote y emite las invitaciones ──
  if (action === 'masiva') {
    const secretoCron = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
    if (secretoCron.length < 32 || !(await iguales(req.headers.get('x-cron-secret') ?? '', secretoCron))) return json(401, { error: 'no_autorizado' })
    return json(200, await enviarMasivas(admin, base))
  }

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
