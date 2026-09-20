// Utilidades de formato compartidas.

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

// Precio en MXN; null/undefined = "a consultar" (productos profesionales).
export function money(n: number | null | undefined): string {
  if (n == null) return 'a consultar'
  return MXN.format(n)
}

export function fmtDate(iso: string): string {
  try {
    // Una fecha SIN hora ('YYYY-MM-DD', p. ej. caducidad de lote o fecha de arqueo) la
    // interpreta JS como medianoche UTC y en México (UTC−6/−7) se pinta el DÍA ANTERIOR.
    // La parseamos como fecha LOCAL para mostrar el día correcto. Las que llevan hora
    // (contienen 'T', p. ej. created_at) siguen su curso normal.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// "hace 2 h" estilo social; cae a fecha si es viejo.
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d} d`
  return fmtDate(iso)
}

// Iniciales + color de avatar determinista a partir de un nombre.
const AVATAR_COLORS = ['#007311', '#2C6E8F', '#7A4E97', '#B5730E', '#3d6359', '#A8864E']
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}
export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
