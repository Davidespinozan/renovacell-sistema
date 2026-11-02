// CONSTRUCCIÓN DEL COMPROBANTE (2 nov 2026) — puro, sin red ni Deno, probado con vitest.
// Toma lo que regresa `cfdi_preparar` (renglones con su configuración fiscal VALIDADA, envío, cobros, receptor
// congelado) y arma los conceptos de Facturama. Reglas que no se negocian:
//   · El precio comercial es FINAL: el IVA se obtiene DESDE el precio, nunca encima. Σ(total de conceptos) = total del
//     pedido al centavo; si no cuadra, no se timbra.
//   · Nada se inventa: sin configuración validada, sin forma de pago clara o con un caso no soportado (exento, objeto 03,
//     público en general), se rechaza con el motivo y NO se consume folio (esto corre antes del reclamo).
import { construirCFDI, type IdentidadCFDI } from './pac.ts'

export interface LineaFiscal {
  product_id: string; sku: string | null; nombre: string; qty: number; unit_price: number
  clave_prod_serv: string | null; clave_unidad: string | null; objeto_imp: string | null
  tratamiento_iva: string | null; iva_tasa: number | null; descripcion_fiscal: string | null; validado: boolean
}
export interface ConceptoFiscal { clave_prod_serv: string | null; clave_unidad: string | null; objeto_imp: string | null; tratamiento_iva: string | null; iva_tasa: number | null; descripcion_fiscal: string | null; validado: boolean }
export interface Preparado {
  doc_id: string; status: string
  receiver: { rfc: string; razon_social: string; regimen: string; cp: string; uso_cfdi: string; email_facturacion: string }
  order: { id: string; folio: string | null; status: string; payment_status: string; total: number; shipping_cost: number; currency: string }
  lineas: LineaFiscal[]; envio: ConceptoFiscal | null; cobros: Array<{ method: string; amount: number }>
  emisor: { rfc: string; razon_social: string; regimen_fiscal: string; cp: string }
  faltantes: string[]; listo: boolean
}
export interface ItemFacturama {
  ProductCode: string; IdentificationNumber?: string; Description: string; Unit: string; UnitCode: string
  UnitPrice: number; Quantity: number; Subtotal: number; TaxObject: string
  Taxes?: Array<{ Total: number; Name: 'IVA'; Base: number; Rate: number; IsRetention: false }>; Total: number
}
export type Armado = { ok: true; items: ItemFacturama[]; subtotal: number; iva: number; total: number; formaPago: string } | { ok: false; faltantes: string[] }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6
const UNIDAD: Record<string, string> = { H87: 'Pieza', E48: 'Unidad de servicio', XBX: 'Caja', XUN: 'Unidad', XKT: 'Kit', ACT: 'Actividad', MLT: 'Mililitro', LTR: 'Litro', GRM: 'Gramo', KGM: 'Kilogramo', XVI: 'Frasco', XAM: 'Ampolleta', XPK: 'Paquete', SET: 'Conjunto' }

/** Base sin IVA desde el precio final. Primero a 2 decimales si cuadra exacto; si no (≈14 % de los importes, p. ej.
 *  $1.20), a 6 decimales, que el SAT admite en el importe y el impuesto del concepto: base + IVA = total a 1e-6. */
export function baseDesdeTotal(total: number, tasa: number): { base: number; iva: number } | null {
  if (!(total > 0) || !(tasa > 0)) return null
  const ideal = r2(total / (1 + tasa))
  for (const d of [0, -0.01, 0.01]) {
    const base = r2(ideal + d); const iva = r2(base * tasa)
    if (base > 0 && r2(base + iva) === r2(total)) return { base, iva }
  }
  const base = r6(total / (1 + tasa)); const iva = r6(base * tasa)
  return Math.abs(base + iva - total) <= 1e-6 ? { base, iva } : null
}

/** Un concepto de Facturama desde un total final y su configuración fiscal validada. */
export function concepto(nombre: string, sku: string | null, qty: number, totalLinea: number, f: ConceptoFiscal): { ok: true; item: ItemFacturama; base: number; iva: number } | { ok: false; error: string } {
  if (!f.validado || !f.clave_prod_serv || !f.clave_unidad || !f.objeto_imp || !f.tratamiento_iva || !f.descripcion_fiscal) return { ok: false, error: `${nombre}: su configuración fiscal no está validada.` }
  if (!(qty > 0) || !(totalLinea > 0)) return { ok: false, error: `${nombre}: cantidad o importe inválido.` }
  const T = r2(totalLinea)
  const comun = { ProductCode: f.clave_prod_serv, ...(sku ? { IdentificationNumber: sku.slice(0, 100) } : {}), Description: f.descripcion_fiscal.slice(0, 1000), Unit: UNIDAD[f.clave_unidad] ?? 'NO APLICA', UnitCode: f.clave_unidad, Quantity: qty }
  if (f.objeto_imp === '01' && f.tratamiento_iva === 'no_objeto') {
    return { ok: true, base: T, iva: 0, item: { ...comun, UnitPrice: r6(T / qty), Subtotal: T, TaxObject: '01', Total: T } }
  }
  if (f.objeto_imp !== '02') return { ok: false, error: `${nombre}: objeto de impuesto ${f.objeto_imp} aún no soportado (usa 01 o 02).` }
  if (f.tratamiento_iva === 'tasa_cero') {
    return { ok: true, base: T, iva: 0, item: { ...comun, UnitPrice: r6(T / qty), Subtotal: T, TaxObject: '02', Taxes: [{ Total: 0, Name: 'IVA', Base: T, Rate: 0, IsRetention: false }], Total: T } }
  }
  if (f.tratamiento_iva === 'gravado') {
    const tasa = Number(f.iva_tasa)
    if (!(tasa > 0 && tasa < 1)) return { ok: false, error: `${nombre}: tasa de IVA inválida.` }
    const b = baseDesdeTotal(T, tasa)
    if (!b) return { ok: false, error: `${nombre}: no se pudo desglosar el IVA del precio final al centavo.` }
    return { ok: true, base: b.base, iva: b.iva, item: { ...comun, UnitPrice: r6(b.base / qty), Subtotal: b.base, TaxObject: '02', Taxes: [{ Total: b.iva, Name: 'IVA', Base: b.base, Rate: tasa, IsRetention: false }], Total: r6(b.base + b.iva) } }
  }
  return { ok: false, error: `${nombre}: IVA ${f.tratamiento_iva} aún no soportado para timbrar (lo confirmamos con el contador y el ambiente de pruebas).` }
}

