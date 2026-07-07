// Hook del calendario de Diseño. Con backend lee de `design_calendar` (Realtime no
// hace falta: lo edita el propio equipo de Diseño). Misma firma con o sin backend.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addEntry, toggleDone, removeEntry, type CalEntry, type CalKind, type CalStatus } from '../store/calendarStore'

export function useCalendar() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, addEntry, toggleDone, removeEntry }
}

export type { CalEntry, CalKind, CalStatus }
