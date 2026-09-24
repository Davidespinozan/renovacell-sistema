// Hook de DESCUENTOS POR CANTIDAD (product_volume_prices). Lectura reactiva + mutaciones
// admin (RLS es la autoridad). El cobro real lo decide el servidor (precio_de con qty).
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, createVolumeRule, updateVolumeRule, setVolumeActive, deleteVolumeRule } from '../store/volumePricesStore'
import type { VolumeRule } from '../ops/volumePricing'

export function useVolumePrices() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, createVolumeRule, updateVolumeRule, setVolumeActive, deleteVolumeRule }
}

export type { VolumeRule }
