// PROMO-1 · El lector de texto pegado entiende el formato del proveedor tal cual lo manda el dueño; los helpers de
// previsualización dan la MISMA precedencia que precio_de/3 (LEAST entre base, volumen y promoción vigente).
import { describe, it, expect } from 'vitest'
import { leerPromoTexto, vigenciaTexto, etiquetaPromo } from './promociones'
import { effectiveUnitPrice, promoAplicada, volumePromoLabel, volumeTiers, promoTiers, type VolumeRule } from './volumePricing'
import { promosComoReglas } from '../store/promosStore'

const TEXTO = `Precios de promo allergan
Botox 
1 pieza $4,000
5 a 9 piezas $3,800
10 piezas $3,600
Skinvive $3,600
HarmonyCa $6,100
del 16 al 25 de octubre`

describe('PROMO-1 · leer el texto del proveedor', () => {
  it('entiende el ejemplo del dueño: nombre, escalones de Botox, SkinVive, HarmonyCa y la vigencia', () => {
    const l = leerPromoTexto(TEXTO, 2026)
    expect(l.nombre).toBe('Promo allergan')
    expect(l.desde).toBe('2026-10-16'); expect(l.hasta).toBe('2026-10-25')
    expect(l.lineas).toEqual([
      { texto: 'Botox', min_qty: 1, precio: 4000 }, { texto: 'Botox', min_qty: 5, precio: 3800 }, { texto: 'Botox', min_qty: 10, precio: 3600 },
      { texto: 'Skinvive', min_qty: 1, precio: 3600 }, { texto: 'HarmonyCa', min_qty: 1, precio: 6100 },
    ])
    expect(l.sinLeer).toEqual([])
  })
  it('el texto pegado dos veces no duplica renglones', () => {
    const l = leerPromoTexto(TEXTO + '\n' + TEXTO, 2026)
    expect(l.lineas).toHaveLength(5)
  })
  it('otros formatos: "10 o más", rango con guion, sin vigencia', () => {
    const l = leerPromoTexto('Promoción octubre\nMascarilla GP $800\n10 o más piezas $700\n3-5 pzas $750', 2026)
    expect(l.nombre).toBe('Promo octubre')
    expect(l.lineas).toEqual([{ texto: 'Mascarilla GP', min_qty: 1, precio: 800 }, { texto: 'Mascarilla GP', min_qty: 10, precio: 700 }, { texto: 'Mascarilla GP', min_qty: 3, precio: 750 }])
    expect(l.desde).toBeNull(); expect(l.hasta).toBeNull()
  })
  it('textos de vigencia y etiqueta', () => {
    expect(vigenciaTexto({ desde: '2026-10-16', hasta: '2026-10-25' })).toBe('del 16 al 25 de oct')
    expect(vigenciaTexto({ desde: '2026-10-28', hasta: '2026-11-03' })).toBe('del 28 oct al 3 nov')
    expect(etiquetaPromo({ nombre: 'Promo Allergan', hasta: '2026-10-25' })).toBe('Promo Allergan · hasta el 25 oct')
  })
})

describe('PROMO-1 · precedencia en la previsualización (espeja precio_de/3)', () => {
  const vol: VolumeRule[] = [{ product_id: 'B', min_quantity: 20, price: 3000, active: true }]
  const promo = promosComoReglas([
    { promocion_id: 'P', nombre: 'Promo Allergan', desde: '2026-10-16', hasta: '2026-10-25', listas: null, product_id: 'B', min_qty: 1, precio: 4000 },
    { promocion_id: 'P', nombre: 'Promo Allergan', desde: '2026-10-16', hasta: '2026-10-25', listas: null, product_id: 'B', min_qty: 5, precio: 3800 },
    { promocion_id: 'P', nombre: 'Promo Allergan', desde: '2026-10-16', hasta: '2026-10-25', listas: null, product_id: 'B', min_qty: 10, precio: 3600 },
    { promocion_id: 'M', nombre: 'Solo Mayoreo', desde: '2026-10-16', hasta: '2026-10-25', listas: ['L2'], product_id: 'S', min_qty: 1, precio: 700 },
  ], null)
  const reglas = [...vol, ...promo]
  it('escalones de la promo por cantidad; el volumen más barato gana; sin promo queda el base', () => {
    expect(effectiveUnitPrice(4600, reglas, 'B', 1)).toBe(4000)
    expect(effectiveUnitPrice(4600, reglas, 'B', 4)).toBe(4000)
    expect(effectiveUnitPrice(4600, reglas, 'B', 5)).toBe(3800)
    expect(effectiveUnitPrice(4600, reglas, 'B', 10)).toBe(3600)
    expect(effectiveUnitPrice(4600, reglas, 'B', 20)).toBe(3000)   // volumen por debajo de la promo
    expect(effectiveUnitPrice(3500, reglas, 'B', 1)).toBe(3500)    // el precio normal ya es más bajo: se respeta
    expect(promoAplicada(4600, reglas, 'B', 5)?.price).toBe(3800); expect(promoAplicada(3500, reglas, 'B', 1)).toBeNull()
  })
  it('las promos de una lista solo se muestran si se conoce esa lista; sin conocerla (caja) se muestran todas', () => {
    expect(promo.some((r) => r.product_id === 'S')).toBe(false)                                   // portal con lista General
    expect(promosComoReglas([{ promocion_id: 'M', nombre: 'Solo Mayoreo', desde: '', hasta: '', listas: ['L2'], product_id: 'S', min_qty: 1, precio: 700 }], 'L2')).toHaveLength(1)
    expect(promosComoReglas([{ promocion_id: 'M', nombre: 'Solo Mayoreo', desde: '', hasta: '', listas: ['L2'], product_id: 'S', min_qty: 1, precio: 700 }], undefined)).toHaveLength(1)
  })
  it('la etiqueta del catálogo prefiere la promo vigente; la escalera de volumen sigue aparte', () => {
    expect(volumePromoLabel(4600, reglas, 'B')).toBe('Promo Allergan · hasta el 25 oct · desde 10 pzas $3,600')
    expect(volumeTiers(reglas, 'B').map((t) => t.min_quantity)).toEqual([20])
    expect(promoTiers(reglas, 'B').map((t) => t.min_quantity)).toEqual([1, 5, 10])
    expect(volumePromoLabel(1000, vol, 'B')).toMatch(/desde 20 pzas/i)
  })
})
