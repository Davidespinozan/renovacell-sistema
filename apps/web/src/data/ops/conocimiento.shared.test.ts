// CC-3 · Lógica pura compartida con la Edge: la audiencia se deriva del rol+verificación (la
// base manda), los campos prohibidos nunca llegan a un prompt, la ficha para la IA solo lleva
// lo aprobado con su fuente y declara lo que NO sabe, los errores se traducen sin filtrar SQL.
import { describe, it, expect } from 'vitest'
import { resolverAudiencia, filtrarCamposProhibidos, fichaParaIA, candidatosParaIA, mapearErrorConocimiento, nivelDe, SECCIONES, REGLAS_IA, type Ficha } from '../../../../../supabase/functions/_shared/conocimiento'
import { mensajeError, SECCIONES as SECCIONES_UI } from './conocimiento'

describe('audiencia', () => {
  it('anon/sin rol → public; doctor verificado → verified; doctor sin verificar → public; personal → verified; admin → staff', () => {
    expect(resolverAudiencia(null)).toBe('public')
    expect(resolverAudiencia({ role: '', verified: true })).toBe('public')
    expect(resolverAudiencia({ role: 'doctor', verified: true })).toBe('verified')
    expect(resolverAudiencia({ role: 'doctor', verified: false })).toBe('public')
    for (const r of ['pos', 'billing', 'comm', 'warehouse', 'packing', 'driver']) expect(resolverAudiencia({ role: r, verified: false })).toBe('verified')
    expect(resolverAudiencia({ role: 'admin', verified: false })).toBe('staff')
  })
  it('las secciones y niveles coinciden entre la Edge y la UI (lista cerrada única)', () => {
    expect(Object.keys(SECCIONES).sort()).toEqual(SECCIONES_UI.map((s) => s.key).sort())
    for (const s of SECCIONES_UI) expect(nivelDe(s.key)).toBe(s.nivel)
    expect(nivelDe('precio')).toBeNull(); expect(nivelDe('stock')).toBeNull()
  })
})

describe('defensa en profundidad', () => {
  it('precio/costo/stock/fiscal/metadata se eliminan a cualquier profundidad; el resto se conserva', () => {
    const r = filtrarCamposProhibidos({ nombre: 'X', price: 100, costo: 5, stock_total: 3, metadata: { secreto: 1 }, sat_clave: '1', variantes: [{ nombre: 'Y', pvp: 9, unit_cost: 2 }], conocimiento: { resumen: { contenido: 'ok', fiscal: 'no' } } })
    expect(r).toEqual({ nombre: 'X', variantes: [{ nombre: 'Y' }], conocimiento: { resumen: { contenido: 'ok' } } })
  })
})

describe('ficha para la IA', () => {
  const ficha: Ficha = {
    product_id: 'p1', nombre: 'Alfa 2 ml', familia: 'Alfa', categoria: 'Rellenos', presentacion: 'Caja con 2 jeringas', unidad: 'Caja/2', audiencia: 'public',
    conocimiento: { resumen: { nivel: 'T0', contenido: 'Gel de AH.', version: 2 }, composicion: { nivel: 'T1', contenido: 'AH 20 mg/ml', version: 1, fuente: { tipo: 'ficha_tecnica', referencia: 'FT Alfa', version: '2026-01' } } },
    relaciones: [{ tipo: 'comparable', product_id: 'p2', nombre: 'Beta' }], disclaimers: ['Uso profesional'], niveles_disponibles: ['T0', 'T1'],
    ...({ price: 999, stock: 4 } as object),
  }
  it('lleva identidad, secciones con nivel y fuente, relaciones con tipo, avisos, y declara lo que falta (T2)', () => {
    const t = fichaParaIA(ficha)
    expect(t).toContain('PRODUCTO: Alfa 2 ml · familia Alfa · Rellenos')
    expect(t).toContain('Presentación: Caja con 2 jeringas (Caja/2)')
    expect(t).toContain('[T0] Resumen: Gel de AH.')
    expect(t).toContain('[T1] Composición: AH 20 mg/ml (fuente: ficha_tecnica · FT Alfa 2026-01)')
    expect(t).toContain('Relaciones curadas: comparable → Beta')
    expect(t).toContain('Avisos: Uso profesional')
    expect(t).toContain('Sin información T2 disponible para esta audiencia: no la inventes')
    expect(t).not.toMatch(/999|stock|price/)
  })
  it('null → cadena vacía; sin candidatos → instrucción explícita de no proponer', () => {
    expect(fichaParaIA(null)).toBe('')
    expect(candidatosParaIA([])).toMatch(/No propongas productos que no estén en esta lista/)
    expect(candidatosParaIA([{ product_id: 'p1', nombre: 'Alfa', motivo: 'categoria', ...({ price: 1 } as object) }])).toBe('- Alfa (categoria) · id p1')
  })
  it('las reglas del sistema prohíben inventar, afirmar precio/stock y confundir relacionado con sustituto', () => {
    const r = REGLAS_IA.join(' ')
    expect(r).toMatch(/No inventes/); expect(r).toMatch(/precio, existencia, costo/); expect(r).toMatch(/"Relacionado" no significa "sustituto"/); expect(r).toMatch(/cura, garantiza/)
  })
})

describe('errores', () => {
  it('cada código tiene HTTP y texto estable; desconocidos → 503 sin SQL', () => {
    expect(mapearErrorConocimiento('NO_AUTORIZADO: solo Dirección')).toMatchObject({ status: 403, body: { error: 'no_autorizado' } })
    expect(mapearErrorConocimiento('T2_BLOQUEADO')).toMatchObject({ status: 409, body: { error: 't2_bloqueado' } })
    expect(mapearErrorConocimiento('FUENTE_REQUERIDA: T1')).toMatchObject({ status: 409, body: { error: 'fuente_requerida' } })
    expect(mapearErrorConocimiento('CLAIM_PROHIBIDO: x')).toMatchObject({ status: 409 })
    expect(mapearErrorConocimiento('REV_DESACTUALIZADA')).toMatchObject({ status: 409, body: { error: 'rev_desactualizada' } })
    expect(mapearErrorConocimiento('PRODUCTO_INEXISTENTE')).toMatchObject({ status: 404 })
    const d = mapearErrorConocimiento('syntax error at line 3 near select * from products')
    expect(d.status).toBe(503); expect(JSON.stringify(d.body)).not.toMatch(/select|products|syntax/)
  })
  it('la UI traduce los mismos códigos a español operable', () => {
    expect(mensajeError('T2_BLOQUEADO: …')).toMatch(/habilitar T2/)
    expect(mensajeError('CLAIM_REQUIERE_T2')).toMatch(/clínic/)
    expect(mensajeError('REV_DESACTUALIZADA')).toMatch(/otra sesión/)
  })
})
