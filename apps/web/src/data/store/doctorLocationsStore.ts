// Multi-ubicación de entrega (Fase 1) — data layer. CRUD sobre `doctor_locations`. La RLS es la
// autoridad (un doctor solo puede tocar las suyas; admin todas). NO toca orders/shipping_meta ni
// meta.fiscal. La selección para el pedido y el snapshot se hacen en la fase 2.
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import type { DoctorLocation, DoctorLocationInput } from '../ops/doctorLocation'

// Campos capturables desde la UI (sin id/doctor_id/flags de sistema).
export type LocationFields = Omit<DoctorLocationInput, 'id' | 'doctor_id' | 'created_at' | 'updated_at'>

export async function listDoctorLocations(doctorId?: string): Promise<DoctorLocation[]> {
  if (!hasSupabase) return []
  let q = supabase.from('doctor_locations').select('*').order('is_default', { ascending: false }).order('created_at', { ascending: true })
  if (doctorId) q = q.eq('doctor_id', doctorId)
  const { data, error } = await q
  if (error) { console.warn('[doctor_locations] list', error.message); return [] }
  return (data ?? []) as DoctorLocation[]
}

// Ubicaciones de un CLIENTE (Customer 360, solo lectura): las ancladas al customer y, si tiene
// portal, también las de su profile. La RLS sigue siendo la autoridad (admin/pos o el dueño).
export async function listLocationsForCustomer(customerId: string, doctorId?: string | null): Promise<DoctorLocation[]> {
  if (!hasSupabase || !customerId) return []
  const ors = [`customer_id.eq.${customerId}`]
  if (doctorId) ors.push(`doctor_id.eq.${doctorId}`)
  const { data, error } = await supabase.from('doctor_locations').select('*')
    .or(ors.join(','))
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) { console.warn('[doctor_locations] byCustomer', error.message); return [] }
  return (data ?? []) as DoctorLocation[]
}

// C360-F3 · Las ESCRITURAS pasan por comandos del servidor (cliente_ubicacion_*): autoridad (dueño, su vendedor,
// Dirección), validación, predeterminado único, archivado sin borrar y bitácora. Ya no hay INSERT/UPDATE directos.
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)
const DATOS: Array<keyof LocationFields | 'tipo' | 'municipio'> = ['name', 'tipo', 'line1', 'exterior_number', 'interior_number', 'neighborhood', 'postal_code', 'municipio', 'city', 'state', 'country', 'reference_notes', 'contact_name', 'contact_phone']
export type LocationFieldsC360 = LocationFields & { tipo?: string | null; municipio?: string | null }
const datosDe = (f: Partial<LocationFieldsC360>) => Object.fromEntries(DATOS.map((k) => [k, (f as Record<string, unknown>)[k] ?? null]).concat([['tipo', (f as { tipo?: string | null }).tipo ?? 'OTRO']]))
export function mensajeUbicacion(m: string | undefined): string {
  const t = m ?? ''
  if (/DOMICILIO_INVALIDO: (.+)/.test(t)) return 'Revisa el domicilio: ' + (t.match(/DOMICILIO_INVALIDO: ([^\n]+)/)?.[1] ?? '') + '.'
  if (/DOMICILIO_INVALIDO/.test(t)) return 'Revisa el domicilio.'
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'No tienes permiso para cambiar este domicilio.'
  if (/ARCHIVAD|INACTIVA/.test(t)) return 'Ese domicilio está archivado.'
  return 'No se pudo guardar el domicilio. Intenta de nuevo.'
}
async function clienteDeDoctor(doctorId: string): Promise<string | null> {
  const { data } = await supabase.from('customers').select('id').eq('profile_id', doctorId).maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

// Alta. Sin destino = la propia (doctor); Dirección puede indicar el doctor destino.
export async function createDoctorLocation(fields: LocationFieldsC360, targetDoctorId?: string, opts: { predeterminada?: boolean } = {}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  if (!currentUserId()) return { ok: false, error: 'Sin sesión.' }
  const cliente = targetDoctorId && targetDoctorId !== currentUserId() ? await clienteDeDoctor(targetDoctorId) : null
  if (targetDoctorId && targetDoctorId !== currentUserId() && !cliente) return { ok: false, error: 'Ese doctor aún no tiene expediente de cliente.' }
  const { data, error } = await rpc('cliente_ubicacion_guardar', { p_customer: cliente, p_ubicacion: null, p_datos: datosDe(fields), p_predeterminada: opts.predeterminada ?? fields.is_default ?? null })
  if (error) return { ok: false, error: mensajeUbicacion(error.message) }
  return { ok: true, id: (data as { id?: string } | null)?.id }
}

export async function updateDoctorLocation(id: string, patch: Partial<LocationFieldsC360>): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  if (patch.active === false) return deactivateDoctorLocation(id)
  const { data: actual } = await supabase.from('doctor_locations').select('*').eq('id', id).maybeSingle()
  if (!actual) return { ok: false, error: 'Domicilio no encontrado.' }
  const { error } = await rpc('cliente_ubicacion_guardar', { p_customer: null, p_ubicacion: id, p_datos: datosDe({ ...(actual as Partial<LocationFieldsC360>), ...patch }), p_predeterminada: patch.is_default === true ? true : null })
  if (error) return { ok: false, error: mensajeUbicacion(error.message) }
  return { ok: true }
}

// Archivar (nunca borrar): los pedidos conservan su dirección congelada. Si era el predeterminado, el
// servidor promueve de forma determinista el activo más antiguo.
export async function deactivateDoctorLocation(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await rpc('cliente_ubicacion_archivar', { p_ubicacion: id })
  if (error) return { ok: false, error: mensajeUbicacion(error.message) }
  return { ok: true }
}

// UN predeterminado por cliente, atómico en el servidor (índices parciales como segunda defensa).
export async function setDefaultDoctorLocation(locationId: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await rpc('cliente_ubicacion_predeterminar', { p_ubicacion: locationId })
  if (error) return { ok: false, error: mensajeUbicacion(error.message) }
  return { ok: true }
}
