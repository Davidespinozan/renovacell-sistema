// Exportación de datos a EXCEL (.xlsx) y PDF.
//
// Las librerías se cargan con `import()` dinámico: solo se descargan cuando el
// usuario exporta, así no engordan la carga inicial del sistema.
//
// Uso desde una pantalla (igual que antes, mismas columnas):
//   exportExcel('doctores', rows, [{ key:'name', label:'Nombre' }, ...])
//   exportPdf('doctores', rows, columns, 'Doctores verificados')
import type { Column } from './exportCsv'

export type { Column }

// Nombre de archivo seguro con fecha: "ventas-2026-07-19.xlsx".
function fileName(base: string, ext: string): string {
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const clean = base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${clean || 'export'}-${stamp}.${ext}`
}

function download(blob: Blob, name: string) {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Valor ya formateado para mostrar (respeta el `format` de cada columna).
function cellValue<T>(row: T, c: Column<T>): string | number {
  const raw = (row as Record<string, unknown>)[c.key as string]
  const v = c.format ? c.format(raw, row) : (raw as string | number | null | undefined)
  if (v == null) return ''
  return typeof v === 'number' ? v : String(v)
}

// ── EXCEL (.xlsx) ─────────────────────────────────────────────────────────────
// Hoja con encabezado en negritas, ancho de columna automático y filtro activado,
// para que el archivo sea usable de inmediato (no un volcado plano).
export async function exportExcel<T>(base: string, rows: T[], columns: Column<T>[], sheetName = 'Datos'): Promise<number> {
  if (!rows || rows.length === 0) return 0
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Renovacell · Sistema Operativo'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName.slice(0, 31))

  ws.columns = columns.map((c) => ({
    header: c.label,
    key: String(c.key),
    width: Math.min(42, Math.max(12, c.label.length + 4)),
  }))
  rows.forEach((r) => {
    const obj: Record<string, string | number> = {}
    columns.forEach((c) => { obj[String(c.key)] = cellValue(r, c) })
    ws.addRow(obj)
  })

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF007311' } } // verde Renovacell
  header.alignment = { vertical: 'middle' }
  header.height = 20
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  ws.views = [{ state: 'frozen', ySplit: 1 }] // encabezado fijo al desplazar

  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(base, 'xlsx'))
  return rows.length
}

// ── PDF ───────────────────────────────────────────────────────────────────────
// Documento presentable: encabezado con marca, título, fecha y tabla paginada.
export async function exportPdf<T>(base: string, rows: T[], columns: Column<T>[], title?: string): Promise<number> {
  if (!rows || rows.length === 0) return 0
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  // Horizontal si hay muchas columnas: evita que la tabla se apriete.
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })

  const titulo = title ?? base
  doc.setFontSize(15); doc.setTextColor(10, 12, 8)
  doc.text('RENOVACELL', 40, 40)
  doc.setFontSize(8); doc.setTextColor(120, 128, 110)
  doc.text('TECNOLOGÍAS ANTIEDAD', 40, 52)
  doc.setFontSize(13); doc.setTextColor(10, 12, 8)
  doc.text(titulo, 40, 76)
  doc.setFontSize(9); doc.setTextColor(120, 128, 110)
  doc.text(`${rows.length} registro(s) · generado el ${new Date().toLocaleString('es-MX')}`, 40, 90)

  autoTable(doc, {
    startY: 104,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => String(cellValue(r, c)))),
    styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak' },
    headStyles: { fillColor: [0, 115, 17], textColor: 255, fontStyle: 'bold' }, // verde Renovacell
    alternateRowStyles: { fillColor: [245, 248, 243] },
    margin: { left: 40, right: 40 },
  })

  doc.save(fileName(base, 'pdf'))
  return rows.length
}