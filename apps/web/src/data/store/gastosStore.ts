// Gastos / egresos operativos (Finanzas, solo Dirección). Mock hoy; con Supabase
// = tabla expenses. Alimenta el Estado de Resultados (utilidad = ventas − costo − gastos).
import { logAudit } from './auditStore'

export type GastoCategoria = 'Renta' | 'Nómina' | 'Logística' | 'Marketing' | 'Insumos' | 'Servicios' | 'Otros'
export const GASTO_CATEGORIAS: GastoCategoria[] = ['Renta', 'Nómina', 'Logística', 'Marketing', 'Insumos', 'Servicios', 'Otros']

export interface Gasto {
  id: string
  fecha: string        // ISO YYYY-MM-DD
  categoria: GastoCategoria
  concepto: string
  monto: number        // MXN
  created_at: string
}

// Seed para que el módulo se vea vivo en el review (montos plausibles del mes).
const SEED: Gasto[] = [
  { id: 'g-1', fecha: '2026-06-02', categoria: 'Renta', concepto: 'Renta bodega Culiacán', monto: 12000, created_at: '2026-06-02T10:00:00Z' },
  { id: 'g-2', fecha: '2026-06-05', categoria: 'Nómina', concepto: 'Nómina quincena 1', monto: 7000, created_at: '2026-06-05T10:00:00Z' },
  { id: 'g-3', fecha: '2026-06-10', categoria: 'Logística', concepto: 'Paquetería y combustible', monto: 2800, created_at: '2026-06-10T10:00:00Z' },
  { id: 'g-4', fecha: '2026-06-14', categoria: 'Marketing', concepto: 'Campaña captación médicos', monto: 2200, created_at: '2026-06-14T10:00:00Z' },
  { id: 'g-5', fecha: '2026-06-20', categoria: 'Nómina', concepto: 'Nómina quincena 2', monto: 7000, created_at: '2026-06-20T10:00:00Z' },
  { id: 'g-6', fecha: '2026-06-22', categoria: 'Servicios', concepto: 'Luz, agua, internet', monto: 1400, created_at: '2026-06-22T10:00:00Z' },
]

let gastos: Gasto[] = [...SEED]
let seq = 100
const listeners = new Set<() => void>()
let snapshot: Gasto[] = sortDesc(gastos)

function sortDesc(g: Gasto[]): Gasto[] { return [...g].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) }
function emit() { snapshot = sortDesc(gastos); listeners.forEach((l) => l()) }

export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): Gasto[] => snapshot

export function addGasto(input: { fecha: string; categoria: GastoCategoria; concepto: string; monto: number }): Gasto {
  seq += 1
  const g: Gasto = { id: `g-${seq}`, ...input, created_at: new Date().toISOString() }
  gastos = [g, ...gastos]
  emit()
  logAudit({ actor: 'Dirección', action: 'Gasto registrado', resource: input.concepto, detail: `${input.categoria} · $${input.monto}` })
  return g
}

export function removeGasto(id: string) {
  const g = gastos.find((x) => x.id === id)
  gastos = gastos.filter((x) => x.id !== id)
  emit()
  if (g) logAudit({ actor: 'Dirección', action: 'Gasto eliminado', resource: g.concepto })
}
