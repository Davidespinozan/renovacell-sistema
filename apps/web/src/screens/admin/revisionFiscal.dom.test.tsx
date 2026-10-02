// @vitest-environment jsdom
// W3-C · C3 — la pantalla de revisión fiscal, vista como la ve quien la opera.
//
// Lo que se protege aquí es el comportamiento visible: que un producto sin validar se
// distinga de uno validado, que la evidencia histórica aparezca SIEMPRE con su advertencia,
// que validar exija un acto humano deliberado y que nada de la pantalla pueda aprobar un
// producto por inercia.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { FilaRevisionFiscal, ObservacionEvidencia } from '../../data/ops/fiscalCatalogo'

const fila = (p: Partial<FilaRevisionFiscal>): FilaRevisionFiscal => ({
  product_id: 'p1', sku: 'SKU-1', nombre: 'Producto 1', categoria: 'Sérum',
  unidad_comercial: 'pieza', precio_final: 1160,
  clave_prod_serv: '01010101', clave_unidad: 'H87', objeto_imp: '02',
  tratamiento_iva: 'gravado', iva_tasa: 0.16, descripcion_fiscal: 'Sérum facial 30 ml',
  validado: false, validado_at: null, validado_por_nombre: null,
  evidencia_historica: null, precio_historico: null, precio_publicado: null,
  faltantes: [], advertencias: [], ...p,
})

const obs = (p: Partial<ObservacionEvidencia>): ObservacionEvidencia => ({
  id: 'e1', source_ref: 'FILA-1', source_nombre: 'Serum facial', source_referencia: 'REF-1',
  precio_historico: 1000, precio_publicado: 1160, clasificacion: 'HISTORICAL_BASE_PLUS_16',
  procedencia: 'DIRECT_MATCH', familia_publicada: null, product_id: 'p1',
  mapeo_estado: 'MAPEADO', mapeo_metodo: 'EXACT_CONCAT', mapeo_motivo: null,
  created_at: '2026-09-01T00:00:00Z', ...p,
})

const PENDIENTE = fila({ product_id: 'p1', sku: 'SKU-1', nombre: 'Sérum Oro' })
const VALIDADO = fila({
  product_id: 'p2', sku: 'SKU-2', nombre: 'Toxina Botulínica', categoria: 'Toxinas',
  validado: true, validado_at: '2026-09-20T18:00:00Z', validado_por_nombre: 'C.P. Ana Ruiz',
})
const INCOMPLETO = fila({
  product_id: 'p3', sku: 'SKU-3', nombre: 'Peeling Medio', categoria: 'Peeling',
  clave_prod_serv: null, clave_unidad: null, objeto_imp: null, tratamiento_iva: null,
  iva_tasa: null, descripcion_fiscal: null,
  faltantes: ['clave_prod_serv', 'clave_unidad', 'objeto_imp', 'tratamiento_iva', 'descripcion_fiscal'],
})
const MISMATCH = fila({
  product_id: 'p4', sku: 'SKU-4', nombre: 'Aparatología X', categoria: 'Aparatología',
  evidencia_historica: 'HISTORICAL_MISMATCH', precio_historico: 900, precio_publicado: 1500,
  advertencias: ['la evidencia de precio NO reconcilia con la lista publicada'],
})
const FILAS = [PENDIENTE, VALIDADO, INCOMPLETO, MISMATCH]

// Las 12 observaciones que C2 dejó sin producto: 11 NOT_FOUND + 1 AMBIGUOUS.
const HUERFANAS: ObservacionEvidencia[] = Array.from({ length: 12 }, (_, i) =>
  obs({
    id: `h${i}`, source_ref: `FILA-${100 + i}`, source_nombre: `Histórico sin producto ${i}`,
    product_id: null, mapeo_estado: 'NO_MAPEADO', mapeo_metodo: null,
    mapeo_motivo: i === 11 ? 'nombre ambiguo entre dos productos' : 'sin producto canónico equivalente',
    clasificacion: 'NO_PUBLIC_REFERENCE', precio_publicado: null, procedencia: null,
  }))

const EV: Record<string, ObservacionEvidencia[]> = {
  p1: [obs({})],
  p4: [obs({ id: 'e4', product_id: 'p4', clasificacion: 'HISTORICAL_MISMATCH', precio_historico: 900, precio_publicado: 1500 })],
}

