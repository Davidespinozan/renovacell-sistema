// MAYOREO-50 (24 nov 2026) · unidad y junta_mayoreo de cada producto del catálogo, para contar las 50 cajas del pedido
// igual que el servidor (_qty_volumen).
import { useMemo } from 'react'
import { useProducts } from './useProducts'
import type { InfoMayoreo } from '../ops/volumePricing'

export function useInfoMayoreo(): InfoMayoreo {
  const { data: productos } = useProducts()
  return useMemo(() => Object.fromEntries(productos.map((p) => [p.id, { unit: p.unit, junta_mayoreo: p.junta_mayoreo }])), [productos])
}
