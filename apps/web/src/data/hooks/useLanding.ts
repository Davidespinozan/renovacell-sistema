// Hook del contenido de la landing. Hoy store mock; con Supabase = tabla
// landing_content (1 fila) y la página pública la lee. La firma no cambia.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, saveLanding, resetLanding, type LandingContent, type Certification } from '../store/landingStore'

export function useLanding() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, saveLanding, resetLanding }
}

export type { LandingContent, Certification }
