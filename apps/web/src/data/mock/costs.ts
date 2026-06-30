// Costos unitarios por producto (COSTO de la empresa, NO precio de venta).
// SENSIBLE: solo Dirección/Finanzas lo ve (baseline de seguridad: products_safe
// no incluye costo). Con Supabase = columna products.unit_cost protegida por RLS.
export const PRODUCT_COSTS: Record<string, number> = {
  // Home Care
  'p-mgp-90': 400,
  'p-gs-114': 850,
  'p-ab-50': 650,
  'p-sh-19': 580,
  'p-pl-12': 300,
  // Professional (placeholder, junto con los precios placeholder)
  'p-int-01': 2600,
  'p-gp-300': 3000,
  'p-ufs-11': 2400,
  'p-gv-07': 1850,
  'p-sac-21': 2100,
  'p-stl-44': 1700,
}

export const costOf = (productId: string | null | undefined): number =>
  (productId && PRODUCT_COSTS[productId]) || 0