// Forma de pago del SAT por el método con el que se cobró. Tarjeta: crédito (04) o débito (28) lo dice quien timbra.
const FORMA: Record<string, string> = { efectivo: '01', cheque: '02', transferencia: '03', otro: '99' }
export const FORMAS_VALIDAS = ['01', '02', '03', '04', '28', '99'] as const
export function formaDePago(cobros: Preparado['cobros'], elegida?: string | null): { ok: true; forma: string } | { ok: false; error: string; requiere?: 'tarjeta' } {
  if (elegida && (FORMAS_VALIDAS as readonly string[]).includes(elegida)) return { ok: true, forma: elegida }
  const dominante = [...cobros].sort((a, b) => b.amount - a.amount)[0]
  if (!dominante) return { ok: false, error: 'El pedido no tiene cobros registrados.' }
  if (dominante.method === 'tarjeta' || dominante.method === 'stripe') return { ok: false, error: 'Se cobró con tarjeta: indica si fue de crédito (04) o débito (28).', requiere: 'tarjeta' }
  const f = FORMA[dominante.method]
  return f ? { ok: true, forma: f } : { ok: false, error: `Método de cobro "${dominante.method}" sin forma de pago del SAT.` }
}

const GENERICO = /^X[AE]XX010101000$/
/** Todos los conceptos del pedido (productos + envío) y la forma de pago, o la lista de lo que falta. */
export function armarConceptos(p: Preparado, formaElegida?: string | null): Armado {
  const falta: string[] = [...(p.faltantes ?? [])]
  if (GENERICO.test(p.receiver?.rfc ?? '')) falta.push('Factura a público en general aún no soportada: captura el RFC del cliente.')
  const items: ItemFacturama[] = []; let base = 0; let iva = 0
  for (const l of p.lineas) {
    const c = concepto(l.nombre, l.sku, Number(l.qty), Number(l.qty) * Number(l.unit_price), l)
    if (c.ok) { items.push(c.item); base += c.base; iva += c.iva } else falta.push(c.error)
  }
  if (Number(p.order.shipping_cost) > 0) {
    if (!p.envio) falta.push('Envío: configura y valida su clave SAT en Revisión fiscal.')
    else { const c = concepto('Envío', null, 1, Number(p.order.shipping_cost), p.envio); if (c.ok) { items.push(c.item); base += c.base; iva += c.iva } else falta.push(c.error) }
  }
  const fp = formaDePago(p.cobros, formaElegida)
  if (!fp.ok) falta.push(fp.error)
  const total = r2(items.reduce((s, i) => s + i.Total, 0))
  // Con importes a 6 decimales, el redondeo del comprobante puede mover a lo más 1 centavo; más que eso, no se timbra.
  if (!falta.length && Math.abs(total - r2(Number(p.order.total))) > 0.01) falta.push(`Los conceptos suman ${total.toFixed(2)} y el pedido ${Number(p.order.total).toFixed(2)}: no se timbra.`)
  if (falta.length) return { ok: false, faltantes: [...new Set(falta)] }
  return { ok: true, items, subtotal: r2(base), iva: r2(iva), total, formaPago: (fp as { forma: string }).forma }
}

/** Sobre completo para POST /3/cfdis con la identidad congelada (serie, folio y Date del reclamo). */
export function comprobante(id: { serie: string; folio: string; provider_date_sent: string; order_number: string }, p: Preparado, a: Extract<Armado, { ok: true }>): Record<string, unknown> {
  const ident: IdentidadCFDI = {
    serie: id.serie, folio: id.folio, providerDateSent: id.provider_date_sent, orderNumber: id.order_number, expeditionPlace: p.emisor.cp, currency: p.order.currency || 'MXN',
    receiver: { Rfc: p.receiver.rfc, Name: p.receiver.razon_social, CfdiUse: p.receiver.uso_cfdi, FiscalRegime: p.receiver.regimen, TaxZipCode: p.receiver.cp },
  }
  return { NameId: '1', ...construirCFDI(ident, a.items), PaymentForm: a.formaPago, PaymentMethod: 'PUE', Exportation: '01' }
}
