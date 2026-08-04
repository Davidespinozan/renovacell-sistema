// Edge Function PÚBLICA: AUTO-REGISTRO del doctor con DOBLE verificación.
//   (1) CÉDULA contra el registro oficial (SEP/RENAPO)  → ¿la cédula existe y es médica?
//   (2) IDENTIDAD contra el proveedor KYC (Nubarium)     → ¿quien se registra ES el titular?
//       prueba de vida (liveness) + validez del INE + match biométrico selfie↔INE.
//
// Por qué las dos: la cédula sola NO prueba identidad — cualquiera podría teclear la
// cédula de un médico real. La capa de identidad exige una persona VIVA cuya cara
// coincide con un INE válido, y que el nombre del INE ≈ el de la cédula. Recién
// entonces "quien verifica ES el doctor".
//
// Decisión combinada:
//   • cédula auto  + identidad 100%           → cuenta creada YA VERIFICADA (acceso al instante)
//   • cédula existe pero identidad incompleta → cuenta creada EN REVISIÓN (Dirección aprueba viendo la evidencia)
//   • cédula inexistente / cara no coincide   → prospecto (sin cuenta) + motivo
//   • sin fotos de identidad (compat)         → comportamiento anterior (solo cédula)
//
// SEAM del proveedor KYC: si `IDENTITY_API_URL` está configurado se llama a Nubarium;
// si no, la identidad queda `unavailable` → SIEMPRE a revisión manual (nunca se inventa
// un veredicto). Activar Nubarium = meter los secrets, sin tocar código. La evidencia
// (selfie + INE) se guarda en el bucket privado `proofs` con service_role.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// ---- Verificación de CÉDULA (misma lógica que verify-cedula) ----
// `unavailable` = no se pudo consultar (caída/timeout/sin proveedor) ≠ cédula inexistente.
// provider/checkedAt/folio son la EVIDENCIA que se guarda con el doctor.
interface SepRecord {
  found: boolean; unavailable?: boolean
  name?: string; profession?: string
  provider?: string; checkedAt?: string; folio?: string
}
const norm = (s?: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = (s?: string) => norm(s).split(' ').filter((t) => t.length > 1 && !['dr', 'dra', 'de', 'del', 'la', 'los'].includes(t))
function nameSim(a?: string, b?: string): number { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let i = 0; A.forEach((t) => { if (B.has(t)) i++ }); return i / Math.max(A.size, B.size) }
const MED = ['medic', 'cirug', 'cirujan', 'dermatolog', 'ginecolog', 'pediatr', 'cardiolog', 'anestesiolog', 'oftalmolog', 'odontolog', 'estomatolog', 'salud', 'enferm']
const isMed = (p?: string) => { const n = norm(p); return n !== '' && MED.some((k) => n.includes(k)) }
function decide(name: string, sep: SepRecord) {
  // Falla nuestra ⇒ revisión manual, nunca rechazo (no acusar en falso a un médico real).
  if (sep.unavailable) {
    return { decision: 'review', score: 0, reasons: ['No fue posible consultar el registro oficial en este momento. Dirección verificará la cédula manualmente.'], sep }
  }
  if (!sep.found) return { decision: 'reject', score: 0, reasons: ['La cédula no aparece en el registro oficial (SEP/RENAPO).'], sep }
  const nm = nameSim(name, sep.name), med = isMed(sep.profession)
  const reasons: string[] = []
  let decision: string
  if (med && nm >= 0.85) { decision = 'auto'; reasons.push('Cédula válida, profesión médica y nombre coincide.') }
  else { if (!med) reasons.push(`La profesión registrada ("${sep.profession ?? '—'}") no es del área médica.`); if (nm < 0.85) reasons.push(`El nombre coincide al ${Math.round(nm * 100)}% con el del registro.`); decision = nm >= 0.5 ? 'review' : 'reject'; reasons.push(decision === 'review' ? 'Requiere revisión de Dirección.' : 'El nombre no coincide con el titular de la cédula.') }
  return { decision, score: Math.round((nm * 0.6 + (med ? 1 : 0) * 0.4) * 100), reasons, sep }
}
async function lookupSep(cedula: string, enteredName: string): Promise<SepRecord> {
  const apiUrl = Deno.env.get('CEDULA_API_URL')
  const checkedAt = new Date().toISOString()
  if (apiUrl) {
    try {
      const key = Deno.env.get('CEDULA_API_KEY') ?? ''
      const header = Deno.env.get('CEDULA_API_KEY_HEADER') ?? 'Authorization'
      const scheme = Deno.env.get('CEDULA_API_AUTH_SCHEME') ?? 'Bearer'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      headers[header] = header.toLowerCase() === 'authorization' && scheme ? `${scheme} ${key}` : key
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 10_000)
      const r = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify({ cedula, nombre: enteredName }), signal: ctrl.signal })
      clearTimeout(t)
      if (!r.ok) return { found: false, unavailable: true, provider: apiUrl, checkedAt }
      // deno-lint-ignore no-explicit-any
      const d: any = await r.json().catch(() => ({}))
      const o = d?.data ?? d?.result ?? d?.persona ?? d
      const name = o?.nombre ?? o?.nombreCompleto ?? o?.name
      const profession = o?.profesion ?? o?.profession ?? o?.carrera
      const folio = o?.folio ?? o?.idConsulta ?? o?.referencia ?? d?.folio
      return { found: !!name, name, profession, provider: apiUrl, checkedAt, folio: folio ? String(folio) : undefined }
    } catch { return { found: false, unavailable: true, provider: apiUrl, checkedAt } }
  }
  // SIMULADOR (solo con flag explícito, para demos). Sin proveedor y sin flag → revisión manual.
  if (Deno.env.get('CEDULA_SIMULATE') !== 'true') {
    return { found: false, unavailable: true, provider: 'sin-proveedor', checkedAt }
  }
  const digits = (cedula ?? '').replace(/\D/g, '')
  if (digits.length < 5) return { found: false, provider: 'simulador', checkedAt }
  const last = digits[digits.length - 1]
  if (last === '0') return { found: false, provider: 'simulador', checkedAt }
  if (last === '9') return { found: true, name: enteredName, profession: 'Licenciatura en Administración', provider: 'simulador', checkedAt }
  if (last === '8') return { found: true, name: 'Juan Pérez García', profession: 'Médico Cirujano', provider: 'simulador', checkedAt }
  return { found: true, name: enteredName, profession: 'Médico Cirujano', provider: 'simulador', checkedAt }
}

