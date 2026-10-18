// PROMO-1 · Reglas de precio para PREVISUALIZAR (volumen + promociones vigentes). El servidor (precio_de/3) es la autoridad.
import { useMemo, useSyncExternalStore } from 'react'
import { useVolumePrices } from './useVolumePrices'
import { subscribePromos, getPromosSnapshot, promosComoReglas } from '../store/promosStore'
import type { VolumeRule } from '../ops/volumePricing'

/** `listaId`: la lista del cliente si se conoce (el doctor en su portal); null = General; undefined = no se sabe (caja). */
export function useReglasPrecio(listaId?: string | null): VolumeRule[] {
  const { data: volumen } = useVolumePrices()
  const promos = useSyncExternalStore(subscribePromos, getPromosSnapshot, getPromosSnapshot)
  return useMemo(() => [...volumen, ...promosComoReglas(promos, listaId === undefined ? undefined : listaId)], [volumen, promos, listaId])
}
