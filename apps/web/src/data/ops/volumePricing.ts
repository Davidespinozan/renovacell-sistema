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
  nivel?: 'medio' | 'mayoreo'   // MAYOREO-REGLAS · qué nivel es el escalón (lo dice el servidor)
  promo?: { nombre: string; hasta: string }   // PROMO-1 · escalón de una promoción vigente (no es regla de volumen)
}

// Tiers ACTIVOS de VOLUMEN de un producto, ordenados asc por min_quantity (para mostrar la escalera).
export function volumeTiers(rules: readonly VolumeRule[], productId: string): VolumeRule[] {
  return rules.filter((r) => r.product_id === productId && r.active && !r.promo).sort((a, b) => a.min_quantity - b.min_quantity)
}
// PROMO-1 · escalones de promoción vigente del producto (asc por cantidad).
export function promoTiers(rules: readonly VolumeRule[], productId: string): VolumeRule[] {
  return rules.filter((r) => r.product_id === productId && r.active && !!r.promo).sort((a, b) => a.min_quantity - b.min_quantity)
}

// Mejor regla aplicable a `qty` dentro de un grupo: la de mayor min_quantity que sea <= qty.
function mejor(rules: readonly VolumeRule[], productId: string, qty: number, promo: boolean): VolumeRule | null {
  let best: VolumeRule | null = null
  for (const r of rules) {
    if (r.product_id !== productId || !r.active || !!r.promo !== promo) continue
    if (r.min_quantity <= qty && (!best || r.min_quantity > best.min_quantity)) best = r
  }
  return best
}
export function bestVolumeRule(rules: readonly VolumeRule[], productId: string, qty: number): VolumeRule | null { return mejor(rules, productId, qty, false) }
export function bestPromoRule(rules: readonly VolumeRule[], productId: string, qty: number): VolumeRule | null { return mejor(rules, productId, qty, true) }

/**
 * MAYOREO-REGLAS · espeja _qty_volumen: con TODO el pedido, cuántas piezas cuentan para el volumen de cada producto.
 *   1. Si un producto llega a su escalón de mayoreo → todos cuentan como su escalón más alto (cada uno a su mejor precio).
 *   2. Los de medio mayoreo en 10 se juntan: si suman 10 o más, cada uno cuenta al menos 10 (solo medio, nunca mayoreo).
 */
export function cantidadesVolumen(lines: ReadonlyArray<{ product_id: string; qty: number }>, rules: readonly VolumeRule[]): Record<string, number> {
  const q: Record<string, number> = {}
  for (const l of lines) if (l.qty > 0) q[l.product_id] = (q[l.product_id] ?? 0) + l.qty
  const datos = Object.entries(q).map(([pid, n]) => {
    const t = rules.filter((r) => r.product_id === pid && r.active && !r.promo)
    const min = (f: (r: VolumeRule) => boolean) => { const xs = t.filter(f).map((r) => r.min_quantity); return xs.length ? Math.min(...xs) : null }
    return { pid, n, max: t.length ? Math.max(...t.map((r) => r.min_quantity)) : null, medio: min((r) => (r.nivel ?? 'medio') === 'medio'), mayoreo: min((r) => r.nivel === 'mayoreo') }
  })
  const enMayoreo = datos.some((d) => d.mayoreo != null && d.n >= d.mayoreo)
  const junta10 = datos.filter((d) => d.medio === 10).reduce((s, d) => s + d.n, 0)
  const out: Record<string, number> = {}
  for (const d of datos) out[d.pid] = Math.max(d.n, enMayoreo ? d.max ?? 0 : 0, d.medio === 10 && junta10 >= 10 ? 10 : 0)
  return out
}

// Precio UNITARIO efectivo = LEAST(base, volumen aplicable, promoción vigente aplicable). Espeja precio_de/4: el volumen se
// busca con las piezas que cuentan en el pedido (`qtyVolumen`, ver cantidadesVolumen) y la promoción con las reales.
export function effectiveUnitPrice(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number, qtyVolumen?: number): number | null {
  const candidatos = [base, bestVolumeRule(rules, productId, Math.max(qty, qtyVolumen ?? qty))?.price ?? null, bestPromoRule(rules, productId, qty)?.price ?? null].filter((x): x is number => x != null)
  return candidatos.length ? Math.min(...candidatos) : null
}
/** PROMO-1 · si para `qty` el precio efectivo viene de una promoción, cuál (para la etiqueta "Promo X · hasta el…"). */
export function promoAplicada(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number): VolumeRule | null {
  const pr = bestPromoRule(rules, productId, qty)
  if (!pr) return null
  const eff = effectiveUnitPrice(base, rules, productId, qty)
  return eff != null && pr.price <= eff ? pr : null
}

