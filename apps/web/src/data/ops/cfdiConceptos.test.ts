// TIMBRADO REAL (2 nov 2026) · el comprobante se arma desde el precio FINAL, cuadra al centavo y no inventa nada.
import { describe, it, expect } from 'vitest'
import { armarConceptos, baseDesdeTotal, comprobante, concepto, formaDePago, type Preparado } from '../../../../../supabase/functions/_shared/cfdiConceptos'
import cfdiSrc from '../../../../../supabase/functions/cfdi/index.ts?raw'

const f16 = { clave_prod_serv: '51182001', clave_unidad: 'H87', objeto_imp: '02', tratamiento_iva: 'gravado', iva_tasa: 0.16, descripcion_fiscal: 'TOXINA BOTULINICA', validado: true }
const base = (over: Partial<Preparado> = {}): Preparado => ({
  doc_id: 'd1', status: 'pendiente',
  receiver: { rfc: 'CPR010101AB1', razon_social: 'CLINICA PRUEBA', regimen: '601', cp: '80000', uso_cfdi: 'G03', email_facturacion: 'f@p.mx' },
  order: { id: 'o1', folio: 'S1', status: 'paid', payment_status: 'paid', total: 2320, shipping_cost: 0, currency: 'MXN' },
  lineas: [{ product_id: 'p1', sku: 'BTX100', nombre: 'Botox 100', qty: 2, unit_price: 1160, ...f16 }],
  envio: null, cobros: [{ method: 'transferencia', amount: 2320 }],
  emisor: { rfc: 'REN160406PSA', razon_social: 'RENOVACELL', regimen_fiscal: '601', cp: '80020' }, faltantes: [], listo: true, ...over,
})

describe('IVA desde el precio final', () => {
  it('desglosa exacto a 2 decimales cuando se puede, y a 6 cuando no', () => {
    expect(baseDesdeTotal(1160, 0.16)).toEqual({ base: 1000, iva: 160 })
    const b = baseDesdeTotal(1.2, 0.16)!   // sin base de 2 decimales que cuadre
    expect(Math.abs(b.base + b.iva - 1.2)).toBeLessThanOrEqual(1e-6)
    for (const t of [0.01, 1.27, 99.99, 4600, 12345.67]) { const x = baseDesdeTotal(t, 0.16)!; expect(Math.abs(x.base + x.iva - t)).toBeLessThanOrEqual(1e-6) }
  })
  it('concepto gravado, tasa cero y no objeto; exento y objeto 03 se rechazan con motivo', () => {
    const g = concepto('Botox', 'BTX', 2, 2320, f16); expect(g.ok && g.item.Subtotal === 2000 && g.item.Taxes![0].Total === 320 && g.item.Total === 2320).toBe(true)
    const c = concepto('X', null, 1, 500, { ...f16, tratamiento_iva: 'tasa_cero', iva_tasa: 0 }); expect(c.ok && c.item.Taxes![0].Rate === 0 && c.item.Total === 500).toBe(true)
    const n = concepto('X', null, 1, 500, { ...f16, objeto_imp: '01', tratamiento_iva: 'no_objeto', iva_tasa: null }); expect(n.ok && n.item.TaxObject === '01' && !n.item.Taxes).toBe(true)
    expect(concepto('X', null, 1, 500, { ...f16, tratamiento_iva: 'exento', iva_tasa: null })).toMatchObject({ ok: false })
    expect(concepto('X', null, 1, 500, { ...f16, validado: false })).toMatchObject({ ok: false })
  })
})

describe('forma de pago', () => {
  it('transferencia 03, efectivo 01; tarjeta exige crédito o débito; el dominante manda', () => {
    expect(formaDePago([{ method: 'transferencia', amount: 10 }])).toEqual({ ok: true, forma: '03' })
    expect(formaDePago([{ method: 'efectivo', amount: 90 }, { method: 'transferencia', amount: 10 }])).toEqual({ ok: true, forma: '01' })
    expect(formaDePago([{ method: 'tarjeta', amount: 10 }])).toMatchObject({ ok: false, requiere: 'tarjeta' })
    expect(formaDePago([{ method: 'tarjeta', amount: 10 }], '28')).toEqual({ ok: true, forma: '28' })
  })
})

describe('comprobante completo', () => {
  it('cuadra con el pedido e incluye forma, método PUE y exportación', () => {
    const a = armarConceptos(base()); expect(a.ok).toBe(true)
    if (!a.ok) return
    const c = comprobante({ serie: 'REN', folio: '1', provider_date_sent: '2026-11-02T12:00:00', order_number: 'd1' }, base(), a)
    expect(c).toMatchObject({ NameId: '1', Serie: 'REN', Folio: '1', Date: '2026-11-02T12:00:00', CfdiType: 'I', ExpeditionPlace: '80020', PaymentForm: '03', PaymentMethod: 'PUE', Exportation: '01', Currency: 'MXN' })
    expect((c.Receiver as Record<string, string>).Rfc).toBe('CPR010101AB1')
  })
  it('lo que falta se dice y no se timbra: sin validar, envío, público en general, total que no cuadra', () => {
    expect(armarConceptos(base({ lineas: [{ ...base().lineas[0], validado: false }] }))).toMatchObject({ ok: false })
    expect(armarConceptos(base({ order: { ...base().order, shipping_cost: 290, total: 2610 } }))).toMatchObject({ ok: false, faltantes: expect.arrayContaining([expect.stringMatching(/^Envío/)]) })
    expect(armarConceptos(base({ receiver: { ...base().receiver, rfc: 'XAXX010101000' } }))).toMatchObject({ ok: false })
    expect(armarConceptos(base({ order: { ...base().order, total: 2400 } }))).toMatchObject({ ok: false, faltantes: [expect.stringMatching(/no se timbra/)] })
    expect(armarConceptos(base({ faltantes: ['El pedido debe estar pagado.'] }))).toMatchObject({ ok: false, faltantes: ['El pedido debe estar pagado.'] })
  })
})

describe('Edge cfdi', () => {
  it('arma TODO antes del reclamo (sin claves no se consume folio) y nunca reintenta un incierto', () => {
    const arma = cfdiSrc.indexOf("if (accion === 'timbrar') {"); const reclama = cfdiSrc.indexOf("caller.rpc('reclamar_cfdi'")
    expect(cfdiSrc.indexOf('const a = armarConceptos(prep, b.forma_pago)', arma)).toBeLessThan(reclama)
    expect(cfdiSrc).toMatch(/resolverFacturama\(Deno\.env\.get\('FACTURAMA_ENV'\)\)/)
    expect(cfdiSrc).toMatch(/buscarPorSerieFolio[\s\S]*adoptar_cfdi[\s\S]*replay_permitido/)
    expect(cfdiSrc).not.toMatch(/FACTURAMA_URL/)
  })
})
