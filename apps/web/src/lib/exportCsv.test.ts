import { describe, it, expect } from 'vitest'
import { toCsv, type Column } from './exportCsv'

interface Row extends Record<string, unknown> { name: string; price: number | null; note: string }

const cols: Column<Row>[] = [
  { key: 'name', label: 'Nombre' },
  { key: 'price', label: 'Precio', format: (v) => (v == null ? '' : `$${v}`) },
  { key: 'note', label: 'Nota' },
]

describe('toCsv', () => {
  it('encabezado + filas con formateo', () => {
    const csv = toCsv([{ name: 'Botox', price: 4700, note: 'ok' }], cols)
    expect(csv).toBe('Nombre,Precio,Nota\r\nBotox,$4700,ok')
  })

  it('escapa comas, comillas y saltos de línea (RFC 4180)', () => {
    const csv = toCsv([{ name: 'A, B', price: null, note: 'dice "hola"\nfin' }], cols)
    const line = csv.split('\r\n')[1]
    expect(line).toBe('"A, B",,"dice ""hola""\nfin"')
  })

  it('celda vacía cuando el valor es null/undefined', () => {
    const csv = toCsv([{ name: 'X', price: null, note: '' }], cols)
    expect(csv.split('\r\n')[1]).toBe('X,,')
  })
})
