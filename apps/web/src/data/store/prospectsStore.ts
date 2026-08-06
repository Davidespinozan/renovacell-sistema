// Store de PROSPECTOS (leads · PII staff-only). Con backend hidrata de la tabla
// `prospects` (RLS: vendedor ve los suyos por assigned_to = auth.uid(); admin/comm
// todos) y las mutaciones escriben write-through. Sin backend, opera sobre seeds
// de muestra. La captura pública desde la landing se conectará vía función.
import type { Prospect } from '../types'
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'
import type { Json } from '../database.types'

export type ProspectStatus = 'nuevo' | 'contactado' | 'cotizado' | 'convertido' | 'descartado'
export interface ProspectNote { text: string; at: string }

// Mensaje de la CONVERSACIÓN (bandeja multicanal, reemplazo de Leadsales). A
// diferencia de las notas —que son internas del vendedor— esto es el chat REAL
// con el prospecto por su canal (WhatsApp/Instagram/Facebook). `dir` = 'in' lo
// mandó el prospecto (entra por el webhook de Meta), 'out' lo respondió el
// vendedor. `pending` en un 'out' = aún no se entregó por Meta (falta credencial):
// se ve en la bandeja pero se envía de verdad cuando se conecten las cuentas.
export interface ProspectMessage { dir: 'in' | 'out'; text: string; at: string; channel?: string; pending?: boolean }
export function messagesOf(p: Prospect): ProspectMessage[] {
  return ((p.meta as Record<string, unknown>)?.messages as ProspectMessage[]) ?? []
}

// Canales de captación (motor multicanal estilo Leadsales). Los que traen `webhook:true`
// pueden entrar automáticamente por integración externa (seam WhatsApp/Meta/landing);
// el resto se capturan a mano. Todos pasan por el MISMO motor: dedup + auto-asignación.
export interface Channel { key: string; label: string; webhook: boolean }
export const CHANNELS: Channel[] = [
  { key: 'WhatsApp', label: 'WhatsApp', webhook: true },
  { key: 'Instagram', label: 'Instagram', webhook: true },
  { key: 'Facebook', label: 'Facebook', webhook: true },
  { key: 'Landing', label: 'Sitio web', webhook: true },
  { key: 'Referido', label: 'Referido', webhook: false },
  { key: 'Evento', label: 'Evento', webhook: false },
  { key: 'Puerta a puerta', label: 'Puerta a puerta', webhook: false },
  { key: 'Manual', label: 'Manual', webhook: false },
]

// Roster de vendedores para el reparto: en demo, la lista fija; con backend se deriva
// de quién ya trae prospectos (sus identificadores). `assigned_to` es un identificador
// opaco (email en demo, uuid con backend); el balanceo por conteo funciona con ambos.
const DEMO_SELLERS = ['ventas1@renovacell.mx', 'ventas2@renovacell.mx']
const isOpen = (p: Prospect): boolean => p.status !== 'convertido' && p.status !== 'descartado'
const digitsOf = (s?: string | null): string => (s ?? '').replace(/\D/g, '')
const emailNorm = (s?: string | null): string => (s ?? '').trim().toLowerCase()

function sellerRoster(current: Prospect[], override?: string[]): string[] {
  if (override && override.length) return override
  const fromData = [...new Set(current.map((p) => p.assigned_to).filter((x): x is string => !!x))]
  if (fromData.length) return fromData
  return hasSupabase ? [] : DEMO_SELLERS
}

// Balanceo: el vendedor con MENOS prospectos abiertos (empate → el primero del roster).
function pickSeller(current: Prospect[], roster: string[]): string | null {
  if (roster.length === 0) return null
  let best = roster[0]
  let bestLoad = current.filter((p) => p.assigned_to === best && isOpen(p)).length
  for (const s of roster.slice(1)) {
    const load = current.filter((p) => p.assigned_to === s && isOpen(p)).length
    if (load < bestLoad) { best = s; bestLoad = load }
  }
  return best
}

