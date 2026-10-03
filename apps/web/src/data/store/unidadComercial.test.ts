// W3-C · C4-D · D5 — La unidad comercial es un dato de negocio que Renovacell captura.
//
// Lo que se protege: que el catálogo deje de inventar la palabra "unit" como
// presentación, que lo capturado llegue intacto a la base, y que esa unidad NUNCA
// se confunda con la clave de unidad del SAT, que es decisión del contador.
import { describe, it, expect } from 'vitest'
import storeSrc from './productsStore.ts?raw'
import formSrc from '../../screens/admin/Contenido.tsx?raw'
import fiscalSrc from '../ops/fiscalCatalogo.ts?raw'

const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('D5 · la presentación comercial se captura, no se inventa', () => {
  it('ya no se escribe el literal "unit" como unidad', () => {
    expect(soloCodigo(storeSrc)).not.toMatch(/unit:\s*'unit'/)
  })
  it('al crear, la unidad sale de lo que capturó el operador', () => {
    const c = soloCodigo(storeSrc)
    const usos = [...c.matchAll(/unit:\s*input\.unit\?\.trim\(\)\s*\|\|\s*null/g)]
    // Dos veces: el registro optimista local y el INSERT real.
    expect(usos).toHaveLength(2)
  })
  it('un producto sin unidad NO aparenta tener una', () => {
    expect(soloCodigo(storeSrc)).toMatch(/unit:\s*r\.unit\s*\?\?\s*null/)
  })
  it('ProductInput admite la unidad', () => {
    expect(storeSrc).toMatch(/unit\?:\s*string\s*\|\s*null/)
  })
  it('el formulario la captura y la envía al guardar', () => {
    expect(formSrc).toMatch(/Presentación \/ unidad comercial/)
    expect(soloCodigo(formSrc)).toMatch(/unit:\s*unit\.trim\(\)\s*\|\|\s*null/)
  })
  it('y reutiliza las presentaciones ya usadas, para no multiplicar variantes', () => {
    expect(soloCodigo(formSrc)).toMatch(/list="unidades-comerciales"/)
    expect(soloCodigo(formSrc)).toMatch(/datalist id="unidades-comerciales"/)
  })
})

describe('D5 · unidad comercial ≠ clave de unidad del SAT', () => {
  it('la pantalla lo dice con todas sus letras', () => {
    expect(formSrc).toMatch(/no<\/b> es la clave de unidad del SAT/)
  })
  it('ningún código convierte la unidad comercial en clave del SAT', () => {
    const todo = soloCodigo(storeSrc) + soloCodigo(formSrc) + soloCodigo(fiscalSrc)
    // No existe asignación alguna de products.unit hacia clave_unidad.
    expect(todo).not.toMatch(/clave_unidad\s*[:=]\s*[^,;\n]*\bunit\b/)
    expect(todo).not.toMatch(/\bunit\b\s*=>\s*clave_unidad/)
  })
  it('la capa fiscal nunca lee products.unit para proponer la clave', () => {
    expect(soloCodigo(fiscalSrc)).not.toMatch(/unidad_comercial[^\n]*clave_unidad/)
  })
})
