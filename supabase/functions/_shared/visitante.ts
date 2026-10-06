// CC-1 · Identidad de visitante: token opaco, hash, atribución. Lógica PURA (sin Deno,
// sin supabase) para poder probarla desde vitest. La autoridad vive en la base
// (cc_visitante_*); aquí solo se genera el token, se hashea y se acota lo que el
// cliente manda.
//
// Token: 32 bytes aleatorios (256 bits) en base64url. La base guarda SOLO sha256(token)
// en hex: con esa entropía un HMAC no añade seguridad y el hash no es reversible.
// El token nunca lleva PII y nunca se registra en bitácoras.

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const HASH_RE = /^[0-9a-f]{64}$/
export const CLAVES_ATRIBUCION = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'referrer', 'landing_path'] as const
export type Atribucion = Partial<Record<(typeof CLAVES_ATRIBUCION)[number], string>>

export function generarToken(aleatorio: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = aleatorio(32)
  if (bytes.length !== 32) throw new Error('token: se requieren 32 bytes')
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashToken(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, '0')).join('')
}

// Acota lo que llega del cliente ANTES de la base (que vuelve a filtrar): solo claves
// conocidas, solo texto, longitudes topadas, sin query en URLs.
export function limpiarAtribucion(entrada: unknown): Atribucion {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return {}
  const o = entrada as Record<string, unknown>
  const out: Atribucion = {}
  for (const k of CLAVES_ATRIBUCION) {
    const v = o[k]
    if (typeof v !== 'string') continue
    const max = k === 'referrer' ? 300 : k === 'landing_path' ? 200 : k === 'gclid' || k === 'fbclid' ? 160 : 120
    const t = v.trim().split('?')[0].slice(0, max)
    if (t) out[k] = t
  }
  return out
}

export function limpiarRef(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const t = entrada.trim().toUpperCase()
  return /^[A-Z2-7]{8}$/.test(t) ? t : null
}

// Errores de la base → respuesta controlada para el cliente (sin SQL ni detalles).
export function mapearErrorAdopcion(mensaje: string | undefined): { status: number; body: { error: string; message: string } } {
  const m = mensaje ?? ''
  if (/SESION_INVALIDA/.test(m)) return { status: 400, body: { error: 'sesion_invalida', message: 'La sesión de visitante no es válida.' } }
  if (/VISITANTE_AJENO/.test(m)) return { status: 409, body: { error: 'visitante_ajeno', message: 'Esa sesión de visitante pertenece a otra cuenta.' } }
  if (/CUENTA_SUSPENDIDA/.test(m)) return { status: 403, body: { error: 'CUENTA_SUSPENDIDA', message: 'Tu acceso fue suspendido por Dirección.' } }
  if (/PERFIL_INEXISTENTE/.test(m)) return { status: 403, body: { error: 'sin_perfil', message: 'La cuenta no tiene perfil.' } }
  return { status: 500, body: { error: 'no_disponible', message: 'No se pudo completar la operación. Intenta más tarde.' } }
}
