// Edge Function: PLANTILLAS DE WHATSAPP DESDE EL SISTEMA (14 nov 2026). Solo Dirección.
//   · { accion: 'enviar', nombre }  → manda la plantilla guardada a revisión de Meta (POST /{waba}/message_templates).
//   · { accion: 'sincronizar' }     → lee de Meta el estado de todas y lo guarda; APROBADA = activa (los vendedores ya la ven).
// Usa el acceso que el sistema ya tiene (WHATSAPP_TOKEN, con whatsapp_business_management); nadie copia tokens.
// La cuenta (WABA) sale de WHATSAPP_WABA_ID; si no está, la del número 667 164 7799.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, esSesionDeUsuario } from '../_shared/quien.ts'
import { configWA } from '../_shared/whatsapp.ts'
import { errorMeta, payloadMeta, type Categoria, type PlantillaLista, type Variable } from '../_shared/plantillasMeta.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const WABA_POR_DEFECTO = '1330521442003498'
// deno-lint-ignore no-explicit-any
type Meta = (ruta: string, init?: RequestInit) => Promise<{ ok: boolean; d: any }>

async function iguales(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const h = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const cfg = configWA((k) => Deno.env.get(k))
  if (!cfg) return json(501, { error: 'no_configurado', message: 'WhatsApp no está conectado al sistema.' })
  const waba = (Deno.env.get('WHATSAPP_WABA_ID') ?? WABA_POR_DEFECTO).trim()
  if (!/^[0-9]{5,30}$/.test(waba)) return json(501, { error: 'no_configurado', message: 'Falta la cuenta de WhatsApp.' })
  const url = Deno.env.get('SUPABASE_URL')!; const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // La base también puede pedirlo (net.http_post con el secreto de las tareas, guardado en vault): así se mandan o
  // sincronizan sin abrir la pantalla. Cualquier otro llamante necesita sesión de Dirección.
  const secretoCron = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
  const deLaBase = secretoCron.length >= 32 && await iguales(req.headers.get('x-cron-secret') ?? '', secretoCron)
  if (!deLaBase) {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!esSesionDeUsuario(authHeader)) return json(401, { error: 'sin_sesion', message: 'Inicia sesión.' })
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
    const q = await resolverQuien(caller, admin)
    if (!q.ok) return json(q.status, q.body)
    // WA-PLANTILLAS-ALM (23 nov 2026, dueño): Alberto (Almacén) también manda plantillas a autorización de Meta.
    if (q.quien.role !== 'admin' && q.quien.role !== 'warehouse') return json(403, { error: 'solo_direccion', message: 'Solo Dirección o Almacén manejan las plantillas.' })
  }

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const graph = `https://graph.facebook.com/${cfg.version}`
  const meta: Meta = async (ruta, init) => {
    try {
      const r = await fetch(`${graph}${ruta}`, { ...init, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) })
      // deno-lint-ignore no-explicit-any
      const d: any = await r.json().catch(() => null)
      return { ok: r.ok && !d?.error, d }
    } catch { return { ok: false, d: null } }
  }

  if (p?.accion === 'enviar') {
    const nombre = typeof p?.nombre === 'string' ? p.nombre : ''
    const { data: t } = await admin.from('cc_wa_plantillas').select('nombre, categoria, cuerpo, variables, botones, idioma, estado_meta').eq('nombre', nombre).maybeSingle()
    if (!t) return json(404, { error: 'inexistente', message: 'Esa plantilla no existe.' })
    if (t.estado_meta !== 'sin_enviar' && t.estado_meta !== 'REJECTED') return json(409, { error: 'ya_enviada', message: 'Esa plantilla ya está en Meta.' })
    const pl: PlantillaLista = { nombre: t.nombre, categoria: t.categoria as Categoria, cuerpo: t.cuerpo, variables: (t.variables ?? []) as Variable[], botones: t.botones ?? [] }
    const r = await meta(`/${waba}/message_templates`, { method: 'POST', body: JSON.stringify(payloadMeta(pl, t.idioma ?? 'es_MX')) })
    if (!r.ok) {
      const msg = errorMeta(r.d?.error)
      // ya existe en Meta (p. ej. se dio de alta a mano): se trae su estado en vez de fallar
      if (!/Ya existe/.test(msg)) return json(502, { error: 'meta', message: msg })
    }
    const ahora = new Date().toISOString()
    if (r.ok) await admin.from('cc_wa_plantillas').update({ estado_meta: String(r.d?.status ?? 'PENDING'), meta_id: r.d?.id ?? null, motivo_meta: null, enviada_at: ahora,
      categoria: r.d?.category === 'MARKETING' || r.d?.category === 'UTILITY' ? r.d.category : t.categoria, activa: r.d?.status === 'APPROVED', updated_at: ahora }).eq('nombre', nombre)
    const s = await sincronizar(meta, admin, waba)
    return json(200, { ok: true, estado: s.estados[nombre] ?? r.d?.status ?? 'PENDING', sincronizadas: s.n })
  }
  if (p?.accion === 'sincronizar') {
    const s = await sincronizar(meta, admin, waba)
    if (s.error) return json(502, { error: 'meta', message: s.error })
    return json(200, { ok: true, sincronizadas: s.n, estados: s.estados, diferencias: s.diferencias, error: s.error })
  }
  return json(400, { error: 'accion', message: 'Acción desconocida.' })
}))

