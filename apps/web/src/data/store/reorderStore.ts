// Puente efímero para "Volver a pedir" (recompra 1-clic del Portal del Doctor).
// Historial / Mis pedidos SIEMBRAN los renglones de un pedido y navegan al
// Catálogo; el Catálogo los TOMA al montarse para rearmar el carrito (capado al
// stock disponible). No persiste nada: es solo un traspaso en memoria entre
// pantallas, de un solo uso (takeReorderSeed lo consume y lo limpia).
export interface ReorderLine {
  product_id: string
  qty: number
}

let seed: ReorderLine[] | null = null

export function seedReorder(lines: ReorderLine[]): void {
  const clean = lines.filter((l) => l.product_id && l.qty > 0)
  seed = clean.length > 0 ? clean : null
}

// Devuelve la siembra pendiente y la limpia (un solo uso).
export function takeReorderSeed(): ReorderLine[] | null {
  const s = seed
  seed = null
  return s
}
