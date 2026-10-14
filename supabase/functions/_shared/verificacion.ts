// VERIF-VENDEDOR · Lógica PURA de la evidencia (sin Deno ni supabase, probada desde vitest).

/** Solo rutas de la evidencia de ESE doctor; cualquier otra cosa se ignora. */
export function rutasDeEvidencia(evidencia: unknown, perfil: string): Array<[string, string]> {
  if (!evidencia || typeof evidencia !== 'object' || Array.isArray(evidencia)) return []
  const prefijo = `identity/${perfil}/`
  return Object.entries(evidencia as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].startsWith(prefijo) && !e[1].includes('..') && /^[a-z-]{1,20}$/.test(e[0]))
}

// MI-VERIFICACIÓN · lo que el doctor manda para completar o corregir su verificación.
export const MAX_FOTO_BYTES = 3_000_000
export type Foto = { bytes: Uint8Array; tipo: 'image/jpeg' | 'image/png'; ext: 'jpg' | 'png' }
export function decodificarFoto(entrada: unknown): Foto | null | 'invalida' {
  if (entrada == null || entrada === '') return null
  if (typeof entrada !== 'string') return 'invalida'
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(entrada)
  if (!m) return 'invalida'
  let bin: string
  try { bin = atob(m[2]) } catch { return 'invalida' }
  if (bin.length === 0 || bin.length > MAX_FOTO_BYTES) return 'invalida'
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8; const png = bytes[0] === 0x89 && bytes[1] === 0x50
  if (m[1] === 'image/jpeg' && !jpeg) return 'invalida'
  if (m[1] === 'image/png' && !png) return 'invalida'
  return { bytes, tipo: m[1] as Foto['tipo'], ext: m[1] === 'image/png' ? 'png' : 'jpg' }
}
export function validarCompletar(p: unknown): { ok: true; cedula: string | null; ineFront: Foto | null; ineBack: Foto | null } | { ok: false; mensaje: string } {
  const o = (p && typeof p === 'object' && !Array.isArray(p) ? p : {}) as Record<string, unknown>
  const ced = typeof o.cedula === 'string' ? o.cedula.trim().slice(0, 40) : ''
  if (ced && ced.replace(/\D/g, '').length < 5) return { ok: false, mensaje: 'La cédula profesional no parece válida.' }
  const f = decodificarFoto(o.ineFront); const b = decodificarFoto(o.ineBack)
  if (f === 'invalida' || b === 'invalida') return { ok: false, mensaje: 'Las fotos deben ser JPG o PNG de menos de 3 MB.' }
  if (!ced && !f && !b) return { ok: false, mensaje: 'Manda al menos un dato: cédula o fotos del INE.' }
  return { ok: true, cedula: ced || null, ineFront: f, ineBack: b }
}
