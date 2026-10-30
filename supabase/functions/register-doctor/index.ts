// Edge Function PÚBLICA: AUTO-REGISTRO del doctor. Crea su cuenta SIEMPRE en revisión.
//
// Decisión del dueño (identidad MANUAL, oct 2026): no hay verificación automática. Ni consulta a la SEP ni proveedor
// KYC ni selfie. El registro guarda lo que el doctor capturó (cédula, teléfono, domicilio, consentimiento) y las fotos
// de su INE en el bucket privado `proofs`; Dirección o su vendedor revisan y aprueban (doctor_verificar /
// admin_approve_doctor). Cuenta ≠ verificación: con la cuenta entra al portal sin precios hasta que lo aprueben.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { limitarTodas, respuestaLimite, sujetoPublico } from '../_shared/limite.ts'
import { hashToken } from '../_shared/visitante.ts'
import { observador } from '../_shared/observa.ts'
import { configPush, avisarVerificacion } from '../_shared/push.ts'
import webpush from 'npm:web-push@3.6.7'

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('register-doctor')

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// ---- Evidencia: sube las fotos (base64 data URL) al bucket privado `proofs` ----
function decodeDataUrl(dataUrl?: string): { bytes: Uint8Array; contentType: string } | null {
  if (!dataUrl) return null
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { bytes, contentType: m[1] }
  } catch { return null }
}
// deno-lint-ignore no-explicit-any
async function uploadEvidence(admin: any, uid: string, imgs: { ineFront?: string; ineBack?: string }): Promise<Record<string, string>> {
  const paths: Record<string, string> = {}
  const items: Array<[string, string | undefined]> = [['ine-front', imgs.ineFront], ['ine-back', imgs.ineBack]]
  for (const [name, data] of items) {
    const dec = decodeDataUrl(data)
    if (!dec) continue
    const ext = dec.contentType.includes('png') ? 'png' : 'jpg'
    const path = `identity/${uid}/${name}.${ext}`
    const { error } = await admin.storage.from('proofs').upload(path, dec.bytes, { contentType: dec.contentType, upsert: true })
    if (!error) paths[name] = path
  }
  return paths
}

