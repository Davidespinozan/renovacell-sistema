// Store del CATÁLOGO. Con backend (hasSupabase) hidrata de la vista segura
// `products_safe` (sin costos) y las mutaciones escriben en `products` (solo
// admin, por RLS). Sin backend, opera sobre el catálogo mock. El hook useProducts
// no cambia.
import type { ProductSafe } from '../types'
import { MOCK_PRODUCTS } from '../mock/catalog'
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

const fallback: ProductSafe[] = MOCK_PRODUCTS.map((p) => ({ active: true, ...p }))

const live = makeLive<ProductSafe>(async () => {
  const { data, error } = await supabase
    .from('products_safe')
    .select('id, sku, name, line, category, description, price, unit, image_url, active, show_landing, show_portal')
    .order('line')
    .order('name')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: (r.id ?? '') as string,
    sku: r.sku ?? '',
    name: r.name ?? '',
    line: (r.line as 'cosm' | 'prof') ?? 'cosm',
    category: r.category ?? '',
    description: r.description ?? '',
    price: r.price,
    unit: r.unit ?? 'unit',
    image_url: r.image_url,
    active: r.active ?? true,
  }))
}, fallback)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
export const ready = live.ready

export interface ProductInput {
  name: string
  sku: string
  line: 'cosm' | 'prof'
  category: string
  description: string
  price: number | null
  image_url: string | null
  active: boolean
  show_landing?: boolean
  show_portal?: boolean
}

let seq = 0

export function createProduct(input: ProductInput): ProductSafe {
  seq += 1
  const temp: ProductSafe = {
    id: `p-new-${seq}`, sku: input.sku || `SKU-${seq}`, name: input.name,
    line: input.line, category: input.category, description: input.description,
    price: input.price, unit: 'unit', image_url: input.image_url, active: input.active,
  }
  live.setLocal([temp, ...live.current()]) // optimista
  logAudit({ actor: 'Administración', action: 'Producto creado', resource: input.name })
  if (hasSupabase) {
    supabase.from('products').insert({
      sku: temp.sku, name: input.name, line: input.line, category: input.category,
      description: input.description, price: input.price, unit: 'unit',
      image_url: input.image_url, active: input.active,
    }).then(({ error }) => { if (error) console.warn('[products] insert', error.message); live.reload() })
  }
  return temp
}

export function updateProduct(id: string, patch: Partial<ProductInput>) {
  const before = live.current().find((p) => p.id === id)
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, ...patch } : p)))
  if (before) logAudit({ actor: 'Administración', action: 'Producto editado', resource: before.name })
  if (hasSupabase) {
    supabase.from('products').update(patch).eq('id', id).then(({ error }) => { if (error) console.warn('[products] update', error.message); live.reload() })
  }
}

export function toggleActive(id: string) {
  const cur = live.current().find((p) => p.id === id)
  const now = !(cur?.active !== false)
  live.setLocal(live.current().map((p) => (p.id === id ? { ...p, active: now } : p)))
  logAudit({ actor: 'Administración', action: now ? 'Producto activado' : 'Producto ocultado', resource: cur?.name ?? '' })
  if (hasSupabase) {
    supabase.from('products').update({ active: now }).eq('id', id).then(({ error }) => { if (error) console.warn('[products] toggle', error.message); live.reload() })
  }
}

// Elimina un producto del catálogo (solo admin por RLS). Si el producto ya tuvo
// pedidos/lotes, la base puede impedirlo por integridad; devuelve el error para
// sugerir ocultarlo en su lugar.
const isUuidP = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
export async function deleteProduct(id: string): Promise<{ ok: boolean; error?: string }> {
  const cur = live.current().find((p) => p.id === id)
  live.setLocal(live.current().filter((p) => p.id !== id))
  logAudit({ actor: 'Administración', action: 'Producto eliminado', resource: cur?.name ?? id })
  if (hasSupabase && isUuidP(id)) {
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) { await live.reload(); return { ok: false, error: 'No se pudo eliminar (¿ya tiene pedidos o inventario? Mejor ocúltalo).' } }
    await live.reload()
  }
  return { ok: true }
}

