// Resolución del identificador de vendedor a un nombre legible para operadores.
// `assigned_to` (prospectos) es un uuid de perfil con backend, o un email en demo.
// REGLA DE NEGOCIO: la UI NUNCA debe mostrar un uuid/código interno al operador.
// Orden: perfil por id → nombre → email del perfil → nombre demo → email crudo
// → "Vendedor no disponible" (uuid sin perfil).
//
// DEUDA TÉCNICA: el ownership de prospectos se guarda como uuid/email de vendedor.
// Este resolver depende de que el directorio (profiles) esté cargado; si el perfil
// se elimina, el histórico cae a "Vendedor no disponible". El modelo estable sería
// una FK a un id de vendedor con nombre denormalizado en el propio prospecto.

export type SellerLike = { id: string; name?: string | null; email?: string | null }

export function resolveSellerName(
  team: readonly SellerLike[],
  id: string | null | undefined,
  demoNames: Record<string, string> = {},
): string {
  if (!id) return 'Sin asignar'

  const byId = team.find((t) => t.id === id)
  if (byId) return byId.name?.trim() || byId.email?.trim() || 'Vendedor no disponible'

  const lower = id.toLowerCase()
  const byEmail = team.find((t) => (t.email ?? '').toLowerCase() === lower)
  if (byEmail) return byEmail.name?.trim() || byEmail.email?.trim() || 'Vendedor no disponible'

  if (demoNames[id]) return demoNames[id]     // compat demo (email→nombre fijo)
  if (id.includes('@')) return id             // email sin perfil → mostramos el correo
  return 'Vendedor no disponible'             // uuid sin perfil → NUNCA el uuid
}
