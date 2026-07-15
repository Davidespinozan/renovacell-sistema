// Exportación a CSV (abre directo en Excel/Google Sheets), estilo "Exportar" de
// Odoo. Un solo motor para toda la app: recibe filas ya visibles + columnas, y
// descarga un .csv con BOM UTF-8 para que los acentos (ó, í, ñ) salgan bien.
//
// Uso típico desde una pantalla:
//   exportRows('doctores', rows, [
//     { key: 'name',  label: 'Nombre' },
//     { key: 'price', label: 'Precio', format: (v) => money(v) },
//   ])

export interface Column<T> {
  key: keyof T | string
  label: string
  // Formateo opcional del valor (ej. money, fecha). Recibe el valor y la fila.
  format?: (value: unknown, row: T) => string | number | null | undefined
}

// Escapa un campo según RFC 4180: comillas dobladas y envuelto si trae , " o salto.
function cell(value: string | number | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Construye el texto CSV (sin descargar) — útil para pruebas.
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const header = columns.map((c) => cell(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((c) => {
      const raw = (row as Record<string, unknown>)[c.key as string]
      const val = c.format ? c.format(raw, row) : (raw as string | number | null | undefined)
      return cell(val as string | number | null | undefined)
    }).join(','),
  )
  return [header, ...body].join('\r\n')
}

// Nombre de archivo seguro con fecha: "ventas-2026-07-15.csv".
function fileName(base: string): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const clean = base.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${clean || 'export'}-${stamp}.csv`
}

// Descarga las filas como CSV. Devuelve cuántas filas exportó (0 si no hay datos).
export function exportRows<T>(base: string, rows: T[], columns: Column<T>[]): number {
  if (!rows || rows.length === 0) return 0
  const csv = '\uFEFF' + toCsv(rows, columns) // BOM → Excel respeta UTF-8
  if (typeof document === 'undefined') return rows.length
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName(base)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return rows.length
}