// ---- Verificación de IDENTIDAD (SEAM del proveedor KYC · Nubarium) ----
// `attempted` = llegaron fotos para revisar. `unavailable` = no hay proveedor / cayó
// (≠ "cara no coincide"): una falla nuestra manda a revisión, no rechaza.
interface IdRecord {
  attempted: boolean; unavailable?: boolean
  live?: boolean            // prueba de vida (persona real, ahora)
  ineValid?: boolean        // el INE existe/es válido en el registro
  faceMatch?: number        // 0..1 similitud selfie ↔ foto del INE
  ineName?: string          // nombre leído del INE (para cruzar con la cédula)
  provider?: string; checkedAt?: string; folio?: string
}
async function lookupIdentity(imgs: { selfie?: string; ineFront?: string; ineBack?: string }, enteredName: string): Promise<IdRecord> {
  const attempted = !!(imgs.selfie && imgs.ineFront)
  const checkedAt = new Date().toISOString()
  if (!attempted) return { attempted: false } // el registro no adjuntó identidad
  const apiUrl = Deno.env.get('IDENTITY_API_URL')
  if (apiUrl) {
    try {
      const key = Deno.env.get('IDENTITY_API_KEY') ?? ''
      const header = Deno.env.get('IDENTITY_API_KEY_HEADER') ?? 'Authorization'
      const scheme = Deno.env.get('IDENTITY_API_AUTH_SCHEME') ?? 'Bearer'
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      headers[header] = header.toLowerCase() === 'authorization' && scheme ? `${scheme} ${key}` : key
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 20_000)
      const r = await fetch(apiUrl, { method: 'POST', headers, signal: ctrl.signal, body: JSON.stringify({ selfie: imgs.selfie, ineFront: imgs.ineFront, ineBack: imgs.ineBack, nombre: enteredName }) })
      clearTimeout(t)
      if (!r.ok) return { attempted, unavailable: true, provider: apiUrl, checkedAt }
      // deno-lint-ignore no-explicit-any
      const d: any = await r.json().catch(() => ({}))
      const o = d?.data ?? d?.result ?? d
      const live = o?.live ?? o?.liveness ?? o?.prueba_vida ?? o?.isLive
      const ineValid = o?.ineValid ?? o?.vigente ?? o?.ine_valido ?? o?.valid
      const fm = o?.faceMatch ?? o?.similarity ?? o?.score ?? o?.match
      const faceMatch = typeof fm === 'number' ? (fm > 1 ? fm / 100 : fm) : undefined
      const ineName = o?.ineName ?? o?.nombre ?? o?.nombreCompleto ?? o?.name
      const folio = o?.folio ?? o?.idConsulta ?? o?.referencia ?? d?.folio
      return { attempted, live: live === true || live === 'true', ineValid: ineValid === true || ineValid === 'true', faceMatch, ineName, provider: apiUrl, checkedAt, folio: folio ? String(folio) : undefined }
    } catch { return { attempted, unavailable: true, provider: apiUrl, checkedAt } }
  }
  // SIMULADOR (solo con flag, para demos). Sin proveedor y sin flag → unavailable (revisión manual).
  if (Deno.env.get('IDENTITY_SIMULATE') !== 'true') {
    return { attempted, unavailable: true, provider: 'sin-proveedor', checkedAt }
  }
  return { attempted, live: true, ineValid: true, faceMatch: 0.92, ineName: enteredName, provider: 'simulador', checkedAt }
}