const mocks = vi.hoisted(() => ({
  cargarRevisionFiscal: vi.fn(), cargarDefaults: vi.fn(), cargarEvidencia: vi.fn(),
  cargarFichaFiscal: vi.fn(), editarFiscal: vi.fn(), validarFiscal: vi.fn(),
  invalidarFiscal: vi.fn(), aplicarPropuestaCategoria: vi.fn(), definirDefaults: vi.fn(),
}))

vi.mock('../../data/ops/fiscalCatalogo', async (orig) => {
  const real = await orig<typeof import('../../data/ops/fiscalCatalogo')>()
  return { ...real, ...mocks }
})

import { RevisionFiscal } from './RevisionFiscal'

beforeEach(() => {
  cleanup()
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.cargarRevisionFiscal.mockResolvedValue(FILAS)
  mocks.cargarDefaults.mockResolvedValue([
    { categoria: 'Sérum', clave_prod_serv: '01010101', clave_unidad: 'H87', objeto_imp: '02', tratamiento_iva: 'gravado', iva_tasa: 0.16, notas: null },
  ])
  mocks.cargarEvidencia.mockImplementation(async (pid?: string) => (pid ? EV[pid] ?? [] : HUERFANAS))
  mocks.cargarFichaFiscal.mockResolvedValue({ fuente: null, notas: null })
  mocks.editarFiscal.mockResolvedValue({ ok: true, data: { validado: false, invalidado_por_el_cambio: false, faltantes: [] } })
  mocks.validarFiscal.mockResolvedValue({ ok: true, data: { validado: true } })
  mocks.invalidarFiscal.mockResolvedValue({ ok: true, data: null })
  mocks.aplicarPropuestaCategoria.mockResolvedValue({ ok: true, data: { prellenados: 4, validados: 0 } })
  mocks.definirDefaults.mockResolvedValue({ ok: true, data: null })
})

const abrir = async (nombre: string) => {
  const fila = (await screen.findByText(nombre)).closest('tr') as HTMLElement
  fireEvent.click(fila)
}

// ─────────── 1 · 2 · 3 ───────────
describe('T1/T2 · la lista distingue el estado de cada producto', () => {
  it('T1 — un producto completo sin validar se ve como pendiente, no como listo', async () => {
    render(<RevisionFiscal />)
    expect(await screen.findByText('Sérum Oro')).toBeInTheDocument()
    const tr = screen.getByText('Sérum Oro').closest('tr') as HTMLElement
    expect(tr.textContent).toContain('Completo · sin validar')
    expect(tr.textContent).not.toContain('Validado')
  })

  it('T2 — un producto validado muestra el estado, quién lo validó y cuándo', async () => {
    render(<RevisionFiscal />)
    const tr = (await screen.findByText('Toxina Botulínica')).closest('tr') as HTMLElement
    expect(tr.textContent).toContain('Validado')
    expect(tr.textContent).toContain('C.P. Ana Ruiz')
  })

  it('el avance se muestra sobre el total elegible', async () => {
    render(<RevisionFiscal />)
    expect(await screen.findByText(/de 4 · 25%/)).toBeInTheDocument()
    // 4 productos: 1 validado, 2 completos sin validar (incluye el de MISMATCH) y 1 incompleto.
    expect(screen.getByText('1 validados')).toBeInTheDocument()
    expect(screen.getByText('2 completos sin validar')).toBeInTheDocument()
    expect(screen.getByText('1 incompletos')).toBeInTheDocument()
  })
})

