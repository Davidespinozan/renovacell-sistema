// FACTURA DE PROVEEDOR (26 nov 2026) · forma común de lo que se lee de una factura (XML del CFDI o PDF leído por la IA).
// Pura: la usan la Edge (PDF) y la web (XML), y se prueba en vitest. Nada se da por bueno sin revisión: la pantalla
// muestra lo leído para que Dirección lo confirme o corrija antes de guardar.
export interface RenglonFactura { clave: string | null; descripcion: string; cantidad: number; costo_unitario: number; importe: number | null }
export interface FacturaLeida {
  proveedor: string; rfc: string | null; folio: string | null; uuid: string | null; fecha: string | null
  subtotal: number | null; total: number | null; renglones: RenglonFactura[]
}
const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null }
const txt = (v: unknown, max = 300): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const FECHA = /^(\d{4})-(\d{2})-(\d{2})/

/** Limpia lo que llega (de la IA o del XML) a la forma común; descarta renglones sin cantidad o sin descripción. */
export function normalizarFactura(x: unknown): FacturaLeida {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const rs = Array.isArray(o.renglones) ? o.renglones : []
  const renglones: RenglonFactura[] = []
  for (const r0 of rs.slice(0, 200)) {
    const r = (r0 && typeof r0 === 'object' ? r0 : {}) as Record<string, unknown>
    const cantidad = num(r.cantidad); const descripcion = txt(r.descripcion, 500)
    if (!descripcion || !cantidad || cantidad <= 0) continue
    let costo = num(r.costo_unitario); const importe = num(r.importe)
    if ((!costo || costo <= 0) && importe && importe > 0) costo = Math.round((importe / cantidad) * 100) / 100
    renglones.push({ clave: txt(r.clave, 100), descripcion, cantidad, costo_unitario: costo && costo > 0 ? costo : 0, importe: importe ?? null })
  }
  const uuid = String(o.uuid ?? '').match(UUID)?.[0]?.toUpperCase() ?? null
  const f = String(o.fecha ?? '').match(FECHA)
  const rfc = txt(o.rfc, 13)?.toUpperCase().replace(/[^A-Z0-9&Ñ]/g, '') || null
  return { proveedor: txt(o.proveedor, 200) ?? '', rfc: rfc && rfc.length >= 12 ? rfc : null, folio: txt(o.folio, 60), uuid, fecha: f ? `${f[1]}-${f[2]}-${f[3]}` : null,
    subtotal: num(o.subtotal), total: num(o.total), renglones }
}

/** Instrucción y esquema para que la IA lea un PDF de factura (tool forzada = JSON estructurado). */
export const HERRAMIENTA_FACTURA = {
  name: 'factura_proveedor',
  description: 'Datos de la factura de compra a un proveedor, tal como aparecen en el documento.',
  input_schema: {
    type: 'object',
    properties: {
      proveedor: { type: 'string', description: 'Nombre o razón social del EMISOR (quien vende)' },
      rfc: { type: 'string', description: 'RFC del emisor' },
      folio: { type: 'string', description: 'Serie y folio de la factura' },
      uuid: { type: 'string', description: 'Folio fiscal (UUID) si aparece' },
      fecha: { type: 'string', description: 'Fecha de emisión AAAA-MM-DD' },
      subtotal: { type: 'number' }, total: { type: 'number' },
      renglones: { type: 'array', items: { type: 'object', properties: {
        clave: { type: 'string', description: 'Clave o código del producto del proveedor (No. identificación), si hay' },
        descripcion: { type: 'string' }, cantidad: { type: 'number' },
        costo_unitario: { type: 'number', description: 'Precio unitario SIN IVA' }, importe: { type: 'number', description: 'Importe del renglón sin IVA' },
      }, required: ['descripcion', 'cantidad'] } },
    },
    required: ['proveedor', 'renglones'],
  },
} as const
export const INSTRUCCION_FACTURA = 'Lee esta factura de un proveedor de productos médicos/estéticos y llama a factura_proveedor con sus datos exactos. No inventes: deja vacío lo que no aparezca. Un renglón por cada concepto; cantidades y precios unitarios sin IVA, tal como vienen.'
