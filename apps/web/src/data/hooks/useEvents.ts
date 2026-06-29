// Hook de eventos del POS. Mock; con Supabase = tablas events + event_stock.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, createEvent, assignStock, sellAtEvent, closeEvent, remaining, type SalesEvent, type EventItem } from '../store/eventsStore'

export function useEvents() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, createEvent, assignStock, sellAtEvent, closeEvent }
}

export { remaining }
export type { SalesEvent, EventItem }
