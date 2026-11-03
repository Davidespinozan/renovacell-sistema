// PROMOCIÓN DESDE UN FLYER (2 nov 2026) · la petición lleva la imagen y el catálogo con la herramienta (auto: los 5.x piensan y no admiten forzarla); la
// respuesta se valida (solo ids del catálogo, precios > 0, fechas válidas) y nada inventado pasa.
import { describe, it, expect } from 'vitest'
import { leerRespuestaFlyer, peticionFlyer } from '../../../../../supabase/functions/_shared/promoFlyer'
import edgeSrc from '../../../../../supabase/functions/promo-flyer/index.ts?raw'

const cat = [{ id: 'p-botox', nombre: 'Botox 100 UI' }, { id: 'p-dys', nombre: 'Dysport 300 U' }]
const resp = (input: Record<string, unknown>) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'registrar_promocion', input }] })

describe('petición', () => {
  it('imagen + catálogo + herramienta (auto)', () => {
    const p = peticionFlyer('QUJD', 'image/png', cat, '2026-11-02') as { tool_choice: unknown; messages: Array<{ content: Array<Record<string, unknown>> }>; thinking?: unknown; system: string }
    expect(p.tool_choice).toEqual({ type: 'auto' }); expect(p.thinking).toBeUndefined()
    expect(p.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
    expect(String(p.messages[0].content[1].text)).toContain('p-botox | Botox 100 UI'); expect(p.system).toContain('Hoy es 2026-11-02')
  })
})

describe('respuesta', () => {
  it('limpia: ids fuera del catálogo a null, precios inválidos fuera, fechas al derecho', () => {
    const r = leerRespuestaFlyer(resp({ nombre: 'Promo Allergan', desde: '2026-11-25', hasta: '2026-11-10', condiciones: 'Hasta agotar existencias',
      lineas: [{ producto_id: 'p-botox', texto: 'Botox', min_qty: 1, precio: 4000 }, { producto_id: 'inventado', texto: 'Botox', min_qty: 5.4, precio: 3800 }, { producto_id: null, texto: 'Regalo', min_qty: 1, precio: 0 }], sin_leer: ['sello borroso'] }), cat)
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.promo).toMatchObject({ nombre: 'Promo Allergan', desde: '2026-11-10', hasta: '2026-11-25', condiciones: 'Hasta agotar existencias', sin_leer: ['sello borroso'] })
    expect(r.promo.lineas).toEqual([{ producto_id: 'p-botox', texto: 'Botox', min_qty: 1, precio: 4000 }, { producto_id: null, texto: 'Botox', min_qty: 5, precio: 3800 }])
  })
  it('sin la herramienta o con rechazo: error claro', () => {
    expect(leerRespuestaFlyer({ content: [{ type: 'text', text: 'hola' }] }, cat)).toMatchObject({ ok: false })
    expect(leerRespuestaFlyer({ stop_reason: 'refusal', content: [] }, cat)).toMatchObject({ ok: false })
  })
})

describe('Edge promo-flyer', () => {
  it('Dirección, Facturación, Almacén y Ventas; tipos y tamaño acotados, y no guarda nada', () => {
    expect(edgeSrc).toMatch(/tieneRol\(q\.quien, \['admin', 'billing', 'warehouse', 'pos'\]\)/)   // Almacén y Ventas también (2 nov 2026)
    expect(edgeSrc).toMatch(/TIPOS_IMAGEN[\s\S]*MAX_IMAGEN_FLYER/)
    expect(edgeSrc).not.toMatch(/\.insert\(|\.update\(|rpc\(/)
  })
})