// Carga abierta por vendedor (para mostrar el reparto en Dirección).
export function openLoadBySeller(): Record<string, number> {
  const m: Record<string, number> = {}
  live.current().forEach((p) => { if (p.assigned_to && isOpen(p)) m[p.assigned_to] = (m[p.assigned_to] ?? 0) + 1 })
  return m
}

const SEED: Prospect[] = [
  { id: 'pr-sample-1', name: '(Muestra) Dra. Ana López', email: 'ana.lopez@ejemplo.mx', phone: '55 0000 0001', cedula: null, source: 'Landing', status: 'nuevo', assigned_to: 'ventas1@renovacell.mx', created_at: '2026-06-16T17:30:00.000Z', meta: { organization: 'Clínica Ejemplo', interest: ['Golden Serum'], notes: [] } },
  { id: 'pr-sample-2', name: '(Muestra) Dr. Beto Ramírez', email: 'beto@ejemplo.mx', phone: '55 0000 0002', cedula: null, source: 'WhatsApp', status: 'contactado', assigned_to: 'ventas2@renovacell.mx', created_at: '2026-06-12T15:10:00.000Z', meta: { organization: 'Estética Demo', interest: ['Mascarilla GP'], notes: [{ text: 'Pidió info por WhatsApp; le interesa Home Care.', at: '2026-06-13T16:00:00.000Z' }] } },
  { id: 'pr-sample-3', name: '(Muestra) Dra. Carmen Soto', email: 'carmen@ejemplo.mx', phone: '55 0000 0003', cedula: null, source: 'Referido', status: 'cotizado', assigned_to: 'ventas1@renovacell.mx', created_at: '2026-06-09T18:45:00.000Z', meta: { organization: 'Consultorio Prueba', interest: ['Ultrafiltrados UFS'], notes: [] } },
]

const live = makeLive<Prospect>(async () => {
  const { data, error } = await supabase.from('prospects')
    .select('id, name, email, phone, cedula, source, status, assigned_to, created_at, meta')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Prospect[]
}, SEED)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0

export function addProspect(input: {
  name: string
  email: string | null
  phone: string | null
  organization: string | null
  source: string
  interest: string[]
  cedula?: string | null
  assignedTo?: string | null
}): Prospect {
  seq += 1
  const assigned = hasSupabase ? (input.assignedTo ? currentUserId() : null) : (input.assignedTo ?? null)
  const meta = { organization: input.organization, interest: input.interest, notes: [] as ProspectNote[] }
  const p: Prospect = {
    id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `pr-new-${seq}`) : `pr-new-${seq}`,
    name: input.name, email: input.email, phone: input.phone, cedula: input.cedula ?? null,
    source: input.source, status: 'nuevo', assigned_to: assigned, created_at: new Date().toISOString(), meta,
  }
  live.setLocal([p, ...live.current()])
  notify({ text: `Nuevo prospecto: ${p.name}`, roles: ['admin'], screen: 'av_prosp' })
  if (hasSupabase) {
    supabase.from('prospects').insert({
      id: p.id, name: p.name, email: p.email, phone: p.phone, cedula: p.cedula,
      source: p.source, status: 'nuevo', assigned_to: assigned, meta: meta as unknown as Json,
    }).then(({ error }) => { if (error) console.warn('[prospects] insert', error.message); live.reload() })
  }
  return p
}

export function setStatus(id: string, status: ProspectStatus) {
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, status } : p)))
  if (hasSupabase) supabase.from('prospects').update({ status }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] status', error.message); live.reload() })
}

export function addNote(id: string, text: string) {
  const note: ProspectNote = { text, at: new Date().toISOString() }
  const cur = live.current().find((p) => p.id === id)
  const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>) }
  meta.notes = [...(((meta.notes as ProspectNote[]) ?? [])), note]
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, meta } : p)))
  if (hasSupabase) supabase.from('prospects').update({ meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] note', error.message); live.reload() })
}

// Agrega un mensaje al HILO de conversación del prospecto (bandeja multicanal).
// Uso interno: la entrada real la mete el webhook de Meta en el servidor; aquí es
// para reflejarlo en modo mock/demo y para las respuestas del vendedor.
function pushMessage(id: string, msg: ProspectMessage) {
  const cur = live.current().find((p) => p.id === id)
  const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>) }
  meta.messages = [...(((meta.messages as ProspectMessage[]) ?? [])), msg]
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, meta } : p)))
  if (hasSupabase) supabase.from('prospects').update({ meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] message', error.message); live.reload() })
}

