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
    return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}
