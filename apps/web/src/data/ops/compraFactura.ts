// COMPRA CON FACTURA (26 nov 2026, dueño): leer el XML del CFDI del proveedor (en el navegador, exacto), mandar el PDF a
// leer con la IA, sugerir el producto del catálogo de cada renglón (lo que ya se eligió antes con ese proveedor manda) y
// registrar la compra con todos sus renglones. Nada es obligatorio: también se captura a mano.
import { hasSupabase, supabase } from '../../lib/supabase'
import { normalizarFactura, type FacturaLeida, type RenglonFactura } from '../../../../../supabase/functions/_shared/facturaProveedor'
export type { FacturaLeida, RenglonFactura }

/** CFDI 3.3 / 4.0 del proveedor → forma común. null si no parece un CFDI. */
export function leerXmlCfdi(xml: string): FacturaLeida | null {
  let doc: Document
  try { doc = new DOMParser().parseFromString(xml, 'application/xml') } catch { return null }
  if (doc.getElementsByTagName('parsererror').length) return null
  const uno = (local: string) => doc.getElementsByTagNameNS('*', local)[0] as Element | undefined
  const comp = uno('Comprobante'); if (!comp) return null
  const emisor = uno('Emisor'); const timbre = uno('TimbreFiscalDigital')
  const a = (el: Element | undefined, k: string) => el?.getAttribute(k) ?? null
  const conceptos = Array.from(doc.getElementsByTagNameNS('*', 'Concepto')).filter((c) => c.parentElement?.localName === 'Conceptos')
  return normalizarFactura({
    proveedor: a(emisor, 'Nombre') ?? '', rfc: a(emisor, 'Rfc'), folio: [a(comp, 'Serie'), a(comp, 'Folio')].filter(Boolean).join('-') || null,
    uuid: a(timbre, 'UUID'), fecha: a(comp, 'Fecha'), subtotal: a(comp, 'SubTotal'), total: a(comp, 'Total'),
    renglones: conceptos.map((c) => ({ clave: a(c, 'NoIdentificacion'), descripcion: a(c, 'Descripcion'), cantidad: a(c, 'Cantidad'), costo_unitario: a(c, 'ValorUnitario'), importe: a(c, 'Importe') })),
  })
}

/** Misma normalización que el servidor (_compra_clave). */
export const claveCompra = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 200)
const tokens = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((t) => t.length >= 2))

/** Producto sugerido para un renglón: primero la equivalencia guardada (clave o descripción), luego el nombre más parecido. */
export function sugerirProducto(r: RenglonFactura, rfc: string | null, productos: Array<{ id: string; name: string; sku?: string | null }>, equivalencias: Array<{ proveedor_rfc: string; clave: string; product_id: string }>): string | null {
  const claves = [claveCompra(r.clave), claveCompra(r.descripcion)].filter(Boolean)
  for (const c of claves) {
    const e = equivalencias.find((x) => x.clave === c && x.proveedor_rfc === (rfc ?? '')) ?? equivalencias.find((x) => x.clave === c)
    if (e && productos.some((p) => p.id === e.product_id)) return e.product_id
  }
  const tr = tokens(`${r.descripcion} ${r.clave ?? ''}`)
  let mejor: { id: string; s: number } | null = null
  for (const p of productos) {
    const tp = tokens(`${p.name} ${p.sku ?? ''}`); if (!tp.size) continue
    let comun = 0; tp.forEach((t) => { if (tr.has(t)) comun++ })
    const s = comun / tp.size
    if (comun >= 2 && s >= 0.5 && (!mejor || s > mejor.s)) mejor = { id: p.id, s }
  }
  return mejor?.id ?? null
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function leerEquivalencias(): Promise<Array<{ proveedor_rfc: string; clave: string; product_id: string }>> {
  if (!hasSupabase) return []
  const { data } = await supabase.from('compra_equivalencias' as never).select('proveedor_rfc, clave, product_id').limit(5000)
  return (data ?? []) as Array<{ proveedor_rfc: string; clave: string; product_id: string }>
}

/** Sube el archivo de la factura (evidencia) a <uid>/<uuid>.<ext>. */
export async function subirArchivoCompra(file: File): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const { data: u } = await supabase.auth.getUser()
  const uid = u?.user?.id; if (!uid) return { ok: false, error: 'Tu sesión venció; vuelve a entrar.' }
  const ext = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : /\.xml$/i.test(file.name) ? 'xml' : file.type === 'image/png' ? 'png' : 'jpg'
  const path = `${uid}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('compras').upload(path, file, { contentType: ext === 'xml' ? 'text/xml' : file.type || undefined, upsert: false })
  return error ? { ok: false, error: 'No se pudo subir el archivo de la factura.' } : { ok: true, path }
}

export async function leerPdfFactura(path: string): Promise<{ ok: true; factura: FacturaLeida } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke('factura-proveedor', { body: { path } })
  if (!error && data?.ok) return { ok: true, factura: data.factura as FacturaLeida }
  const cuerpo = error ? await (error as { context?: Response }).context?.json?.().catch(() => null) : data
  return { ok: false, error: (cuerpo as { message?: string } | null)?.message ?? 'No se pudo leer el PDF; captura los renglones a mano.' }
}

export interface RenglonCompra { product_id: string | null; qty: number; unit_cost: number; descripcion?: string | null; clave?: string | null }
export interface CabeceraCompra { proveedor: string; proveedor_rfc?: string | null; factura_folio?: string | null; factura_uuid?: string | null; factura_fecha?: string | null; subtotal?: number | null; total?: number | null; origen: 'xml' | 'pdf' | 'manual'; archivo_path?: string | null; notas?: string | null }

export async function crearCompra(opId: string, c: CabeceraCompra, renglones: RenglonCompra[]): Promise<{ ok: true; renglones: number } | { ok: false; error: string }> {
  const { data, error } = await (supabase.rpc as unknown as Rpc)('crear_compra', { p_op_id: opId, p_compra: c, p_renglones: renglones })
  if (!error) return { ok: true, renglones: Number((data as { renglones?: number })?.renglones ?? renglones.length) }
  const m = error.message ?? ''
  const detalle = m.replace(/^.*?[A-Z_]{4,}:\s*/, '')
  return { ok: false, error: /COMPRA_DUPLICADA/.test(m) ? `Esa factura ya está registrada: ${detalle}` : /NO_AUTORIZADO/.test(m) ? 'Solo Dirección o Facturación registran compras.' : detalle || 'No se pudo registrar la compra.' }
}