describe('T3 · los filtros funcionan', () => {
  it('por estado: incompletos deja solo los incompletos', async () => {
    render(<RevisionFiscal />)
    await screen.findByText('Sérum Oro')
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'incompleto' } })
    expect(screen.getByText('Peeling Medio')).toBeInTheDocument()
    expect(screen.queryByText('Toxina Botulínica')).toBeNull()
    expect(screen.queryByText('Sérum Oro')).toBeNull()
  })

  it('por estado: validados deja solo el validado', async () => {
    render(<RevisionFiscal />)
    await screen.findByText('Sérum Oro')
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'validado' } })
    expect(screen.getByText('Toxina Botulínica')).toBeInTheDocument()
    expect(screen.queryByText('Peeling Medio')).toBeNull()
  })

  it('por categoría', async () => {
    render(<RevisionFiscal />)
    await screen.findByText('Sérum Oro')
    fireEvent.change(screen.getByLabelText('Filtrar por categoría'), { target: { value: 'Toxinas' } })
    expect(screen.getByText('Toxina Botulínica')).toBeInTheDocument()
    expect(screen.queryByText('Sérum Oro')).toBeNull()
  })

  it('por evidencia: con, sin y por clasificación', async () => {
    render(<RevisionFiscal />)
    await screen.findByText('Sérum Oro')
    const f = screen.getByLabelText('Filtrar por evidencia histórica')
    fireEvent.change(f, { target: { value: 'con' } })
    expect(screen.getByText('Aparatología X')).toBeInTheDocument()
    expect(screen.queryByText('Sérum Oro')).toBeNull()
    fireEvent.change(f, { target: { value: 'sin' } })
    expect(screen.getByText('Sérum Oro')).toBeInTheDocument()
    expect(screen.queryByText('Aparatología X')).toBeNull()
    fireEvent.change(f, { target: { value: 'HISTORICAL_MISMATCH' } })
    expect(screen.getByText('Aparatología X')).toBeInTheDocument()
    expect(screen.queryByText('Peeling Medio')).toBeNull()
  })

  it('por texto libre: SKU o nombre', async () => {
    render(<RevisionFiscal />)
    await screen.findByText('Sérum Oro')
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'SKU-3' } })
    expect(screen.getByText('Peeling Medio')).toBeInTheDocument()
    expect(screen.queryByText('Sérum Oro')).toBeNull()
  })
})

// ─────────── 4 · 5 · 6 · 7 ───────────
describe('T4/T5/T6/T7 · la evidencia histórica se muestra, y se muestra acotada', () => {
  it('T4 — al abrir un producto aparece su observación histórica con el rótulo que la limita', async () => {
    render(<RevisionFiscal />)
    await abrir('Sérum Oro')
    expect(await screen.findByText(/NO ES AUTORIDAD FISCAL/)).toBeInTheDocument()
    expect(await screen.findByText('Serum facial')).toBeInTheDocument()
    expect(screen.getByText(/Asociada al producto por: EXACT_CONCAT/)).toBeInTheDocument()
  })

  it('T5 — MISMATCH se distingue visualmente y dice que los precios no reconcilian', async () => {
    render(<RevisionFiscal />)
    const tr = (await screen.findByText('Aparatología X')).closest('tr') as HTMLElement
    const pastilla = tr.querySelector('.pill.p-dang')
    expect(pastilla).not.toBeNull()
    expect(pastilla?.textContent).toBe('No reconcilia')
    fireEvent.click(tr)
    expect(await screen.findByText(/NO reconcilian con el listado publicado/)).toBeInTheDocument()
  })

  it('T6 — "Histórico +16%" nunca afirma que el IVA sea 16%', async () => {
    render(<RevisionFiscal />)
    await abrir('Sérum Oro')
    const adv = await screen.findByText(/no autoriza tratar este producto como gravado al 16%/)
    expect(adv).toBeInTheDocument()
    expect(screen.queryByText(/IVA 16% confirmado|por lo tanto IVA 16/i)).toBeNull()
  })

  it('T7 — EQUALS_FINAL niega explícitamente exento y tasa cero', async () => {
    mocks.cargarEvidencia.mockImplementation(async (pid?: string) =>
      pid === 'p1' ? [obs({ clasificacion: 'HISTORICAL_EQUALS_FINAL', precio_historico: 1160, precio_publicado: 1160 })] : HUERFANAS)
    render(<RevisionFiscal />)
    await abrir('Sérum Oro')
    expect(await screen.findByText(/NO significa exento, tasa cero ni no objeto/)).toBeInTheDocument()
  })
})

