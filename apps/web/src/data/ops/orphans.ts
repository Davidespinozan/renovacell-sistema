// Detección de estados inconsistentes (orphans) del onboarding de doctores. PURO.
// No repara nada: solo identifica para que Dirección los resuelva de forma controlada.
//
// Tipo A (caso Magaly): doctor verified=true SIN customer vinculado → invisible en el
//   directorio comercial (que lee customers). Se resuelve vinculando/creando su customer.
// Tipo Ghost (caso David): prospecto 'convertido' cuyo doctor NUNCA se persistió
//   (sin profile). Se resuelve re-ejecutando la conversión (ya endurecida para persistir).

const lc = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

export interface OrphanDoctorLike { id: string; verified?: boolean | null; full_name?: string | null; email?: string | null; meta?: unknown }
export interface OrphanCustomerLike { profile_id?: string | null }

// Set de profile_id que YA tienen customer vinculado.
export function linkedProfileIds(customers: readonly OrphanCustomerLike[]): Set<string> {
  const s = new Set<string>()
  for (const c of customers) if (c.profile_id) s.add(c.profile_id)
  return s
}

// Tipo A: verificados sin customer vinculado (quedarían fuera del directorio Doctores).
export function findVerifiedOrphans(
  doctors: readonly OrphanDoctorLike[],
  customers: readonly OrphanCustomerLike[],
): OrphanDoctorLike[] {
  const linked = linkedProfileIds(customers)
  return doctors.filter((d) => !!d.verified && !linked.has(d.id))
}

// Ghost: prospectos convertidos sin doctor persistido (ni por email ni por meta.fromProspect).
export function findGhostConversions<P extends { id: string; email?: string | null }>(
  convertedProspects: readonly P[],
  doctors: readonly OrphanDoctorLike[],
): P[] {
  const byEmail = new Set(doctors.map((d) => lc(d.email)).filter(Boolean))
  const fromProspect = new Set(
    doctors.map((d) => (d.meta as { fromProspect?: string } | null | undefined)?.fromProspect).filter((x): x is string => !!x),
  )
  return convertedProspects.filter((p) => !fromProspect.has(p.id) && !(p.email && byEmail.has(lc(p.email))))
}
