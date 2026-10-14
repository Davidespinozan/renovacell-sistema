// VERIF-VENDEDOR · Lógica PURA de la evidencia (sin Deno ni supabase, probada desde vitest).

/** Solo rutas de la evidencia de ESE doctor; cualquier otra cosa se ignora. */
export function rutasDeEvidencia(evidencia: unknown, perfil: string): Array<[string, string]> {
  if (!evidencia || typeof evidencia !== 'object' || Array.isArray(evidencia)) return []
  const prefijo = `identity/${perfil}/`
  return Object.entries(evidencia as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].startsWith(prefijo) && !e[1].includes('..') && /^[a-z-]{1,20}$/.test(e[0]))
}