// RESPUESTA del vendedor en la conversación. Se agrega al hilo AL INSTANTE (optimista)
// marcada `pending`, y —con backend— pide la entrega real a Meta vía `meta-send`; al
// confirmar, la función quita `pending` en BD y recargamos. Si Meta no está configurado
// (seam 501) o falla, el mensaje queda "por enviar": la bandeja es usable en demo sin
// mentir sobre el envío. En modo mock, siempre queda "por enviar".
export async function replyProspect(id: string, text: string) {
  const cur = live.current().find((p) => p.id === id)
  const channel = cur?.source ?? undefined
  const at = new Date().toISOString()
  const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>) }
  meta.messages = [...(((meta.messages as ProspectMessage[]) ?? [])), { dir: 'out', text, at, channel, pending: true } as ProspectMessage]
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, meta } : p)))
  logAudit({ actor: 'Ventas', action: 'Respuesta en conversación', resource: cur?.name ?? id, detail: channel ?? '' })
  if (!hasSupabase) return

  // Persistir el saliente (pending) ANTES de invocar, para que meta-send lo encuentre.
  const { error: upErr } = await supabase.from('prospects').update({ meta: meta as unknown as Json }).eq('id', id)
  if (upErr) { console.warn('[prospects] reply persist', upErr.message); return }
  const { data, error } = await supabase.functions.invoke('meta-send', { body: { prospectId: id, at } })
  if (error) { console.warn('[prospects] meta-send', error.message); return } // seam/sin credenciales: queda pending
  if ((data as { delivered?: boolean })?.delivered) live.reload() // la función ya quitó "pending" en BD
}

// Editar datos del prospecto (nombre, contacto, organización, interés).
export function updateProspect(id: string, patch: { name?: string; email?: string | null; phone?: string | null; organization?: string | null; interest?: string[] }) {
  const cur = live.current().find((p) => p.id === id)
  if (!cur) return
  const meta = { ...((cur.meta ?? {}) as Record<string, unknown>) }
  if (patch.organization !== undefined) meta.organization = patch.organization
  if (patch.interest !== undefined) meta.interest = patch.interest
  const next = {
    ...cur,
    name: patch.name ?? cur.name,
    email: patch.email !== undefined ? patch.email : cur.email,
    phone: patch.phone !== undefined ? patch.phone : cur.phone,
    meta,
  }
  live.setLocal(live.current().map((p) => (p.id === id ? next : p)))
  if (hasSupabase) supabase.from('prospects').update({ name: next.name, email: next.email, phone: next.phone, meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] update', error.message); live.reload() })
}

// Eliminar prospecto (solo admin por RLS: prospects_delete_admin).
export async function deleteProspect(id: string): Promise<{ ok: boolean; error?: string }> {
  live.setLocal(live.current().filter((p) => p.id !== id))
  if (hasSupabase) {
    const { error } = await supabase.from('prospects').delete().eq('id', id)
    if (error) { await live.reload(); return { ok: false, error: error.message } }
    await live.reload()
  }
  return { ok: true }
}

export function markConverted(id: string, doctorId: string) {
  const cur = live.current().find((p) => p.id === id)
  const meta = { ...((cur?.meta ?? {}) as Record<string, unknown>), convertedDoctorId: doctorId }
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, status: 'convertido', meta } : p)))
  if (hasSupabase) supabase.from('prospects').update({ status: 'convertido', meta: meta as unknown as Json }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] convert', error.message); live.reload() })
}

export interface CaptureResult { prospect: Prospect; assignedTo: string | null; duplicate: boolean }