// ─────────── 10 · 11 · 12 ───────────
describe('T10/T11/T12 · validar es un acto humano explícito', () => {
  it('T10 — el comando NO se llama hasta que la persona confirma, y se le muestra qué aprueba', async () => {
    render(<RevisionFiscal />)
    await abrir('Sérum Oro')
    fireEvent.change(await screen.findByLabelText(/En qué te basas/), { target: { value: 'criterio del contador' } })
    const btn = screen.getByText('Validar este producto')
    fireEvent.click(btn)
    // Confirmación abierta: todavía ninguna llamada al servidor.
    expect(mocks.validarFiscal).not.toHaveBeenCalled()
    expect(await screen.findByText('Validar el dato fiscal')).toBeInTheDocument()
    const modal = screen.getByText('Validar el dato fiscal').closest('.modal') as HTMLElement
    expect(modal.textContent).toContain('Esto es lo que estás aprobando')
    // La clasificación COMPLETA que se aprueba, dentro de la propia confirmación.
    expect(modal.textContent).toContain('01010101')
    expect(modal.textContent).toContain('H87')
    expect(modal.textContent).toContain('Gravado')
    expect(modal.textContent).toContain('Sérum facial 30 ml')
    expect(modal.textContent).toContain('criterio del contador')
    fireEvent.click(screen.getByText('Sí, validar'))
    await waitFor(() => expect(mocks.validarFiscal).toHaveBeenCalledTimes(1))
    expect(mocks.validarFiscal).toHaveBeenCalledWith('p1', 'criterio del contador', undefined)
  })

  it('T11 — un producto incompleto no se puede validar, y se dice qué falta', async () => {
    render(<RevisionFiscal />)
    await abrir('Peeling Medio')
    const btn = await screen.findByText('Validar este producto')
    expect(btn.closest('button')).toBeDisabled()
    expect(screen.getByText(/No se puede validar un producto incompleto/)).toBeInTheDocument()
    // Aparece en la lista y en el detalle: lo que importa es que se nombre en español.
    expect(screen.getAllByText(/Clave de producto\/servicio del SAT/).length).toBeGreaterThan(0)
    fireEvent.click(btn)
    expect(mocks.validarFiscal).not.toHaveBeenCalled()
  })

  it('T12 — tras validar, la pantalla relee al servidor y refleja el estado nuevo', async () => {
    render(<RevisionFiscal />)
    await abrir('Sérum Oro')
    fireEvent.change(await screen.findByLabelText(/En qué te basas/), { target: { value: 'oficio SAT' } })
    // Ahora el servidor devolverá el producto YA validado.
    mocks.cargarRevisionFiscal.mockResolvedValueOnce([
      { ...PENDIENTE, validado: true, validado_at: '2026-10-01T10:00:00Z', validado_por_nombre: 'C.P. Ana Ruiz' },
      VALIDADO, INCOMPLETO, MISMATCH,
    ])
    fireEvent.click(screen.getByText('Validar este producto'))
    fireEvent.click(await screen.findByText('Sí, validar'))
    await waitFor(() => expect(mocks.cargarRevisionFiscal).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Producto validado/)).toBeInTheDocument()
  })
})

// ─────────── 13 ───────────
describe('T13 · cambiar un dato material de un producto validado avisa y refleja la invalidación', () => {
  it('avisa ANTES de guardar', async () => {
    render(<RevisionFiscal />)
    await abrir('Toxina Botulínica')
    const clave = await screen.findByLabelText(/Clave de unidad \(SAT\)/)
    fireEvent.change(clave, { target: { value: 'E48' } })
    expect(await screen.findByText(/Al guardar, la validación se retira/)).toBeInTheDocument()
  })

  it('y después de guardar informa que hay que volver a validar', async () => {
    mocks.editarFiscal.mockResolvedValueOnce({ ok: true, data: { validado: false, invalidado_por_el_cambio: true, faltantes: [] } })
    render(<RevisionFiscal />)
    await abrir('Toxina Botulínica')
    fireEvent.change(await screen.findByLabelText(/Clave de unidad \(SAT\)/), { target: { value: 'E48' } })
    fireEvent.click(screen.getByText('Guardar borrador'))
    expect(await screen.findByText(/quedó sin efecto porque cambió un dato fiscal material/)).toBeInTheDocument()
    expect(mocks.editarFiscal).toHaveBeenCalledWith('p2', { clave_unidad: 'E48' }, undefined)
  })

  it('cambiar notas NO avisa de invalidación: no es un dato material', async () => {
    render(<RevisionFiscal />)
    await abrir('Toxina Botulínica')
    const notas = await screen.findByLabelText(/Notas/)
    fireEvent.change(notas, { target: { value: 'revisado con el contador' } })
    expect(screen.queryByText(/Al guardar, la validación se retira/)).toBeNull()
  })
})

