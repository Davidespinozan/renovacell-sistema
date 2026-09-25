// Política de COSTO DE ADQUISICIÓN por lote (Fase 1 — fundación). Espeja la lógica de la
// RPC `recibir_lote`. NUNCA convierte un costo desconocido (NULL) en conocido.
//
// - Entrante desconocido (incCost NULL) → el costo conocido del lote NO cambia.
// - Sin existencia previa efectiva (oldQty<=0) → el lote toma el costo entrante.
// - Existencia previa con costo DESCONOCIDO + entrante conocido → mezcla desconocida ⇒ NULL
//   (conservador: no fabricamos el costo de las unidades viejas).
// - Ambos conocidos → PROMEDIO PONDERADO (no revalúa las unidades previas a un costo nuevo).
//
// El costo del MOVIMIENTO de esa entrada es siempre `incCost` (puede ser NULL); es el costo
// del inventario que ese movimiento agrega, independiente del costo mezclado del lote.

export function blendedLotCost(
  oldQty: number,
  oldCost: number | null | undefined,
  incQty: number,
  incCost: number | null | undefined,
): number | null {
  if (incCost == null) return oldCost ?? null           // entrante desconocido → no cambia
  if (oldQty <= 0) return incCost                        // sin existencia previa → toma entrante
  if (oldCost == null) return null                       // previo desconocido con existencia → mezcla desconocida
  const blended = (oldQty * oldCost + incQty * incCost) / (oldQty + incQty)
  return Math.round(blended * 10000) / 10000             // 4 decimales, igual que la RPC
}

// Costo unitario que se congela en el inventory_movement de ESTA entrada.
export function movementEntryCost(incCost: number | null | undefined): number | null {
  return incCost == null ? null : incCost
}
