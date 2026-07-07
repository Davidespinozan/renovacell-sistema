// CALENDARIO DE DISEÑO (capability 'diseno'). Entregas y compromisos de producción.
// Con backend (hasSupabase) hidrata de `design_calendar` (RLS: staff consulta;
// admin/cap 'diseno' gestiona) y las mutaciones escriben write-through. Sin backend,
// opera sobre unas semillas mock. La firma del hook no cambia.
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'

export type CalKind = 'entrega' | 'produccion' | 'campana'
export type CalStatus = 'planeado' | 'listo'
export interface CalEntry {
  id: string
  title: string
  date: string        // YYYY-MM-DD
  kind: CalKind
  notes: string
  status: CalStatus
}

const uuid = (): string => (globalThis.crypto?.randomUUID?.() ?? `cal-${Math.random().toString(16).slice(2)}`)
const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

const SEED: CalEntry[] = [
  { id: 'cal-1', title: 'Entrega: fichas Golden Serum', date: '2026-07-10', kind: 'entrega', notes: 'Set de 3 láminas para doctores.', status: 'planeado' },
  { id: 'cal-2', title: 'Producción: banner congreso CDMX', date: '2026-07-15', kind: 'produccion', notes: 'Impresión gran formato para el stand.', status: 'planeado' },
  { id: 'cal-3', title: 'Campaña redes — julio', date: '2026-07-01', kind: 'campana', notes: 'Set mensual de posts.', status: 'listo' },
]

const live = makeLive<CalEntry>(async () => {
  const { data, error } = await supabase.from('design_calendar')
    .select('id, title, date, kind, notes, status')
    .order('date', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id, title: r.title, date: r.date, kind: (r.kind as CalKind) ?? 'entrega',
    notes: r.notes ?? '', status: (r.status as CalStatus) ?? 'planeado',
  }))
}, SEED)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

export function addEntry(input: { title: string; date: string; kind: CalKind; notes?: string }): CalEntry {
  const e: CalEntry = {
    id: hasSupabase ? uuid() : `cal-${Date.now()}`, title: input.title, date: input.date,
    kind: input.kind, notes: input.notes ?? '', status: 'planeado',
  }
  live.setLocal([...live.current(), e])
  if (hasSupabase) {
    supabase.from('design_calendar').insert({ id: e.id, title: e.title, date: e.date, kind: e.kind, notes: e.notes, created_by: currentUserId() })
      .then(({ error }) => { if (error) console.warn('[calendar] insert', error.message); live.reload() })
  }
  return e
}

export function toggleDone(id: string) {
  const cur = live.current().find((e) => e.id === id)
  if (!cur) return
  const status: CalStatus = cur.status === 'listo' ? 'planeado' : 'listo'
  live.setLocal(live.current().map((e) => (e.id === id ? { ...e, status } : e)))
  if (hasSupabase && isUuid(id)) supabase.from('design_calendar').update({ status }).eq('id', id).then(({ error }) => { if (error) console.warn('[calendar] status', error.message); live.reload() })
}

export function removeEntry(id: string) {
  live.setLocal(live.current().filter((e) => e.id !== id))
  if (hasSupabase && isUuid(id)) supabase.from('design_calendar').delete().eq('id', id).then(({ error }) => { if (error) console.warn('[calendar] delete', error.message); live.reload() })
}
