// W6-A3.3 · COPIA literal de la sección SANITIZADOR de
// supabase/functions/_shared/observa.ts. El bundle del frontend no importa fuera de
// apps/web; la prueba data/ops/observa.test.ts exige que ambas copias sean IDÉNTICAS.
// Si cambias una, cambia la otra.

// ── SANITIZADOR (inicio) ─────────────────────────────────────────────────────
// Última línea de defensa antes de que un texto salga hacia el proveedor de
// observabilidad. Reglas, en este orden:
//   1. Credenciales (Bearer/Basic, JWT, llaves sk_live_/whsec_/pk_, pares secret=valor,
//      hex/base64 largos) → el mensaje COMPLETO se reemplaza por uno genérico.
//   2. Datos de persona (correo, teléfono, RFC, CURP) → marcador.
//   3. URLs → se conservan host y ruta; query y fragmento se eliminan.
//   4. Recorte a `max` caracteres.
// El frontend lleva una COPIA literal de esta sección en apps/web/src/lib/sanitizar.ts
// (el bundle no importa fuera de apps/web); observa.test.ts exige que sean idénticas.
export const MENSAJE_GENERICO = 'mensaje omitido: contenía datos sensibles'
export const MAX_MENSAJE = 200

export interface Sanitizado {
  texto: string
  // true cuando el mensaje original fue descartado por completo (credenciales).
  generico: boolean
}

// Credenciales: cualquiera de estas presencias descarta el mensaje entero.
const CREDENCIALES: RegExp[] = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  // JWT: tres segmentos base64url, el primero suele empezar por eyJ.
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,
  // Llaves de proveedores (Stripe, webhooks, Facturama-like, genéricas).
  /\b(?:sk|pk|rk|whsec|sbp|xox[abp])_(?:live|test)?_?[A-Za-z0-9]{8,}/i,
  // Pares secret=valor / "password": "valor" / apikey: valor.
  /\b(?:password|passwd|pass|secret|token|apikey|api[_-]?key|authorization|service[_-]?role[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\b["']?\s*[:=]\s*["']?[^\s"',;&]{4,}/i,
  // Secreto en query string.
  /[?&](?:token|key|apikey|api_key|secret|password|access_token|code)=[^&\s]+/i,
  // Hex largo (≥ 32) o base64 largo (≥ 40) sin espacios: parecen llaves/hashes de sesión.
  /\b[0-9a-f]{32,}\b/i,
  /(?:^|[^A-Za-z0-9+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/,
]

const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Teléfono: 10 dígitos (MX) o +código, con separadores opcionales.
const TELEFONO = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}\b/g
// RFC (persona física 13 / moral 12) y CURP (18).
const RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g
const CURP = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g
// URL: se guarda esquema+host+ruta, se tira ?query y #fragmento.
const URL_RE = /\b(https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?)(?:[?#][^\s]*)?/gi

export function contieneCredencial(texto: string): boolean {
  return CREDENCIALES.some((re) => re.test(texto))
}

export function sanitizarTexto(entrada: unknown, max = MAX_MENSAJE): Sanitizado {
  let t: string
  try {
    t = typeof entrada === 'string' ? entrada : entrada instanceof Error ? String(entrada.message ?? '') : entrada == null ? '' : JSON.stringify(entrada)
  } catch {
    t = ''
  }
  if (typeof t !== 'string') t = ''
  if (contieneCredencial(t)) return { texto: MENSAJE_GENERICO, generico: true }
  const limpio = t
    .replace(URL_RE, '$1')
    .replace(CORREO, '[correo]')
    .replace(CURP, '[curp]')
    .replace(RFC, '[rfc]')
    .replace(TELEFONO, '[tel]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
  // Segunda pasada: si al limpiar quedó algo que parece credencial (p. ej. la URL
  // tenía el token en la ruta), se descarta igual.
  if (contieneCredencial(limpio)) return { texto: MENSAJE_GENERICO, generico: true }
  return { texto: limpio, generico: false }
}

// Nombre de la clase de error / código: solo identificadores cortos. Nunca texto libre.
export function sanitizarCodigo(v: unknown, max = 64): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  if (!s) return undefined
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) return undefined
  return s.slice(0, max)
}

// Quita query y fragmento de una URL (para `request.url` y migas del navegador).
export function urlSinSecretos(u: unknown): string | undefined {
  if (typeof u !== 'string' || !u) return undefined
  const sin = u.split(/[?#]/)[0]
  return contieneCredencial(sin) ? undefined : sin
}
// ── SANITIZADOR (fin) ────────────────────────────────────────────────────────