// ---- MIGRACIÓN: importación masiva del catálogo (Odoo → CSV) ----
export interface ImportRow { sku: string; name: string; line: 'cosm' | 'prof'; category: string | null; price: number | null; cost: number | null }
export interface ImportResult { created: number; skipped: number; errors: string[] }

// Importa productos (+ precio base y costo). Idempotente por SKU: los que ya existen se
// omiten (no duplica). El costo va a product_costs (protegido por RLS admin/billing).
export async function importCatalog(rows: ImportRow[]): Promise<ImportResult> {
  const res: ImportResult = { created: 0, skipped: 0, errors: [] }
  if (!hasSupabase) {
    rows.forEach((r) => { if (r.name.trim()) { createProduct({ sku: r.sku, name: r.name, line: r.line, category: r.category ?? '', description: '', price: r.price, image_url: null, active: true }); res.created += 1 } })
    return res
  }
  const { data: existing } = await supabase.from('products').select('sku')
  const have = new Set((existing ?? []).map((p) => (p.sku ?? '').trim().toLowerCase()).filter(Boolean))
  let n = 0
  for (const r of rows) {
    n += 1
    if (!r.name.trim()) { res.errors.push('Fila sin nombre (omitida)'); continue }
    let sku = (r.sku || '').trim()
    if (sku && have.has(sku.toLowerCase())) { res.skipped += 1; continue }
    if (!sku) sku = `IMP-${String(n).padStart(4, '0')}` // sin SKU en el origen → uno estable
    const ins = await supabase.from('products').insert({ sku, name: r.name.trim(), line: r.line, category: r.category ?? '', price: r.price, unit: 'unit', active: true }).select('id').single()
    if (ins.error || !ins.data) { res.errors.push(`${r.name}: ${ins.error?.message ?? 'no se pudo crear'}`); continue }
    res.created += 1
    if (sku) have.add(sku.toLowerCase())
    if (r.cost != null && !Number.isNaN(r.cost)) {
      const cErr = (await supabase.from('product_costs').upsert({ product_id: ins.data.id, unit_cost: r.cost }, { onConflict: 'product_id' })).error
      if (cErr) res.errors.push(`${r.name} (costo): ${cErr.message}`)
    }
  }
  logAudit({ actor: 'Administración', action: 'Catálogo importado (migración)', resource: `${res.created} productos`, detail: `${res.created} creados · ${res.skipped} omitidos` })
  await live.reload()
  return res
}

// ── COSTO POR PRODUCTO ───────────────────────────────────────────────────────
// Vive en `product_costs`, tabla aparte que por RLS solo pueden leer Dirección y
// Facturación. Nunca viaja al catálogo del doctor, ni siquiera por descuido: no
// es una columna de `products`, así que ningún SELECT del catálogo lo arrastra.
// Hasta ahora solo se podía cargar por archivo (Importar/Migración); esto
// permite corregir uno suelto sin volver a subir todo.
export async function getProductCost(productId: string): Promise<number | null> {
  if (!hasSupabase || !isUuidP(productId)) return null
  const { data, error } = await supabase
    .from('product_costs').select('unit_cost').eq('product_id', productId).maybeSingle()
  if (error) { console.warn('[costos] leer', error.message); return null }
  return data?.unit_cost ?? null
}

export async function setProductCost(productId: string, cost: number | null, productName = ''): Promise<void> {
  if (!hasSupabase || !isUuidP(productId)) return
  const q = cost == null
    ? supabase.from('product_costs').delete().eq('product_id', productId)
    : supabase.from('product_costs').upsert({ product_id: productId, unit_cost: cost }, { onConflict: 'product_id' })
  const { error } = await q
  if (error) { console.warn('[costos] guardar', error.message); return }
  logAudit({
    actor: 'Administración', action: cost == null ? 'Costo eliminado' : 'Costo actualizado',
    resource: productName || productId, detail: cost == null ? undefined : `$${cost}`,
  })
}
