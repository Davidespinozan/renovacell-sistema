// Hook de notificaciones internas. Mock hoy; con Supabase = realtime. Misma firma.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, markAllRead, markRead, type Notif } from '../store/notificationsStore'

export function useNotifications() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, markAllRead, markRead }
}

export type { Notif }
