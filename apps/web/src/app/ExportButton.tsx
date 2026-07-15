// Botón "Exportar" reutilizable — cae en cualquier lista de la app y descarga
// las filas visibles a CSV (Excel). Igual que en Odoo: cada tabla importante
// tiene su exportación. Usa el motor lib/exportCsv.
import React, { useState } from 'react'
import { Download, Check } from 'lucide-react'
import { exportRows, type Column } from '../lib/exportCsv'

interface Props<T> {
  // Nombre base del archivo (se le agrega la fecha): "doctores" → doctores-2026-07-15.csv
  name: string
  rows: T[]
  columns: Column<T>[]
  label?: string
  className?: string
  style?: React.CSSProperties
}

export function ExportButton<T>({ name, rows, columns, label = 'Exportar', className = 'btn ghost sm', style }: Props<T>) {
  const [done, setDone] = useState(false)
  const empty = !rows || rows.length === 0
  const onClick = () => {
    const n = exportRows(name, rows, columns)
    if (n > 0) { setDone(true); window.setTimeout(() => setDone(false), 1600) }
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={empty}
      style={{ ...(empty ? { opacity: 0.5, cursor: 'not-allowed' } : {}), ...style }}
      title={empty ? 'No hay datos para exportar' : `Exportar ${rows.length} fila(s) a CSV`}
    >
      {done ? <Check size={14} /> : <Download size={14} />}
      {done ? 'Descargado' : label}
    </button>
  )
}
