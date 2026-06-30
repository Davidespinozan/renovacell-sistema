// Store compartido del CATÁLOGO (editable). Antes el catálogo era mock de solo
// lectura; ahora Administración (o quien tenga la capability "contenido") lo
// edita y el Portal del Doctor lo refleja al instante. Al migrar a Supabase:
// insert/update/select sobre `products`; el hook useProducts no cambia.
import type { ProductSafe } from '../types'
import { MOCK_PRODUCTS } from '../mock/catalog'
import { logAudit } from './auditStore'

let products: ProductSafe[] = MOCK_PRODUCTS.map((p) => ({ active: true, ...p }))
let seq = 0
const listeners = new Set<() => void>()
let snapshot: ProductSafe[] = [...products]

function emit() {
  snapshot = [...products]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): ProductSafe[] => snapshot

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

export function createProduct(input: ProductInput): ProductSafe {
  seq += 1
  const p: ProductSafe = {
    id: `p-new-${seq}`, sku: input.sku || `SKU-${seq}`, name: input.name,
    line: input.line, category: input.category, description: input.description,
    price: input.price, unit: 'unit', image_url: input.image_url, active: input.active,
  }
  products = [p, ...products]
  emit()
  logAudit({ actor: 'Administración', action: 'Producto creado', resource: input.name })
  return p
}

export function updateProduct(id: string, patch: Partial<ProductInput>) {
  const before = products.find((p) => p.id === id)
  products = products.map((p) => (p.id === id ? { ...p, ...patch } : p))
  emit()
  if (before) logAudit({ actor: 'Administración', action: 'Producto editado', resource: before.name })
}

export function toggleActive(id: string) {
  let name = ''
  let now = true
  products = products.map((p) => {
    if (p.id !== id) return p
    name = p.name
    now = !(p.active !== false)
    return { ...p, active: now }
  })
  emit()
  logAudit({ actor: 'Administración', action: now ? 'Producto activado' : 'Producto ocultado', resource: name })
}
