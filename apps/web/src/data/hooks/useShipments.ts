// Hook de acceso a envíos. HOY store mock; MAÑANA Supabase (shipments con RLS).
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, createShipment, reportIncident, resolveIncident, type ShipmentInput } from '../store/shipmentsStore'

export function useShipments() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, loading: false, error: null as string | null, createShipment, reportIncident, resolveIncident }
}

export type { ShipmentInput }
