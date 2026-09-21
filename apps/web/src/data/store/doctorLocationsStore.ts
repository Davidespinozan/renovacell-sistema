// Multi-ubicación de entrega (Fase 1) — data layer. CRUD sobre `doctor_locations`. La RLS es la
// autoridad (un doctor solo puede tocar las suyas; admin todas). NO toca orders/shipping_meta ni
// meta.fiscal. La selección para el pedido y el snapshot se hacen en la fase 2.
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { logAudit } from './auditStore'
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

// Alta. El doctor crea SOLO para sí (doctor_id de la sesión); admin puede pasar targetDoctorId.
// La RLS rechaza cualquier doctor_id ajeno para no-admin.
export async function createDoctorLocation(fields: LocationFields, targetDoctorId?: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const doctor_id = targetDoctorId ?? currentUserId()
  if (!doctor_id) return { ok: false, error: 'Sin sesión.' }
  const { data, error } = await supabase.from('doctor_locations').insert({ ...fields, doctor_id }).select('id').single()
  if (error) return { ok: false, error: error.message }
  logAudit({ actor: 'Doctor/Admin', action: 'Ubicación creada', resource: fields.name })
  return { ok: true, id: data?.id }
}

export async function updateDoctorLocation(id: string, patch: Partial<LocationFields>): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await supabase.from('doctor_locations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// Soft-delete (no DELETE físico desde UI). Si era default, queda sin default utilizable (la UI
// puede pedir elegir otra).
export async function deactivateDoctorLocation(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await supabase.from('doctor_locations').update({ active: false, is_default: false, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  logAudit({ actor: 'Doctor/Admin', action: 'Ubicación desactivada', resource: id })
  return { ok: true }
}

// Marca UNA ubicación como default entre las activas del doctor, de forma ATÓMICA vía la RPC
// `set_doctor_default_location`: un único UPDATE en el servidor deja is_default = (id = elegida)
// sobre las activas del doctor. El doctor_id NO se pasa desde el cliente: la RPC lo deriva de la
// fila y autoriza (dueño o admin; POS no puede). El índice único parcial es la segunda defensa.
export async function setDefaultDoctorLocation(locationId: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión.' }
  const { error } = await supabase.rpc('set_doctor_default_location', { p_location_id: locationId })
  if (error) return { ok: false, error: error.message }
  logAudit({ actor: 'Doctor/Admin', action: 'Ubicación predeterminada', resource: locationId })
  return { ok: true }
}
