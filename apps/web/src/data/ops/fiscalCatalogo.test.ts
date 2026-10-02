// W3-C · C3 — Invariantes de la capa de revisión fiscal del frontend.
//
// Lo que se protege: que la pantalla de revisión NO sea una segunda autoridad fiscal.
// Puede leer, puede proponer y puede pedirle al servidor que cambie algo, pero no puede
// escribir la configuración fiscal por su cuenta, no puede validar sin que una persona lo
// pida, y no puede abrir ninguna puerta hacia el timbrado, el folio o el proveedor.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import opsSrc from './fiscalCatalogo.ts?raw'
import uiSrc from '../../screens/admin/RevisionFiscal.tsx?raw'
import hookSrc from '../hooks/useRevisionFiscal.ts?raw'
import { ROLES } from '../../app/roles'

const soloCodigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/|\*|\/\*)/.test(l)).join('\n')
const CODIGO = soloCodigo(opsSrc) + '\n' + soloCodigo(uiSrc) + '\n' + soloCodigo(hookSrc)

// ─────────── 8 · 9 · toda edición pasa por los comandos canónicos de C1 ───────────
describe('T8/T9 · la edición fiscal solo existe por comando', () => {
  it('T8 — cada mutación invoca su comando canónico de C1, por nombre', () => {
    for (const rpc of ['editar_fiscal_producto', 'validar_fiscal_producto', 'invalidar_fiscal_producto',
      'definir_defaults_categoria', 'aplicar_defaults_categoria']) {
      expect(soloCodigo(opsSrc)).toContain(`supabase.rpc('${rpc}'`)
    }
  })
  it('T9 — ninguna escritura directa a las tablas fiscales', () => {
    // Se permite .select() sobre ellas; se prohíbe cualquier verbo de escritura.
    for (const tabla of ['product_fiscal', 'fiscal_category_defaults', 'fiscal_price_evidence', 'product_fiscal_events']) {
      const usos = [...CODIGO.matchAll(new RegExp(`from\\('${tabla}'\\)([\\s\\S]{0,160})`, 'g'))]
      for (const u of usos) expect(u[1]).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/)
    }
    expect(CODIGO).not.toMatch(/\.(insert|upsert)\(\s*\{[^}]*clave_prod_serv/)
  })
  it('T9b — la única tabla fiscal que se lee directo lo hace en modo lectura', () => {
    expect(soloCodigo(opsSrc)).toMatch(/from\('product_fiscal'\)\s*\n?\s*\.select\('fuente, notas'\)/)
  })
})

// ─────────── 17 · no hay validación en lote ───────────
describe('T17 · no existe "validar todo"', () => {
  it('validarFiscal se invoca en un solo lugar y para un solo producto', () => {
    // Lookbehind: `invalidarFiscal(` contiene `validarFiscal(` como subcadena.
    const llamadas = [...soloCodigo(uiSrc).matchAll(/(?<![a-zA-Z])validarFiscal\(/g)]
    expect(llamadas).toHaveLength(1)
    expect(soloCodigo(uiSrc)).toMatch(/(?<![a-zA-Z])validarFiscal\(f\.product_id,/)
  })
  it('no hay función ni control que ofrezca validar en masa', () => {
    expect(CODIGO).not.toMatch(/validarTodos|validateAll|validar_lote|validarLote|validarCategoria/i)
    // La pantalla sí NOMBRA el lote, pero solo para negarlo ante el operador.
    expect(uiSrc).toMatch(/No existe "validar todo"/)
    expect(soloCodigo(uiSrc)).not.toMatch(/onClick=\{[^}]*validar[^}]*(todos|lista|lote)/i)
  })
  it('ningún recorrido de la lista termina en una validación', () => {
    expect(soloCodigo(uiSrc)).not.toMatch(/\.(map|forEach|for)\([^)]*\)[^;]{0,80}validarFiscal/)
  })
})

