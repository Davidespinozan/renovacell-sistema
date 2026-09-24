// Precios por VOLUMEN (descuentos por cantidad) — helpers PUROS de PREVISUALIZACIÓN.
// ⚠️ El servidor es la AUTORIDAD final: `precio_de(product, list, qty)` calcula
//    LEAST(base [override de lista ∥ general], mejor regla de volumen activa con
//    min_quantity <= qty). Este módulo REPLICA esa precedencia SOLO para mostrar el
//    precio efectivo/ahorro en UI antes de comprar; el cobro real lo fija el RPC.
// Reglas: por SKU individual (no se acumulan cantidades entre SKUs distintos).

export interface VolumeRule {
  id?: string
  product_id: string
  min_quantity: number
  price: number            // precio UNITARIO desde min_quantity
  discount_percent?: number | null
  active: boolean
}

// Tiers ACTIVOS de un producto, ordenados asc por min_quantity (para mostrar la escalera).
export function volumeTiers(rules: readonly VolumeRule[], productId: string): VolumeRule[] {
  return rules.filter((r) => r.product_id === productId && r.active).sort((a, b) => a.min_quantity - b.min_quantity)
}

// Mejor regla activa aplicable a `qty`: la de mayor min_quantity que sea <= qty.
export function bestVolumeRule(rules: readonly VolumeRule[], productId: string, qty: number): VolumeRule | null {
  let best: VolumeRule | null = null
  for (const r of rules) {
    if (r.product_id !== productId || !r.active) continue
    if (r.min_quantity <= qty && (!best || r.min_quantity > best.min_quantity)) best = r
  }
  return best
}

// Precio UNITARIO efectivo = LEAST(base, volumen aplicable). Espeja precio_de (interim).
export function effectiveUnitPrice(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number): number | null {
  const vr = bestVolumeRule(rules, productId, qty)
  if (base == null) return vr ? vr.price : null
  if (!vr) return base
  return Math.min(base, vr.price)
}

// % de descuento de un precio respecto al base (redondeado). null si no hay base o no baja.
export function tierDiscountPct(base: number | null, price: number): number | null {
  if (base == null || base <= 0 || price >= base) return null
  return Math.round((1 - price / base) * 100)
}

// Ahorro total para qty (base*qty - efectivo*qty). 0 si no aplica descuento.
export function volumeSavings(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number): number {
  if (base == null) return 0
  const eff = effectiveUnitPrice(base, rules, productId, qty)
  if (eff == null || eff >= base) return 0
  return Math.round((base - eff) * qty)
}

// Validación de una regla antes de crear/editar. Devuelve mensaje de error o null.
// - min_quantity entero >= 2 (constraint DB)
// - price > 0
// - no duplicar min_quantity para el MISMO producto (constraint unique product_id,min_quantity)
export function validateVolumeRule(
  rules: readonly VolumeRule[],
  input: { product_id: string; min_quantity: number; price: number },
  excludeId?: string,
): string | null {
  if (!Number.isInteger(input.min_quantity) || input.min_quantity < 2) return 'La cantidad mínima debe ser un entero ≥ 2.'
  if (!(input.price > 0)) return 'El precio debe ser mayor que 0.'
  const dup = rules.some((r) => r.product_id === input.product_id && r.min_quantity === input.min_quantity && r.id !== excludeId)
  if (dup) return `Ya existe una regla con cantidad mínima ${input.min_quantity} para este producto.`
  return null
}

// Etiqueta corta de promo para el catálogo ("5% menos desde 5 pzas" / "Desde 10 pzas · $900 c/u").
export function volumePromoLabel(base: number | null, rules: readonly VolumeRule[], productId: string): string | null {
  const tiers = volumeTiers(rules, productId)
  if (!tiers.length) return null
  const t = tiers[0]
  const pct = tierDiscountPct(base, t.price)
  return pct ? `${pct}% menos desde ${t.min_quantity} pzas` : `Desde ${t.min_quantity} pzas · precio especial`
}
