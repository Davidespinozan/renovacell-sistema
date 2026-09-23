// Agrupación producto→variantes (modelo Opción A: cada variante es una fila de products).
// La relación PRINCIPAL es parent_product_id; family es solo etiqueta visual. La UI muestra UNA
// tarjeta por familia/padre y un selector de variantes; al carrito SIEMPRE va el id de la VARIANTE.
import type { ProductSafe } from '../types'

// Un producto es "vendible" si sellable !== false y tiene precio operativo (>0).
export function isSellableVariant(p: ProductSafe): boolean {
  return p.sellable !== false && p.price != null && p.price > 0
}

// Variantes hijas (por parent_product_id). Incluye no-vendibles (para mostrarlas como "No disponible").
export function variantsOf(parentId: string, all: ProductSafe[]): ProductSafe[] {
  return all.filter((p) => p.parent_product_id === parentId)
}
export function sellableVariantsOf(parentId: string, all: ProductSafe[]): ProductSafe[] {
  return variantsOf(parentId, all).filter(isSellableVariant)
}

// Es tarjeta/padre visual: tiene al menos una variante hija. (Normalmente sellable=false.)
export function isVisualParent(p: ProductSafe, all: ProductSafe[]): boolean {
  return all.some((c) => c.parent_product_id === p.id)
}
// Es una variante (cuelga de un padre).
export function isVariant(p: ProductSafe): boolean {
  return p.parent_product_id != null
}

export interface CatalogEntry {
  kind: 'product' | 'family'
  product: ProductSafe          // standalone, o el padre visual de la familia
  variants: ProductSafe[]       // [] para standalone; hijas para familia
}

// Construye las entradas de catálogo agrupadas: standalone (sin padre y sin hijos) como producto;
// padres (con hijos) como familia con sus variantes. Las variantes NUNCA son top-level.
// `keep(product)` filtra qué es visible (p.ej. isPortalProduct / línea). Para familias, se conserva
// el padre si tiene ≥1 variante que pase `keepVariant` (por defecto, la misma `keep`).
export function catalogEntries(
  all: ProductSafe[],
  keep: (p: ProductSafe) => boolean = () => true,
  keepVariant: (p: ProductSafe) => boolean = keep,
): CatalogEntry[] {
  const childrenByParent = new Map<string, ProductSafe[]>()
  for (const p of all) if (p.parent_product_id) {
    const arr = childrenByParent.get(p.parent_product_id) ?? []
    arr.push(p); childrenByParent.set(p.parent_product_id, arr)
  }
  const entries: CatalogEntry[] = []
  for (const p of all) {
    if (p.parent_product_id) continue           // variante → va dentro de su familia
    const kids = childrenByParent.get(p.id)
    if (kids && kids.length) {                   // padre/familia
      const vis = kids.filter(keepVariant)
      if (vis.length) entries.push({ kind: 'family', product: p, variants: vis })
    } else if (p.sellable !== false && keep(p)) { // standalone real (nunca un padre huérfano)
      // Un producto sellable=false SIN hijos es un padre placeholder sin variantes: no se muestra
      // ni se vende (regla "nunca vender un parent"). Los standalone reales son sellable !== false.
      entries.push({ kind: 'product', product: p, variants: [] })
    }
  }
  return entries
}
