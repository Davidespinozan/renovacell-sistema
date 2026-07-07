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
    .select('id, sku, name, line, category, description, price, unit, image_url, active')
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
