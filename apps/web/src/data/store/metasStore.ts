// Metas (cuota mensual) y tasa de comisión por vendedor. Con backend lee/escribe
// `sales_targets` (RLS admin). La fila '__default__' guarda la tasa global del equipo y
// la meta base. Sin backend, opera sobre valores mock. Solo Dirección los consume.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

export interface SalesTarget { seller: string; target: number; commission_rate: number }

export const DEFAULT_KEY = '__default__'

const MOCK: SalesTarget[] = [
  { seller: DEFAULT_KEY, target: 60000, commission_rate: 0.05 },
  { seller: 'ventas1@renovacell.mx', target: 80000, commission_rate: 0.05 },
  { seller: 'ventas2@renovacell.mx', target: 70000, commission_rate: 0.05 },
]

const live = makeLive<SalesTarget>(async () => {
  const { data, error } = await supabase.from('sales_targets').select('seller, target, commission_rate')
  if (error) throw error
  return (data ?? []) as SalesTarget[]
}, MOCK)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

export function defaultRow(): SalesTarget {
  return live.current().find((t) => t.seller === DEFAULT_KEY) ?? { seller: DEFAULT_KEY, target: 0, commission_rate: 0.05 }
}
export function globalRate(): number { return defaultRow().commission_rate }
export function targetFor(seller: string): number {
  const row = live.current().find((t) => t.seller === seller)
  return row?.target ?? defaultRow().target
}

function upsert(row: SalesTarget) {
  const cur = live.current()
  const exists = cur.some((t) => t.seller === row.seller)
  live.setLocal(exists ? cur.map((t) => (t.seller === row.seller ? row : t)) : [...cur, row])
  if (hasSupabase) {
    supabase.from('sales_targets').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'seller' })
      .then(({ error }) => { if (error) console.warn('[metas] upsert', error.message); live.reload() })
  }
}

export function setTarget(seller: string, target: number) {
  const rate = live.current().find((t) => t.seller === seller)?.commission_rate ?? globalRate()
  upsert({ seller, target: Math.max(0, target), commission_rate: rate })
  logAudit({ actor: 'Administración', action: 'Meta de vendedor actualizada', resource: seller, detail: `$${Math.max(0, target)}` })
}

export function setGlobalRate(rate: number) {
  const r = Math.min(1, Math.max(0, rate))
  upsert({ ...defaultRow(), seller: DEFAULT_KEY, commission_rate: r })
  logAudit({ actor: 'Administración', action: 'Tasa de comisión actualizada', resource: 'equipo', detail: `${(r * 100).toFixed(1)}%` })
}