// VERIFICACIÓN · aviso a su vendedora (y a su teléfono) sin bloquear la respuesta.
// deno-lint-ignore no-explicit-any
function enSegundoPlano(p: Promise<unknown>) { const er = (globalThis as any).EdgeRuntime; if (er?.waitUntil) er.waitUntil(p.catch(() => {})); else void p.catch(() => {}) }
// deno-lint-ignore no-explicit-any
const avisarAVendedora = (admin: any, perfil: string) => {
  const cfg = configPush((k) => Deno.env.get(k))
  if (cfg) webpush.setVapidDetails(cfg.sujeto, cfg.publica, cfg.privada)
  enSegundoPlano(avisarVerificacion(admin, perfil, cfg, cfg ? (sub, carga) => webpush.sendNotification(sub, carga, { TTL: 86400, urgency: 'high' }) : null))
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  let p: { name?: string; email?: string; cedula?: string; password?: string; organization?: string; phone?: string; website?: string; ineFront?: string; ineBack?: string; address?: string; colonia?: string; cp?: string; city?: string; state?: string }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if ((p.website ?? '').trim() !== '') return json(200, { decision: 'pending' }) // honeypot
  // CC-1 · token de visitante (posesión): solo sirve para dejar el vínculo del registro; nunca es identidad ni autoridad.
  const visitorHash = await hashToken((p as { visitor_token?: unknown }).visitor_token)

  // Domicilio BASE de entrega (opcional al registrarse; si falta, se pide al pedir).
  // Todo lo que el doctor escribió se guarda, aunque el domicilio venga incompleto (antes, sin calle se descartaban
  // colonia, C.P., ciudad, estado y teléfono).
  const line1 = (p.address ?? '').trim().slice(0, 160)
  const telefono = (p.phone ?? '').replace(/\D/g, '').slice(-10)
  const contacto = { line1, colonia: (p.colonia ?? '').trim().slice(0, 80), cp: (p.cp ?? '').trim().slice(0, 10), city: (p.city ?? '').trim().slice(0, 80), state: (p.state ?? '').trim().slice(0, 80), phone: telefono }
  const shipping = Object.values(contacto).some((v) => v !== '') ? contacto : null
  // Constancia de que aceptó el Aviso de privacidad (el formulario no deja enviar sin marcarlo).
  const consentimiento = (p as { consent?: unknown }).consent === true ? { privacidad: true, at: new Date().toISOString() } : null

  const name = (p.name ?? '').trim().slice(0, 120)
  const email = (p.email ?? '').trim().toLowerCase().slice(0, 160)
  const cedula = (p.cedula ?? '').trim().slice(0, 40)
  const password = p.password ?? ''
  if (name.length < 3) return json(400, { error: 'Escribe tu nombre completo.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Correo inválido.' })
  if (cedula.replace(/\D/g, '').length < 5) return json(400, { error: 'Escribe tu número de cédula.' })
  if (password.length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres.' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // CC-0B · Frontera de abuso ANTES de cualquier efecto caro (lectura de perfiles, Auth,
  // Storage, proveedores externos): ráfaga por IP (hash) y techo global. Limitador caído → 503.
  const sujeto = await sujetoPublico(req)
  const veredicto = await limitarTodas(admin, [{ scope: 'register_doctor', sujeto }, { scope: 'register_doctor_global', sujeto: 'global' }], { reportar: obs })
  if (!veredicto.permitido) return respuestaLimite(veredicto)

  // PRE-CHEQUEO DE DUPLICADO (fix landing): si ya existe una cuenta con ese correo, NO
  // intentamos createUser (GoTrue devuelve un 500 opaco "Database error checking email"
  // ante duplicados, que nuestro código no reconocía como 'already'). Respondemos estado
  // controlado 'exists' con mensaje útil. No crea nada, no cambia verified/política.
  {
    const { data: dup } = await admin.from('profiles').select('id').ilike('email', email).limit(1).maybeSingle()
    if (dup) return json(200, { decision: 'exists', message: 'Ese correo ya tiene una cuenta. Inicia sesión o recupera tu contraseña.' })
  }

  const imgs = { ineFront: p.ineFront, ineBack: p.ineBack }

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
  if (cErr || !created?.user) {
    if ((cErr?.message ?? '').toLowerCase().includes('already')) return json(200, { decision: 'exists', message: 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.' })
    obs('crear_cuenta', 'internal_error', { code: 'create_user', error: cErr ?? undefined })
    return json(500, { error: cErr?.message ?? 'No se pudo crear la cuenta.' })
  }
  const uid = created.user.id

  // Guarda las fotos del INE en el bucket privado (la revisión es de una persona).
  const evidence = await uploadEvidence(admin, uid, imgs)
  const conIne = Object.keys(evidence).length > 0

  // CUSTOMER 360: resuelve si YA existe una identidad comercial (p.ej. customer migrado de Odoo con
  // el mismo email). NO se auto-vincula; se deja como CANDIDATO para que la aprobación decida. Así el
  // sistema ya no puede ignorar que existía un customer previo. AMBIGUOUS → REVIEW en el cockpit.
  let commercial: { status: string; customer_id: string | null; signals: unknown } | null = null
  try {
    const { data: r } = await admin.rpc('resolve_customer_identity', { p_email: email, p_phone: telefono || null, p_name: name })
    if (r) commercial = r as { status: string; customer_id: string | null; signals: unknown }
  } catch { /* el registro no debe fallar por el resolver */ }

  // SIEMPRE pendiente: verified=false + verification.status='pending'. Lo aprueba una persona.
  await admin.from('profiles').upsert({
    id: uid, email, full_name: name, role_id: 'doctor', verified: false,
    organization: p.organization ?? null,
    meta: {
      cedula, identity: { status: 'pending', evidence },
      verification: { status: 'pending' },
      capturedVia: 'auto-registro', ...(shipping ? { shipping } : {}),
      ...(consentimiento ? { consentimiento } : {}),
      ...(commercial ? { commercial } : {}),
    },
  })
  // CC-1 · El visitante que creó esta cuenta queda vinculado (pendiente de que la cuenta,
  // ya autenticada, confirme la adopción). Posesión probada aquí, confirmación después.
  if (visitorHash) await admin.rpc('cc_visitante_vincular_registro', { p_hash: visitorHash, p_profile: uid }).then(() => {}, () => {})

  // Aviso a su vendedora (cartera, o quien lo atendió por el enlace) para que lo verifique ella. REPARTO-VERIF: sin
  // vendedora le toca AL AZAR a un vendedor (verificacion_avisar); Dirección ya no verifica. Aunque falte su INE: el
  // vendedor se la pide (en "Por verificar" aparece sin fotos).
  avisarAVendedora(admin, uid)

  return json(200, { decision: 'pending', reasons: conIne ? [] : ['Para terminar tu verificación sube tu INE en "Mi verificación" al entrar.'] })
}))