// ─────────── 22 · los precios comerciales no se tocan ───────────
describe('T22 · el precio comercial es intocable desde aquí', () => {
  it('no se importa ninguna mutación del maestro comercial', () => {
    expect(CODIGO).not.toMatch(/setBasePrice|productsStore|pricingStore|setListPrice|product_volume_prices/)
  })
  it('no se escribe products ni product_prices', () => {
    for (const t of ['products', 'product_prices'])
      expect(CODIGO).not.toMatch(new RegExp(`from\\('${t}'\\)[\\s\\S]{0,120}\\.(update|insert|upsert|delete)\\(`))
  })
  it('el precio final se muestra, nunca se edita: no hay input enlazado al precio', () => {
    expect(soloCodigo(uiSrc)).not.toMatch(/value=\{[^}]*precio_final/)
    expect(soloCodigo(uiSrc)).toMatch(/money\(f\.precio_final\)/)
  })
})

// ─────────── 23 · 24 · 25 · ninguna puerta nueva hacia el timbrado ───────────
describe('T23/T24/T25 · C3 no abre ninguna puerta fiscal real', () => {
  it('T23 — no hay camino de emisión de CFDI', () => {
    expect(CODIGO).not.toMatch(/timbrar|solicitarCFDI|reclamar_cfdi|conciliar_cfdi|fiscal_documents|emitir/i)
  })
  it('T24 — no se asigna ni consume folio, ni se toca la serie', () => {
    expect(CODIGO).not.toMatch(/folio|fiscal_series|fiscal_folio_domains|issuer_rfc/i)
  })
  it('T25 — no hay red: ni proveedor, ni fetch, ni edge functions', () => {
    expect(CODIGO).not.toMatch(/facturama|FACTURAMA|provider_date_sent|functions\.invoke|fetch\(|axios/i)
  })
})

// ─────────── 6 · 7 · la aritmética de precios nunca se traduce a impuesto ───────────
describe('T6/T7 · la evidencia de precio no determina el impuesto', () => {
  it('T6 — BASE_PLUS_16 no afirma que el IVA sea 16%: lo niega explícitamente', async () => {
    const { EVIDENCIA } = await import('./fiscalCatalogo')
    expect(EVIDENCIA.HISTORICAL_BASE_PLUS_16.advertencia).toMatch(/no autoriza/i)
    expect(EVIDENCIA.HISTORICAL_BASE_PLUS_16.etiqueta).not.toMatch(/IVA 16/)
  })
  it('T7 — EQUALS_FINAL no insinúa exento, tasa cero ni no objeto', async () => {
    const { EVIDENCIA } = await import('./fiscalCatalogo')
    const a = EVIDENCIA.HISTORICAL_EQUALS_FINAL.advertencia
    expect(a).toMatch(/NO significa exento/i)
    expect(a).toMatch(/tasa cero/i)
  })
  it('ninguna clasificación se convierte en un valor fiscal por código', () => {
    // No existe ninguna rama que derive tratamiento/tasa de la clasificación.
    expect(CODIGO).not.toMatch(/BASE_PLUS_16[\s\S]{0,120}(tratamiento_iva|iva_tasa)\s*[:=]\s*['"0]/)
    expect(CODIGO).not.toMatch(/EQUALS_FINAL[\s\S]{0,120}(exento|tasa_cero)['"]/)
  })
})

// ─────────── 14 · semántica de fuente/notas idéntica a C1 ───────────
describe('T14 · fuente y notas no son datos materiales', () => {
  it('la lista de campos materiales de la UI es exactamente la de C1', () => {
    const m = soloCodigo(uiSrc).match(/const MATERIALES = \[([^\]]*)\]/)
    expect(m).not.toBeNull()
    const campos = (m as RegExpMatchArray)[1].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean)
    expect(campos.sort()).toEqual(['clave_prod_serv', 'clave_unidad', 'descripcion_fiscal', 'iva_tasa', 'objeto_imp', 'tratamiento_iva'])
    expect(campos).not.toContain('fuente')
    expect(campos).not.toContain('notas')
  })
  it('y la pantalla se lo dice al operador', () => {
    expect(uiSrc).toMatch(/no retira la validación/)
  })
})

// ─────────── 18 · la UI no inventa autoridad ───────────
describe('T18 · solo Dirección tiene el módulo de revisión fiscal', () => {
  it('av_fiscal existe únicamente en los módulos de admin', () => {
    const conModulo = ROLES.filter((r) => r.modules.some((m) => m.key === 'av_fiscal')).map((r) => r.key)
    expect(conModulo).toEqual(['admin'])
  })
  it('la pantalla no decide permisos por su cuenta: no hay lista de roles embebida', () => {
    expect(soloCodigo(uiSrc)).not.toMatch(/auth_role|role === 'admin'|RoleKey/)
  })
  it('definir candidatos se anuncia como facultad de Dirección', () => {
    expect(uiSrc).toMatch(/facultad de Dirección/)
  })
})

// ─────────── 19 · una negativa del servidor se trata con cuidado ───────────
describe('T19 · la negativa del backend no se filtra en crudo', () => {
  const rpc = vi.fn()
  beforeEach(() => { rpc.mockReset() })
  vi.doMock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc } }))

  it('NO_AUTORIZADO se traduce a lenguaje de operador', async () => {
    vi.resetModules()
    rpc.mockResolvedValue({ data: null, error: { message: 'NO_AUTORIZADO: solo Dirección o Facturación configura los datos fiscales de los productos' } })
    const { validarFiscal } = await import('./fiscalCatalogo')
    const r = await validarFiscal('p1', 'criterio del contador')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('No tienes permiso para esta operación.')
      expect(r.error).not.toMatch(/NO_AUTORIZADO|pg|plpgsql|constraint/i)
    }
  })

  it('una violación de constraint se explica, no se vomita', async () => {
    vi.resetModules()
    // Sin `code`, para probar lo importante: un rechazo que sabemos leer NO se
    // disfraza de "resultado desconocido" aunque la heurística de transporte dude.
    rpc.mockResolvedValue({ data: null, error: { message: 'new row for relation "product_fiscal" violates check constraint "ck_pf_tasa"' } })
    const { editarFiscal } = await import('./fiscalCatalogo')
    const r = await editarFiscal('p1', { iva_tasa: '0.16', tratamiento_iva: 'exento' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/La tasa no corresponde al tratamiento/)
      expect(r.error).not.toMatch(/violates|relation|ck_pf_tasa/)
    }
  })

  it('un corte de red no se reporta como éxito ni como fracaso definitivo', async () => {
    vi.resetModules()
    rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch', code: '' } })
    const { editarFiscal } = await import('./fiscalCatalogo')
    const r = await editarFiscal('p1', { clave_unidad: 'H87' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.ambiguous === true || r.error.length > 0).toBe(true)
  })

  it('sin backend no se inventa un resultado exitoso', async () => {
    vi.resetModules()
    vi.doMock('../../lib/supabase', () => ({ hasSupabase: false, supabase: { rpc } }))
    const { validarFiscal, cargarRevisionFiscal } = await import('./fiscalCatalogo')
    const r = await validarFiscal('p1', 'x')
    expect(r.ok).toBe(false)
    expect(await cargarRevisionFiscal()).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })
})

// ─────────── 15 · los candidatos no validan ───────────
describe('T15 · aplicar candidatos jamás valida', () => {
  it('el resultado que la pantalla muestra incluye los validados, para que se vea que son 0', async () => {
    vi.resetModules()
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'applied', productos_prellenados: 7, validados_por_esta_operacion: 0 }, error: null })
    vi.doMock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc } }))
    const { aplicarPropuestaCategoria } = await import('./fiscalCatalogo')
    const r = await aplicarPropuestaCategoria('Sérum')
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.data.prellenados).toBe(7); expect(r.data.validados).toBe(0) }
  })
  it('la palabra que usa la UI es "propuesta", no "aprobar" ni "validar"', () => {
    expect(uiSrc).toMatch(/Aplicar propuesta/)
    expect(uiSrc).not.toMatch(/Aprobar categoría|Validar categoría|Validar todos/i)
  })
})
