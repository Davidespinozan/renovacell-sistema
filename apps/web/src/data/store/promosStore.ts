// Promociones / campañas (Diseño + comercial). Info de promos vigentes para que
// Diseño prepare material. Mock hoy; con Supabase = tabla promotions. Seeds
// CLARAMENTE de muestra (no comprometen precios reales del producto regulado).
export interface Promo {
  id: string
  title: string
  description: string
  start: string // YYYY-MM-DD
  end: string   // YYYY-MM-DD
}

let promos: Promo[] = [
  { id: 'promo-sample-1', title: '(Muestra) Campaña Home Care · Junio', description: 'Material gráfico para campaña de temporada de la línea Home Care.', start: '2026-06-01', end: '2026-06-30' },
  { id: 'promo-sample-2', title: '(Muestra) Lanzamiento Professional', description: 'Piezas para presentación de la línea Professional a doctores verificados.', start: '2026-06-15', end: '2026-07-15' },
]
let seq = 0
const listeners = new Set<() => void>()
let snapshot: Promo[] = [...promos]

function emit() { snapshot = [...promos]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): Promo[] => snapshot

export function addPromo(input: { title: string; description: string; start: string; end: string }): Promo {
  seq += 1
  const p: Promo = { id: `promo-${seq}`, ...input }
  promos = [p, ...promos]
  emit()
  return p
}

export const isActive = (p: Promo, todayISO: string): boolean => p.start <= todayISO && todayISO <= p.end