// ¿La identidad está 100% verde? (persona viva + INE válido + cara coincide + nombre del INE ≈ el capturado)
function idIsGreen(id: IdRecord, enteredName: string): boolean {
  return id.live === true && id.ineValid === true && (id.faceMatch ?? 0) >= 0.85 && nameSim(enteredName, id.ineName) >= 0.6
}
// ¿La identidad FALLÓ claramente? (el proveedor sí corrió y la persona no vive / la cara es de otro)
function idHardFail(id: IdRecord): boolean {
  return id.attempted && !id.unavailable && (id.live === false || (id.faceMatch ?? 1) < 0.4)
}

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
async function uploadEvidence(admin: any, uid: string, imgs: { selfie?: string; ineFront?: string; ineBack?: string }): Promise<Record<string, string>> {
  const paths: Record<string, string> = {}
  const items: Array<[string, string | undefined]> = [['selfie', imgs.selfie], ['ine-front', imgs.ineFront], ['ine-back', imgs.ineBack]]
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  let p: { name?: string; email?: string; cedula?: string; password?: string; organization?: string; phone?: string; website?: string; selfie?: string; ineFront?: string; ineBack?: string }
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if ((p.website ?? '').trim() !== '') return json(200, { decision: 'review' }) // honeypot

  const name = (p.name ?? '').trim().slice(0, 120)
  const email = (p.email ?? '').trim().toLowerCase().slice(0, 160)
  const cedula = (p.cedula ?? '').trim().slice(0, 40)
  const password = p.password ?? ''
  if (name.length < 3) return json(400, { error: 'Escribe tu nombre completo.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { error: 'Correo inválido.' })
  if (cedula.replace(/\D/g, '').length < 5) return json(400, { error: 'Escribe tu número de cédula.' })
  if (password.length < 6) return json(400, { error: 'La contraseña debe tener al menos 6 caracteres.' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const imgs = { selfie: p.selfie, ineFront: p.ineFront, ineBack: p.ineBack }

  // Las dos consultas en paralelo (registro oficial + proveedor KYC).
  const [sep, id] = await Promise.all([lookupSep(cedula, name), lookupIdentity(imgs, name)])
  const cel = decide(name, sep)

  // ---- Decisión combinada ----
  // Rechazo duro: la cédula no existe/no es del titular, O la biometría dice que es otra persona.
  if (cel.decision === 'reject' || idHardFail(id)) {
    const reasons = [...cel.reasons]
    if (idHardFail(id)) reasons.push(id.live === false ? 'La prueba de vida no fue superada (no se detectó una persona real).' : 'La selfie no coincide con la foto del INE.')
    await admin.from('prospects').insert({
      name, email, phone: p.phone ?? null, cedula, source: 'Landing', status: 'nuevo',
      meta: { organization: p.organization ?? null, interest: [], notes: [], verifyResult: cel, identity: id, capturedVia: 'auto-registro' },
    }).then(() => {}, () => {})
    return json(200, { decision: 'reject', reasons })
  }

  // Se crea cuenta (la cédula existe). ¿Verificada al instante o en revisión?
  const green = id.attempted && idIsGreen(id, name)
  const instant = cel.decision === 'auto' && green
  // Compat: si el registro NO adjuntó identidad, se respeta el flujo anterior
  // (cédula auto → verificado; cédula review → prospecto sin cuenta).
  if (!id.attempted) {
    if (cel.decision !== 'auto') {
      await admin.from('prospects').insert({
        name, email, phone: p.phone ?? null, cedula, source: 'Landing', status: 'nuevo',
        meta: { organization: p.organization ?? null, interest: [], notes: [], verifyResult: cel, capturedVia: 'auto-registro' },
      }).then(() => {}, () => {})
      return json(200, { decision: cel.decision, reasons: cel.reasons })
    }
  }

  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
  if (cErr || !created?.user) {
    if ((cErr?.message ?? '').toLowerCase().includes('already')) return json(200, { decision: 'exists', message: 'Ese correo ya tiene cuenta. Inicia sesión o recupera tu contraseña.' })
    return json(500, { error: cErr?.message ?? 'No se pudo crear la cuenta.' })
  }
  const uid = created.user.id

  // Guarda la evidencia (selfie + INE) en el bucket privado, si vino.
  const evidence = id.attempted ? await uploadEvidence(admin, uid, imgs) : {}
  const identityStatus = instant ? 'approved' : 'pending'

  await admin.from('profiles').upsert({
    id: uid, email, full_name: name, role_id: 'doctor', verified: instant,
    organization: p.organization ?? null,
    meta: { cedula, verifyResult: cel, identity: { ...id, status: identityStatus, evidence }, capturedVia: 'auto-registro' },
  })

  if (instant) {
    await admin.from('notifications').insert({ body: `Doctor auto-verificado (cédula + identidad): ${name}`, roles: ['admin'], screen: 'av_doc' }).then(() => {}, () => {})
    return json(200, { decision: 'auto' })
  }
  // En revisión: cuenta creada pero sin acceso al catálogo hasta que Dirección apruebe la identidad.
  await admin.from('notifications').insert({ body: `Doctor EN REVISIÓN de identidad: ${name} — revisa selfie + INE`, roles: ['admin'], screen: 'av_doc' }).then(() => {}, () => {})
  const reasons: string[] = []
  if (id.unavailable) reasons.push('Tu identidad la validará nuestro equipo (revisión manual).')
  else { if (id.live !== true) reasons.push('No se pudo confirmar la prueba de vida automáticamente.'); if (id.ineValid !== true) reasons.push('No se pudo validar tu INE automáticamente.'); if ((id.faceMatch ?? 0) < 0.85) reasons.push('La coincidencia con tu INE requiere revisión.') }
  if (cel.decision !== 'auto') reasons.push(...cel.reasons)
  return json(200, { decision: 'pending', reasons })
})