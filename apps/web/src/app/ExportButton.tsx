// Botón "Exportar" reutilizable — cae en cualquier lista de la app y ofrece
// EXCEL (.xlsx) y PDF. Las librerías se cargan solo al exportar (import dinámico),
// así no pesan en la carga inicial. Motor: lib/exportData.
import React, { useEffect, useRef, useState } from 'react'
import { Download, Check, FileSpreadsheet, FileText } from 'lucide-react'
import { exportExcel, exportPdf, type Column } from '../lib/exportData'

interface Props<T> {
  // Nombre base del archivo (se le agrega la fecha): "doctores" → doctores-2026-07-19.xlsx
  name: string
  rows: T[]
  columns: Column<T>[]
  label?: string
  className?: string
  style?: React.CSSProperties
  // Título del documento PDF (por defecto, el nombre).
  title?: string
}

export function ExportButton<T>({ name, rows, columns, label = 'Exportar', className = 'btn ghost sm', style, title }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<'xlsx' | 'pdf' | null>(null)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const empty = !rows || rows.length === 0

  // Cerrar el menú al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const run = async (kind: 'xlsx' | 'pdf') => {
    if (empty || busy) return
    setBusy(true); setOpen(false)
    try {
      const n = kind === 'xlsx'
        ? await exportExcel(name, rows, columns, title ?? name)
        : await exportPdf(name, rows, columns, title ?? name)
      if (n > 0) { setDone(kind); window.setTimeout(() => setDone(null), 1800) }
    } finally { setBusy(false) }
  }

  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
    padding: '9px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'nowrap',
  }

  return (
    <div ref={box} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((v) => !v)}
        disabled={empty || busy}
        style={empty || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        title={empty ? 'No hay datos para exportar' : `Exportar ${rows.length} fila(s)`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {done ? <Check size={14} /> : <Download size={14} />}
        {busy ? 'Generando…' : done ? 'Descargado' : label}
      </button>

      {open && !empty && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: 190,
            background: '#fff', border: '1px solid var(--line)', borderRadius: 12,
            boxShadow: '0 12px 32px -12px rgba(20,40,28,.35)', overflow: 'hidden', padding: 4,
          }}
        >
          <button type="button" style={item} role="menuitem" onClick={() => run('xlsx')}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ok-bg, #E4F1E7)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <FileSpreadsheet size={15} style={{ color: 'var(--green-deep, #005A0D)' }} />
            <span><b style={{ fontWeight: 650 }}>Excel</b> <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>(.xlsx)</span></span>
          </button>
          <button type="button" style={item} role="menuitem" onClick={() => run('pdf')}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--ok-bg, #E4F1E7)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <FileText size={15} style={{ color: 'var(--danger, #B4453A)' }} />
            <span><b style={{ fontWeight: 650 }}>PDF</b> <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>para imprimir</span></span>
          </button>
        </div>
      )}
    </div>
  )
}