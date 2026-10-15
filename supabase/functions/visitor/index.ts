// Edge Function PÚBLICA (desplegar con --no-verify-jwt): identidad de VISITANTE (CC-1).
//
// Acciones:
//   abrir   — sin sesión. Con un token válido reanuda al visitante (last_seen, atribución
//             según política); sin token válido crea uno nuevo y devuelve el token (única
//             vez que el token viaja al cliente). Nunca revela si un token existía.
//   estado  — sin sesión. ¿Este visitante ya dejó su prerregistro? (CX-ENLACE; decide si el enlace de contacto
//             muestra el formulario o el chat). No revela nada de otros visitantes.
//   prerregistrar — sin sesión. Guarda nombre, celular y correo del visitante que entra por el enlace de
//             contacto; la base crea o reutiliza el prospecto. Sin esto la función `chat` no lo atiende.
//   mis_datos — sin sesión. Nombre, correo y celular de SU prerregistro (para mostrarlos al verificarse en el chat).
//   verificarme — sin sesión. Crea su cuenta desde el chat con su cédula, las fotos del INE y una contraseña; el
//             correo es el del prerregistro. Queda PENDIENTE (la aprueba una persona) y ligada a su visitante.
//   adoptar — con sesión (JWT). La cuenta autenticada se apropia del visitante cuyo token
//             posee, o de los visitantes que su propio registro dejó vinculados. El perfil
//             se deriva del JWT; el cliente NO manda profile_id ni visitor_id.
//
// La autoridad está en la base (cc_visitante_*, solo service_role). Esta función solo
// hashea el token, acota la entrada y aplica el limitador CC-0B (IP + global; uid para
// adoptar). El token crudo no se persiste ni se registra.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolverQuien } from '../_shared/quien.ts'
import { conCors } from '../_shared/cors.ts'
import { limitarTodas, respuestaLimite, sujetoPublico, sujetoUid } from '../_shared/limite.ts'
import { generarToken, hashToken, limpiarAtribucion, limpiarRef, mapearErrorAdopcion, limpiarPrerregistro, mapearErrorPrerregistro, MENSAJE_PRERREGISTRO, validarVerificarme } from '../_shared/visitante.ts'
import { decodificarFoto } from '../_shared/verificacion.ts'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = ['abrir', 'adoptar', 'estado', 'prerregistrar', 'mis_datos', 'verificarme'].includes(p?.action) ? p.action as string : null
  if (!action) return json(400, { error: 'Acción no reconocida.' })

  // El hash del token que trae el cliente (null si no trae uno con forma válida).
  const hash = await hashToken(p.token)

  if (action === 'abrir') {
    const sujeto = await sujetoPublico(req)
    const v = await limitarTodas(admin, [{ scope: 'visitor_abrir', sujeto }, { scope: 'visitor_abrir_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const nuevoToken = generarToken()
    const nuevoHash = await hashToken(nuevoToken)
    const { data, error } = await admin.rpc('cc_visitante_abrir', {
      p_hash: hash, p_hash_nuevo: nuevoHash, p_attr: limpiarAtribucion(p.atribucion), p_ref: limpiarRef(p.ref),
    })
    if (error || !data) return json(503, { error: 'no_disponible', message: 'No se pudo abrir la sesión de visitante.' })
    const r = data as { visitor_id: string; nuevo: boolean; estado: string }
    // El token SOLO viaja cuando se acaba de crear; un token válido reanuda sin reemitirse.
    return json(200, r.nuevo ? { visitor_id: r.visitor_id, nuevo: true, token: nuevoToken } : { visitor_id: r.visitor_id, nuevo: false })
  }

  // CX-ENLACE · estado: solo dice si ESTE token ya tiene prerregistro (y su nombre, que él mismo escribió).
  if (action === 'estado') {
    if (!hash) return json(200, { visitante: false, prerregistrado: false, nombre: null })
    const v = await limitarTodas(admin, [{ scope: 'visitor_estado', sujeto: await sujetoPublico(req) }])
    if (!v.permitido) return respuestaLimite(v)
    const { data, error } = await admin.rpc('cc_puerta_chat', { p_hash: hash, p_profile: null })
    if (error || !data) return json(503, { error: 'no_disponible', message: 'No se pudo consultar tu sesión.' })
    return json(200, data)
  }

  // CX-ENLACE · prerregistrar: la forma se acota aquí; la base valida de nuevo y decide.
  if (action === 'prerregistrar') {
    if (!hash) return json(400, { error: 'sesion_invalida', message: 'Tu sesión expiró. Recarga la página e inténtalo de nuevo.' })
    const limpio = limpiarPrerregistro(p.datos)
    if (!limpio.ok) return json(400, { error: 'prerregistro_invalido', message: MENSAJE_PRERREGISTRO[limpio.campo], campo: limpio.campo })
    const v = await limitarTodas(admin, [{ scope: 'visitor_prerregistro', sujeto: await sujetoPublico(req) }, { scope: 'visitor_prerregistro_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const d = limpio.datos
    const { data, error } = await admin.rpc('cc_visitante_prerregistrar', {
      p_hash: hash, p_nombre: d.nombre, p_telefono: d.telefono, p_email: d.email, p_es_medico: d.es_medico, p_cedula: d.cedula, p_consent: true,
    })
    if (error || !data) { const e = mapearErrorPrerregistro(error?.message); return json(e.status, e.body) }
    const r = data as { estado: string; nombre: string }
    return json(200, { estado: r.estado, nombre: r.nombre })   // nunca viaja si coincidió con un cliente ni con qué vendedor
  }

  // VERIFICARME · los datos de SU prerregistro (los escribió él mismo).
  if (action === 'mis_datos') {
    if (!hash) return json(400, { error: 'sesion_invalida', message: 'Tu sesión expiró. Recarga la página.' })
    const v = await limitarTodas(admin, [{ scope: 'visitor_estado', sujeto: await sujetoPublico(req) }])
    if (!v.permitido) return respuestaLimite(v)
    const { data } = await admin.rpc('cc_prerregistro_datos', { p_hash: hash })
    if (!data) return json(403, { error: 'prerregistro_requerido', message: 'Antes, déjanos tus datos de contacto.' })
    const d = data as { nombre: string; email: string; telefono: string; cedula: string | null }
    return json(200, { nombre: d.nombre, email: d.email, telefono: d.telefono, cedula: d.cedula })
  }

  // VERIFICARME · crea la cuenta desde el chat. Pendiente (sin precios) hasta que una persona la apruebe.
  if (action === 'verificarme') {
    if (!hash) return json(400, { error: 'sesion_invalida', message: 'Tu sesión expiró. Recarga la página.' })
    const v = await limitarTodas(admin, [{ scope: 'visitor_verificarme', sujeto: await sujetoPublico(req) }, { scope: 'visitor_verificarme_global', sujeto: 'global' }])
    if (!v.permitido) return respuestaLimite(v)
    const val = validarVerificarme(p)
    if (!val.ok) return json(400, { error: 'datos_invalidos', campo: val.campo, message: val.mensaje })
    const frente = decodificarFoto(p.ineFront); const reverso = decodificarFoto(p.ineBack)
    if (!frente || frente === 'invalida' || !reverso || reverso === 'invalida') return json(400, { error: 'datos_invalidos', campo: 'ine', message: 'Sube las fotos del frente y del reverso de tu INE (JPG o PNG).' })
    const { data: pre } = await admin.rpc('cc_prerregistro_datos', { p_hash: hash })
    if (!pre) return json(403, { error: 'prerregistro_requerido', message: 'Antes, déjanos tus datos de contacto.' })
    const d = pre as { nombre: string; email: string; telefono: string; consent_at: string }
    const { data: dup } = await admin.from('profiles').select('id').ilike('email', d.email).limit(1).maybeSingle()
    if (dup) return json(409, { error: 'correo_con_cuenta', message: `Ya hay una cuenta con ${d.email}. Inicia sesión con ella.` })
    const { data: creado, error: eC } = await admin.auth.admin.createUser({ email: d.email, password: val.password, email_confirm: true, user_metadata: { full_name: d.nombre } })
    if (eC || !creado?.user) {
      if ((eC?.message ?? '').toLowerCase().includes('already')) return json(409, { error: 'correo_con_cuenta', message: `Ya hay una cuenta con ${d.email}. Inicia sesión con ella.` })
      return json(503, { error: 'no_disponible', message: 'No se pudo crear tu cuenta. Intenta más tarde.' })
    }
    const uid = creado.user.id
    const deshacer = async () => { await admin.auth.admin.deleteUser(uid).then(() => {}, () => {}) }
    const evidencia: Record<string, string> = {}
    for (const [clave, foto] of [['ine-front', frente], ['ine-back', reverso]] as const) {
      const ruta = `identity/${uid}/${clave}.${foto.ext}`
      const { error: eS } = await admin.storage.from('proofs').upload(ruta, foto.bytes, { contentType: foto.tipo, upsert: true })
      if (eS) { await deshacer(); return json(503, { error: 'no_disponible', message: 'No se pudieron guardar tus fotos. Intenta de nuevo.' }) }
      evidencia[clave] = ruta
    }
    const meta = {
      cedula: val.cedula, capturedVia: 'chat',
      identity: { status: 'pending', evidence: evidencia },
      verification: { status: 'pending' },
      shipping: { line1: '', colonia: '', cp: '', city: '', state: '', phone: d.telefono },
      consentimiento: { privacidad: true, at: d.consent_at },
    }
    const { error: eP } = await admin.from('profiles').update({ full_name: d.nombre, meta }).eq('id', uid)
    if (eP) { await deshacer(); return json(503, { error: 'no_disponible', message: 'No se pudo crear tu cuenta. Intenta más tarde.' }) }
    await admin.rpc('cc_visitante_vincular_registro', { p_hash: hash, p_profile: uid }).then(() => {}, () => {})
    // Aviso a quien lo atiende (o a Dirección): ya tiene todo para revisarlo en la conversación.
    const { data: vis } = await admin.from('cc_visitors').select('id').eq('token_hash', hash).maybeSingle()
    const { data: conv } = vis ? await admin.from('cc_conversations').select('seller_profile_id').eq('visitor_id', vis.id).eq('estado', 'abierta').maybeSingle() : { data: null }
    const vendedor = (conv as { seller_profile_id?: string | null } | null)?.seller_profile_id ?? null
    await admin.from('notifications').insert(vendedor
      ? { body: `${d.nombre} completó su verificación en el chat: revísala y apruébala ahí mismo`, user_ids: [vendedor], screen: 'asesorias', kind: 'verificacion_actualizada' }
      : { body: `${d.nombre} completó su verificación en el chat (sin vendedor asignado)`, roles: ['admin'], screen: 'av_verif', kind: 'verificacion_actualizada' }).then(() => {}, () => {})
    return json(200, { ok: true, email: d.email })
  }

  // adoptar: sesión obligatoria; el perfil es el del JWT.
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const v = await limitarTodas(admin, [{ scope: 'visitor_adoptar', sujeto: sujetoUid(q.quien.uid) }])
  if (!v.permitido) return respuestaLimite(v)
  const { data, error } = await admin.rpc('cc_visitante_adoptar', { p_hash: hash, p_profile: q.quien.uid })
  if (error) { const e = mapearErrorAdopcion(error.message); return json(e.status, e.body) }
  // El conflicto se DEVUELVE desde la base (así queda en bitácora) y aquí se traduce a 409.
  if ((data as { estado?: string } | null)?.estado === 'ajeno') { const e = mapearErrorAdopcion('VISITANTE_AJENO'); return json(e.status, e.body) }
  return json(200, data)
}))
