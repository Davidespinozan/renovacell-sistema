// CHV2-B.1 · Presentación de nombres de personas (solo visual: NUNCA se reescribe el dato en la base).
//   · "david espinoza"            → "David Espinoza"   (todo minúsculas/mayúsculas → mayúscula inicial)
//   · "María de la Luz Pérez"     → igual              (mayúsculas mixtas = el usuario ya las eligió)
//   · "Lucía · Ventas"            → "Lucía"            (sufijo de rol interno fuera, solo en el saludo)
//   · "almacen", "ventas1", correo, usuario técnico → null (no se saluda a un usuario como si fuera persona)
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'van', 'von', 'da', 'do', 'dos'])
const TITULO = /^(dra?\.?|doctora?|lic\.?|ing\.?|mtr[oa]\.?)$/i
// Nombres de cuentas de servicio/rol habituales: si el "nombre" es solo esto, no es una persona.
const CUENTAS_DE_ROL = new Set(['almacen', 'almacén', 'admin', 'administracion', 'administración', 'direccion', 'dirección', 'ventas', 'vendedor', 'chofer', 'empaque', 'bodega', 'soporte', 'sistema', 'test', 'demo', 'doctor', 'usuario', 'user'])

/** ¿Parece un identificador técnico y no el nombre de una persona? */
export function esNombreTecnico(raw: string): boolean {
  const s = raw.trim()
  if (!s) return true
  if (/@|_|\d/.test(s)) return true
  if (!/\s/.test(s) && CUENTAS_DE_ROL.has(s.toLowerCase())) return true
  return false
}

/** Mayúscula inicial solo cuando el texto viene en un solo caso (todo minúsculas o todo mayúsculas). */
export function capitalizarNombre(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s || /@/.test(s)) return s
  const letras = s.replace(/[^\p{L}]/gu, '')
  const unCaso = letras === letras.toLowerCase() || letras === letras.toUpperCase()
  if (!unCaso) return s
  return s.toLowerCase().split(' ').map((w, i) => {
    if (i > 0 && PARTICULAS.has(w)) return w
    return w.split('-').map((p) => (p ? p.charAt(0).toLocaleUpperCase('es-MX') + p.slice(1) : p)).join('-')
  }).join(' ')
}

/** Nombre de persona para mostrar (sin sufijo de rol); null si es una cuenta técnica/de servicio. */
export function nombrePersona(raw: string | null | undefined): string | null {
  const base = (raw ?? '').split('·')[0].trim()
  if (esNombreTecnico(base)) return null
  return capitalizarNombre(base)
}

/** Primer nombre para saludar ("Dra. Ana Ruiz" → "Ana"); null si no hay un nombre de persona. */
export function primerNombre(raw: string | null | undefined): string | null {
  const n = nombrePersona(raw)
  if (!n) return null
  const partes = n.split(' ').filter((p) => !TITULO.test(p))
  return partes[0] ?? null
}

/** Saludo natural: "Hola, Ana" o, sin nombre de persona, "Hola". */
export const saludo = (raw: string | null | undefined): string => { const p = primerNombre(raw); return p ? `Hola, ${p}` : 'Hola' }