// MOTOR DE CAPTACIÓN MULTICANAL. Un lead de CUALQUIER canal (manual, o mañana un
// webhook de WhatsApp/Meta/landing) entra por aquí:
//  1) DEDUP: si ya existe un prospecto con el mismo teléfono o correo, no duplica;
//     le agrega una nota del nuevo contacto y devuelve el existente.
//  2) AUTO-ASIGNACIÓN balanceada al vendedor con menos prospectos abiertos.
//  3) Avisa al vendedor y a Dirección, y lo deja en bitácora.
export function captureLead(input: {
  name: string
  email?: string | null
  phone?: string | null
  organization?: string | null
  channel: string
  interest?: string[]
  message?: string  // primer mensaje del canal (WhatsApp/IG/FB) → abre el hilo
}, roster?: string[]): CaptureResult {
  const current = live.current()
  const inbound = (input.message ?? '').trim()

  // 1) Deduplicación por teléfono (≥7 dígitos) o correo.
  const ph = digitsOf(input.phone)
  const em = emailNorm(input.email)
  const dup = current.find((p) => (ph.length >= 7 && digitsOf(p.phone) === ph) || (em !== '' && emailNorm(p.email) === em))
  if (dup) {
    addNote(dup.id, `Nuevo contacto por ${input.channel}${input.name && input.name !== dup.name ? ` (se presentó como ${input.name})` : ''}.`)
    // El mensaje entrante se enhebra en SU conversación (no se pierde en el dedup).
    if (inbound) pushMessage(dup.id, { dir: 'in', text: inbound, at: new Date().toISOString(), channel: input.channel })
    logAudit({ actor: 'Captación', action: 'Lead duplicado detectado', resource: dup.name ?? '', detail: `canal ${input.channel}` })
    return { prospect: dup, assignedTo: dup.assigned_to ?? null, duplicate: true }
  }

  // 2) Auto-asignación balanceada.
  const assigned = pickSeller(current, sellerRoster(current, roster))

  seq += 1
  const messages: ProspectMessage[] = inbound ? [{ dir: 'in', text: inbound, at: new Date().toISOString(), channel: input.channel }] : []
  const meta = { organization: input.organization ?? null, interest: input.interest ?? [], notes: [] as ProspectNote[], messages }
  const p: Prospect = {
    id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `pr-lead-${seq}`) : `pr-lead-${seq}`,
    name: input.name, email: input.email ?? null, phone: input.phone ?? null, cedula: null,
    source: input.channel, status: 'nuevo', assigned_to: assigned, created_at: new Date().toISOString(), meta,
  }
  live.setLocal([p, ...current])

  // 3) Avisos + bitácora.
  // Aviso DIRIGIDO al vendedor asignado (userIds): solo él lo ve. Antes iba a
  // roles:['pos'] → TODOS los vendedores veían la asignación ajena (auditoría H8).
  if (assigned) notify({ text: `Lead nuevo por ${input.channel} para ti: ${p.name}`, userIds: [assigned], screen: 'av_prosp' })
  notify({ text: `Lead ${input.channel}: ${p.name}${assigned ? ` → ${assigned}` : ' (sin asignar)'}`, roles: ['admin'], screen: 'av_prosp' })
  logAudit({ actor: 'Captación', action: `Lead capturado (${input.channel})`, resource: p.name ?? '', detail: assigned ? `asignado a ${assigned}` : 'sin asignar' })

  if (hasSupabase) {
    supabase.from('prospects').insert({
      id: p.id, name: p.name, email: p.email, phone: p.phone, cedula: null,
      source: p.source, status: 'nuevo', assigned_to: assigned, meta: meta as unknown as Json,
    }).then(({ error }) => { if (error) console.warn('[prospects] captureLead', error.message); live.reload() })
  }
  return { prospect: p, assignedTo: assigned, duplicate: false }
}

// Reasignar manualmente un prospecto a otro vendedor (Dirección).
export function reassign(id: string, sellerId: string | null) {
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, assigned_to: sellerId } : p)))
  logAudit({ actor: 'Dirección', action: 'Prospecto reasignado', resource: id, detail: sellerId ?? 'sin asignar' })
  if (hasSupabase) supabase.from('prospects').update({ assigned_to: sellerId }).eq('id', id).then(({ error }) => { if (error) console.warn('[prospects] reassign', error.message); live.reload() })
}