// Lee de Meta todas las plantillas de la cuenta y actualiza las que el sistema conoce (estado, motivo, categoría final).
// deno-lint-ignore no-explicit-any
async function sincronizar(meta: Meta, admin: any, waba: string) {
  const estados: Record<string, string> = {}
  const r = await meta(`/${waba}/message_templates?fields=name,status,category,language,rejected_reason,id,components&limit=200`)
  if (!r.ok) return { n: 0, estados, diferencias: {} as Record<string, string>, error: errorMeta(r.d?.error) }
  const { data: nuestras } = await admin.from('cc_wa_plantillas').select('nombre, idioma, cuerpo, variables, botones')
  const diferencias: Record<string, string> = {}
  const ahora = new Date().toISOString(); let n = 0
  for (const t of (nuestras ?? []) as Array<{ nombre: string; idioma: string; cuerpo: string; variables: string[]; botones: string[] }>) {
    // deno-lint-ignore no-explicit-any
    const m = ((r.d?.data ?? []) as any[]).find((x) => x?.name === t.nombre && (x?.language ?? 'es_MX') === (t.idioma ?? 'es_MX'))
    if (!m) continue
    const estado = String(m.status ?? 'PENDING')
    estados[t.nombre] = estado
    const motivo = estado === 'REJECTED' && m.rejected_reason && m.rejected_reason !== 'NONE' ? String(m.rejected_reason) : null
    // Lo aprobado en Meta manda: si alguien la dio de alta a mano en WhatsApp Manager, el sistema toma SU texto y botones.
    // Si Meta pide otro número de datos que el sistema, no se enciende (los envíos fallarían) y se dice por qué.
    // deno-lint-ignore no-explicit-any
    const comps = (Array.isArray(m.components) ? m.components : []) as any[]
    const cuerpoMeta = String(comps.find((c) => c?.type === 'BODY')?.text ?? '')
    // deno-lint-ignore no-explicit-any
    const botonesMeta = (comps.find((c) => c?.type === 'BUTTONS')?.buttons ?? []).map((b: any) => String(b?.text ?? '')).filter(Boolean)
    const nMeta = new Set(cuerpoMeta.match(/\{\{\d+\}\}/g) ?? []).size
    const cuadra = !cuerpoMeta || nMeta === (t.variables ?? []).length
    if (cuerpoMeta && (cuerpoMeta !== t.cuerpo || JSON.stringify(botonesMeta) !== JSON.stringify(t.botones ?? []))) diferencias[t.nombre] = cuadra ? 'texto de Meta adoptado' : `Meta tiene ${nMeta} datos y el sistema ${(t.variables ?? []).length}`
    await admin.from('cc_wa_plantillas').update({ estado_meta: estado, meta_id: m.id ?? null, revisada_at: ahora, activa: estado === 'APPROVED' && cuadra,
      motivo_meta: cuadra ? motivo : `NO_COINCIDE: en Meta tiene ${nMeta} datos y el sistema espera ${(t.variables ?? []).length}`,
      ...(cuadra && cuerpoMeta ? { cuerpo: cuerpoMeta, botones: botonesMeta } : {}),
      ...(m.category === 'MARKETING' || m.category === 'UTILITY' ? { categoria: m.category } : {}), updated_at: ahora }).eq('nombre', t.nombre)
    n++
  }
  return { n, estados, diferencias, error: null as string | null }
}
