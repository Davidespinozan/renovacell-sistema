// R-34 — Importar debe RECHAZAR un CSV sin las columnas requeridas (antes lo mapeaba por
// posición y daba por bueno un archivo basura).
import { describe, it, expect } from 'vitest'
import { columnasFaltantes } from './Importar'

// Def mínima tipo catálogo (sku y nombre requeridos).
const defCatalogo = {
  tipo: 'catalogo', titulo: 'Catálogo', ayuda: '', ejemplo: '',
  campos: [
    { key: 'sku', label: 'SKU', alias: ['sku', 'clave', 'codigo', 'código'], req: true },
    { key: 'name', label: 'Nombre', alias: ['name', 'nombre', 'producto'], req: true },
    { key: 'price', label: 'Precio', alias: ['price', 'precio'], num: true },
  ],
} as unknown as Parameters<typeof columnasFaltantes>[1]

describe('columnasFaltantes (R-34)', () => {
  it('CSV basura → reporta las columnas requeridas faltantes', () => {
    const faltan = columnasFaltantes('columna_basura,otra\nx,y', defCatalogo)
    expect(faltan).toContain('SKU')
    expect(faltan).toContain('Nombre')
  })
  it('encabezado válido (con sinónimos) → sin faltantes', () => {
    expect(columnasFaltantes('clave,producto,precio\nPEP-1,Golden,100', defCatalogo)).toEqual([])
  })
  it('falta solo una requerida → la reporta', () => {
    expect(columnasFaltantes('sku,precio\nPEP-1,100', defCatalogo)).toEqual(['Nombre'])
  })
  it('texto vacío → sin faltantes (no hay archivo aún)', () => {
    expect(columnasFaltantes('', defCatalogo)).toEqual([])
  })
})
