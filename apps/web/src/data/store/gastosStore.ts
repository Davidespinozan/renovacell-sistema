// Gastos / egresos operativos (Finanzas, solo Dirección/Facturación). Con backend
// lee/escribe la tabla `expenses` (RLS admin/billing). Alimenta el Estado de
// Resultados (utilidad = ventas − costo − gastos − mermas).
import { logAudit } from './auditStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'

export type GastoCategoria = 'Renta' | 'Nómina' | 'Logística' | 'Marketing' | 'Insumos' | 'Servicios' | 'Otros'
export const GASTO_CATEGORIAS: GastoCategoria[] = ['Renta', 'Nómina', 'Logística', 'Marketing', 'Insumos', 'Servicios', 'Otros']

export interface Gasto {
  id: string
  fecha: string
  categoria: GastoCategoria
  concepto: string
  monto: number
  created_at: string
}

// Seed de muestra SOLO para modo mock (sin backend). Con backend arranca vacío
// (los gastos reales los captura Dirección).
const SEED: Gasto[] = [
  { id: 'g-1', fecha: '2026-06-02', categoria: 'Renta', concepto: 'Renta bodega Culiacán', monto: 12000, created_at: '2026-06-02T10:00:00Z' },
  { id: 'g-2', fecha: '2026-06-05', categoria: 'Nómina', concepto: 'Nómina quincena 1', monto: 7000, created_at: '2026-06-05T10:00:00Z' },
  { id: 'g-3', fecha: '2026-06-10', categoria: 'Logística', concepto: 'Paquetería y combustible', monto: 2800, created_at: '2026-06-10T10:00:00Z' },
  { id: 'g-4', fecha: '2026-06-14', categoria: 'Marketing', concepto: 'Campaña captación médicos', monto: 2200, created_at: '2026-06-14T10:00:00Z' },
  { id: 'g-5', fecha: '2026-06-20', categoria: 'Nómina', concepto: 'Nómina quincena 2', monto: 7000, created_at: '2026-06-20T10:00:00Z' },
  { id: 'g-6', fecha: '2026-06-22', categoria: 'Servicios', concepto: 'Luz, agua, internet', monto: 1400, created_at: '2026-06-22T10:00:00Z' },
]

const live = makeLive<Gasto>(async () => {
  const { data, error } = await supabase.from('expenses')
    .select('id, fecha, categoria, concepto, monto, created_at')
    .order('fecha', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Gasto[]
}, [...SEED].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)))

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 100
export function addGasto(input: { fecha: string; categoria: GastoCategoria; concepto: string; monto: number }): Gasto {
  seq += 1
  const g: Gasto = { id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `g-${seq}`) : `g-${seq}`, ...input, created_at: new Date().toISOString() }
  live.setLocal([g, ...live.current()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)))
  logAudit({ actor: 'Dirección', action: 'Gasto registrado', resource: input.concepto, detail: `${input.categoria} · $${input.monto}` })
  if (hasSupabase) {
    supabase.from('expenses').insert({ id: g.id, fecha: input.fecha, categoria: input.categoria, concepto: input.concepto, monto: input.monto, created_by: currentUserId() })
      .then(({ error }) => { if (error) console.warn('[expenses] insert', error.message); live.reload() })
  }
  return g
}

export function removeGasto(id: string) {
  const g = live.current().find((x) => x.id === id)
  live.setLocal(live.current().filter((x) => x.id !== id))
  if (g) logAudit({ actor: 'Dirección', action: 'Gasto eliminado', resource: g.concepto })
  if (hasSupabase) supabase.from('expenses').delete().eq('id', id).then(({ error }) => { if (error) console.warn('[expenses] remove', error.message); live.reload() })
}