// % de descuento de un precio respecto al base (redondeado). null si no hay base o no baja.
export function tierDiscountPct(base: number | null, price: number): number | null {
  if (base == null || base <= 0 || price >= base) return null
  return Math.round((1 - price / base) * 100)
}

// Ahorro total para qty (base*qty - efectivo*qty). 0 si no aplica descuento.
export function volumeSavings(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number, qtyVolumen?: number): number {
  if (base == null) return 0
  const eff = effectiveUnitPrice(base, rules, productId, qty, qtyVolumen)
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

// MAYOREO (hoja oct 2026) · niveles con nombre: el primer escalón es MEDIO MAYOREO y el último MAYOREO (con un solo
// escalón, ese es medio mayoreo). Lo intermedio, si un día existe, se llama por su cantidad.
export function nombreNivel(tiers: readonly VolumeRule[], i: number): string {
  if (tiers[i]?.nivel) return tiers[i].nivel === 'mayoreo' ? 'Mayoreo' : 'Medio mayoreo'   // lo que dice el servidor manda
  if (i === 0) return 'Medio mayoreo'
  return i === tiers.length - 1 ? 'Mayoreo' : `Desde ${tiers[i].min_quantity} pzas`
}
/** Nivel que aplica a `qty` y el siguiente por alcanzar (cuántas piezas faltan y a qué precio). */
export function nivelVolumen(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number): {
  actual: { nombre: string; precio: number } | null; siguiente: { nombre: string; faltan: number; precio: number } | null
} {
  const tiers = volumeTiers(rules, productId).filter((t) => base == null || t.price < base)
  const i = tiers.reduce((k, t, j) => (t.min_quantity <= qty ? j : k), -1)
  const sig = tiers[i + 1]
  return {
    actual: i >= 0 ? { nombre: nombreNivel(tiers, i), precio: tiers[i].price } : null,
    siguiente: sig && qty > 0 ? { nombre: nombreNivel(tiers, i + 1), faltan: sig.min_quantity - qty, precio: sig.price } : null,
  }
}
/** Etiqueta del producto en el carrito: "Precio de mayoreo" o "Faltan 3 para medio mayoreo ($1,170)". Con `qtyVolumen` (las
 *  reglas del pedido subieron el nivel) dice por qué: "Mayoreo por tu pedido" / "Medio mayoreo juntando piezas". */
export function etiquetaNivel(base: number | null, rules: readonly VolumeRule[], productId: string, qty: number, qtyVolumen?: number): string | null {
  if (promoAplicada(base, rules, productId, qty)) return null   // manda la promoción vigente
  if (qtyVolumen != null && qtyVolumen > qty && qty > 0) {
    const sube = nivelVolumen(base, rules, productId, qtyVolumen).actual
    const propio = nivelVolumen(base, rules, productId, qty).actual
    if (sube && sube.precio < (propio?.precio ?? Infinity)) return sube.nombre === 'Mayoreo' ? 'Mayoreo por tu pedido' : 'Medio mayoreo juntando piezas'
  }
  const { actual, siguiente } = nivelVolumen(base, rules, productId, qty)
  if (siguiente && siguiente.faltan <= Math.max(5, Math.ceil(qty / 2))) return `Faltan ${siguiente.faltan} para ${siguiente.nombre.toLowerCase()} (${money0(siguiente.precio)} c/u)`
  return actual ? `Precio de ${actual.nombre.toLowerCase()}` : null
}

// Etiqueta corta de promo para el catálogo ("Promo Allergan · hasta el 25 oct" / "Medio mayoreo desde 10 pzas · Mayoreo desde 50").
export function volumePromoLabel(base: number | null, rules: readonly VolumeRule[], productId: string): string | null {
  const pt = promoTiers(rules, productId)
  if (pt.length && pt[0].promo) {   // PROMO-1 · la promoción vigente manda sobre la escalera de volumen
    const [, m, d] = pt[0].promo.hasta.slice(0, 10).split('-').map(Number)
    const escalones = pt.length > 1 ? ` · desde ${pt[pt.length - 1].min_quantity} pzas ${money0(pt[pt.length - 1].price)}` : ''
    return `${pt[0].promo.nombre} · hasta el ${d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]}${escalones}`
  }
  const tiers = volumeTiers(rules, productId)
  if (!tiers.length) return null
  const t = tiers[0]
  if (tiers.length > 1) { const u = tiers[tiers.length - 1]; return `Medio mayoreo desde ${t.min_quantity} pzas · Mayoreo desde ${u.min_quantity} ${money0(u.price)}` }
  const pct = tierDiscountPct(base, t.price)
  return pct ? `${pct}% menos desde ${t.min_quantity} pzas` : `Desde ${t.min_quantity} pzas · precio especial`
}
const money0 = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')

// ═══ AVISO DE AHORRO POR MÁS PIEZAS (2 nov 2026, dueño: "avisarle al cliente que si agrega más piezas hay descuento") ═══
// Para cada producto del pedido: cuántas piezas faltan para su SIGUIENTE nivel (medio mayoreo / mayoreo), el precio nuevo
// y cuánto se ahorra en TOTAL. Se calcula con las reglas del pedido (uno en mayoreo baja todo; el medio de 10 se junta),
// así que el ahorro puede incluir otros productos. Es una previsualización: el servidor cobra con precio_de.
export interface OportunidadVolumen {
  product_id: string
  faltan: number          // piezas que agregar de ESTE producto
  nivel: string           // "Medio mayoreo" | "Mayoreo"
  precioAhora: number     // c/u de este producto hoy
  precioNuevo: number     // c/u de este producto al llegar
  ahorro: number          // ahorro total del pedido (lo que ya lleva + lo que agrega) vs pagarlo a los precios de hoy
  arrastra: boolean       // el ahorro alcanza a otros productos del pedido
}
export function oportunidadesVolumen(lineas: ReadonlyArray<{ product_id: string; qty: number; base: number | null }>, rules: readonly VolumeRule[]): OportunidadVolumen[] {
  const vivas = lineas.filter((l) => l.qty > 0 && l.base != null && l.base > 0)
  if (!vivas.length) return []
  const base = new Map(vivas.map((l) => [l.product_id, l.base as number]))
  const vq = cantidadesVolumen(vivas, rules)
  const ahora = new Map(vivas.map((l) => [l.product_id, effectiveUnitPrice(l.base, rules, l.product_id, l.qty, vq[l.product_id]) ?? (l.base as number)]))
  const out: OportunidadVolumen[] = []
  for (const l of vivas) {
    const actual = vq[l.product_id] ?? l.qty
    const sig = volumeTiers(rules, l.product_id).find((t) => t.min_quantity > actual && t.price < (ahora.get(l.product_id) ?? Infinity))
    if (!sig) continue
    // La MENOR cantidad que de verdad baja el precio de este producto con las reglas del pedido (juntando piezas puede
    // bastar con 1 aunque a su propio escalón le falten más).
    let faltan = 0
    for (let k = 1; k <= sig.min_quantity - l.qty; k++) {
      const prueba = vivas.map((x) => (x.product_id === l.product_id ? { ...x, qty: x.qty + k } : x))
      const p2 = effectiveUnitPrice(l.base, rules, l.product_id, l.qty + k, cantidadesVolumen(prueba, rules)[l.product_id]) ?? Infinity
      if (p2 < (ahora.get(l.product_id) as number)) { faltan = k; break }
    }
    if (faltan <= 0) continue
    const nuevas = vivas.map((x) => (x.product_id === l.product_id ? { ...x, qty: x.qty + faltan } : x))
    const vq2 = cantidadesVolumen(nuevas, rules)
    let ahorro = 0; let arrastra = false
    for (const x of nuevas) {
      const antes = ahora.get(x.product_id) as number
      const despues = effectiveUnitPrice(base.get(x.product_id) ?? null, rules, x.product_id, x.qty, vq2[x.product_id]) ?? antes
      if (despues < antes) { ahorro += (antes - despues) * x.qty; if (x.product_id !== l.product_id) arrastra = true }
    }
    const precioNuevo = effectiveUnitPrice(l.base, rules, l.product_id, l.qty + faltan, vq2[l.product_id]) ?? sig.price
    if (ahorro < 1) continue
    const tiers = volumeTiers(rules, l.product_id)
    out.push({ product_id: l.product_id, faltan, nivel: nombreNivel(tiers, tiers.indexOf(sig)), precioAhora: ahora.get(l.product_id) as number, precioNuevo, ahorro: Math.round(ahorro), arrastra })
  }
  // primero lo más cercano (menos piezas); a igualdad, lo que más ahorra
  return out.sort((a, b) => a.faltan - b.faltan || b.ahorro - a.ahorro)
}
/** La frase para el cliente (o para que el vendedor se la ofrezca). */
export function textoOportunidad(o: OportunidadVolumen, nombre: string, voz: 'cliente' | 'vendedor' = 'cliente'): string {
  const pieza = o.faltan === 1 ? 'pieza' : 'piezas'
  const pre = voz === 'cliente' ? `Agrega ${o.faltan} ${pieza} más de ${nombre}` : `Ofrécele ${o.faltan} ${pieza} más de ${nombre}`
  return `${pre} y ${voz === 'cliente' ? 'pagas' : 'paga'} ${money0(o.precioNuevo)} c/u (${o.nivel.toLowerCase()}) en vez de ${money0(o.precioAhora)}: ${voz === 'cliente' ? 'ahorras' : 'ahorra'} ${money0(o.ahorro)}${o.arrastra ? ' en todo el pedido' : ''}.`
}