// ─────────── 15 · 16 ───────────
describe('T15/T16 · los candidatos por categoría son propuesta, no autoridad', () => {
  it('T15 — aplicar la propuesta pre-llena y reporta explícitamente 0 validados', async () => {
    render(<RevisionFiscal />)
    fireEvent.click(await screen.findByText(/Candidatos por categoría/))
    fireEvent.click(await screen.findByText('Aplicar propuesta'))
    expect(await screen.findByText(/No se validará ningún producto/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Aplicar propuesta', { selector: '.modal button' }))
    await waitFor(() => expect(mocks.aplicarPropuestaCategoria).toHaveBeenCalledWith('Sérum'))
    expect(await screen.findByText(/4 producto\(s\) pre-llenado\(s\) y 0 validado\(s\)/)).toBeInTheDocument()
  })

  it('T16 — la pantalla declara que no pisa valores ni toca productos validados', async () => {
    render(<RevisionFiscal />)
    fireEvent.click(await screen.findByText(/Candidatos por categoría/))
    expect(await screen.findByText(/nunca pisa un valor ya capturado/)).toBeInTheDocument()
    expect(screen.getByText(/nunca toca un producto validado/)).toBeInTheDocument()
    expect(screen.getByText(/nunca valida nada/)).toBeInTheDocument()
  })

  it('T17b — no hay ningún control que valide la categoría completa', async () => {
    render(<RevisionFiscal />)
    fireEvent.click(await screen.findByText(/Candidatos por categoría/))
    await screen.findByText('Aplicar propuesta')
    expect(screen.queryByText(/Validar categoría|Validar todos|Aprobar categoría/i)).toBeNull()
  })
})

// ─────────── 20 · 21 ───────────
describe('T20/T21 · las 12 observaciones sin producto', () => {
  it('T20 — se representan todas, con su motivo', async () => {
    render(<RevisionFiscal />)
    fireEvent.click(await screen.findByText(/Evidencia sin producto \(12\)/))
    expect(await screen.findByText('Histórico sin producto 0')).toBeInTheDocument()
    expect(screen.getByText('Histórico sin producto 11')).toBeInTheDocument()
    expect(screen.getByText('nombre ambiguo entre dos productos')).toBeInTheDocument()
    expect(screen.getAllByText('sin producto canónico equivalente')).toHaveLength(11)
  })

  it('T21 — desde ahí no se crea ni se asocia nada: la sección es de solo lectura', async () => {
    render(<RevisionFiscal />)
    fireEvent.click(await screen.findByText(/Evidencia sin producto \(12\)/))
    await screen.findByText('Histórico sin producto 0')
    // Ningún CONTROL ofrece crear ni asociar. (La prosa sí usa esas palabras: para negarlas.)
    const controles = [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')]
    for (const c of controles) expect(c.textContent ?? '').not.toMatch(/crear|asociar|vincular|mapear/i)
    // El <b>no</b> parte el nodo de texto: se compara el párrafo completo.
    expect(screen.getByText((_t, el) => el?.tagName === 'P'
      && (el.textContent ?? '').includes('no se crean productos ni se asocian observaciones'))).toBeInTheDocument()
    // Ningún botón en la tabla de huérfanas.
    const tabla = screen.getByText('Histórico sin producto 0').closest('table') as HTMLElement
    expect(tabla.querySelectorAll('button')).toHaveLength(0)
  })
})

// ─────────── 9 (UX) · estados de seguridad ───────────
describe('T9b/T19b · estados de carga, vacío y falla', () => {
  it('mientras carga lo dice, y no muestra un catálogo vacío como si estuviera completo', async () => {
    mocks.cargarRevisionFiscal.mockImplementationOnce(() => new Promise(() => {}))
    render(<RevisionFiscal />)
    expect(await screen.findByText(/Cargando el catálogo fiscal/)).toBeInTheDocument()
  })

  it('catálogo vacío se explica, no se confunde con "todo validado"', async () => {
    mocks.cargarRevisionFiscal.mockResolvedValueOnce([])
    render(<RevisionFiscal />)
    expect(await screen.findByText(/Todavía no hay productos vendibles con ficha fiscal/)).toBeInTheDocument()
  })

  it('una negativa del servidor se muestra en lenguaje de operador', async () => {
    mocks.editarFiscal.mockResolvedValueOnce({ ok: false, error: 'No tienes permiso para esta operación.' })
    render(<RevisionFiscal />)
    await abrir('Sérum Oro')
    fireEvent.change(await screen.findByLabelText(/Clave de unidad \(SAT\)/), { target: { value: 'E48' } })
    fireEvent.click(screen.getByText('Guardar borrador'))
    expect(await screen.findByText('No tienes permiso para esta operación.')).toBeInTheDocument()
  })
})
