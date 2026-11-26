// FACTURA GLOBAL MENSUAL (26 nov 2026, dueño): un concepto por venta (por tasa), 01010101/ACT, público en general 616/S01,
// InformacionGlobal mensual; nada se timbra sin claves validadas.
import { describe, it, expect } from 'vitest'
import { armarGlobal, comprobanteGlobal, type PreparadoGlobal, type LineaFiscal } from '../../../../../supabase/functions/_shared/cfdiConceptos'
import mig from '../../../../../supabase/migrations/20270408030000_factura_global.sql?raw'

const ok = { clave_prod_serv: '53131619', clave_unidad: 'H87', objeto_imp: '02', descripcion_fiscal: 'x', validado: true }
const g16 = (nombre: string, qty: number, unit_price: number): LineaFiscal => ({ product_id: nombre, sku: nombre, nombre, qty, unit_price, ...ok, tratamiento_iva: 'gravado', iva_tasa: 0.16 })
const t0 = (nombre: string, qty: number, unit_price: number): LineaFiscal => ({ product_id: nombre, sku: nombre, nombre, qty, unit_price, ...ok, tratamiento_iva: 'tasa_cero', iva_tasa: 0 })
const base = (pedidos: PreparadoGlobal['pedidos']): PreparadoGlobal => ({ anio: 2026, mes: 11, periodo_fin: '2026-11-30', emisor: { rfc: 'REN160406PSA', razon_social: 'RENOVACELL', regimen_fiscal: '601', cp: '80020' }, envio: null, pedidos, faltantes: [] })

describe('factura global mensual', () => {
  it('un concepto por venta y por tasa; total al centavo; forma de pago dominante', () => {
    const p = base([
      { order_id: 'a', folio: 'S1', total: 1160, shipping_cost: 0, lineas: [g16('NAB', 1, 1160)], cobros: [{ method: 'transferencia', amount: 1160 }] },
      { order_id: 'b', folio: 'S2', total: 3160, shipping_cost: 0, lineas: [g16('NAB', 1, 1160), t0('MOUN', 1, 2000)], cobros: [{ method: 'efectivo', amount: 3160 }] },
    ])
    const a = armarGlobal(p)
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(a.items).toHaveLength(3)
    expect(a.items.every((i) => i.ProductCode === '01010101' && i.UnitCode === 'ACT' && i.Quantity === 1 && i.Description === 'Venta')).toBe(true)
    expect(a.items.map((i) => i.IdentificationNumber)).toEqual(['S1', 'S2', 'S2'])
    expect(a.total).toBe(4320); expect(a.iva).toBe(320); expect(a.formaPago).toBe('01')
    const c = comprobanteGlobal({ serie: 'REN', folio: '7', provider_date_sent: '2026-12-01T10:00:00', order_number: 'G-x' }, p, a) as Record<string, any>
    expect(c.Receiver).toEqual({ Rfc: 'XAXX010101000', Name: 'PUBLICO EN GENERAL', CfdiUse: 'S01', FiscalRegime: '616', TaxZipCode: '80020' })
    expect(c.GlobalInformation).toEqual({ Periodicity: '04', Months: '11', Year: 2026 })
  })
  it('sin claves validadas no se timbra y dice qué falta', () => {
    const a = armarGlobal(base([{ order_id: 'a', folio: 'S1', total: 100, shipping_cost: 0, lineas: [{ ...g16('NAB', 1, 100), validado: false }], cobros: [{ method: 'efectivo', amount: 100 }] }]))
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.faltantes.join(' ')).toMatch(/no está validada/)
  })
  it('servidor: una venta en una sola global, bloquea la factura del cliente, no antes de cerrar el mes', () => {
    expect(mig).toMatch(/create unique index uq_fgp_pedido on public\.fiscal_global_pedidos \(order_id\)/)
    expect(mig).toMatch(/FACTURA_EN_GLOBAL/)
    expect(mig).toMatch(/GLOBAL_MES_ABIERTO/)
    expect(mig).toMatch(/delete from public\.fiscal_global_pedidos where global_id = p_id;/)   // fallido libera
  })
})
