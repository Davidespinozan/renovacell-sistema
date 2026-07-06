// Cierres de caja (arqueo). Con backend lee/escribe `cash_closings` (RLS
// admin/billing/pos). Esperado (ventas en efectivo) vs. contado (físico),
// diferencia y motivo → control de efectivo y auditoría.
import { logAudit } from './auditStore'
import { hasSupabase, supabase, currentUserId } from '../../lib/supabase'
import { makeLive } from './live'

export interface Cierre {
  id: string
  fecha: string
  alcance: string
  esperado: number
  contado: number
  diferencia: number
  motivo: string | null
  usuario: string
  created_at: string
}

const live = makeLive<Cierre>(async () => {
  const { data, error } = await supabase.from('cash_closings')
    .select('id, fecha, alcance, esperado, contado, diferencia, motivo, usuario, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Cierre[]
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0
export function registrarCierre(input: { fecha: string; alcance: string; esperado: number; contado: number; motivo: string | null; usuario: string }): Cierre {
  seq += 1
  const c: Cierre = { id: hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `cc-${seq}`) : `cc-${seq}`, ...input, diferencia: input.contado - input.esperado, created_at: new Date().toISOString() }
  live.setLocal([c, ...live.current()])
  const dif = c.diferencia
  logAudit({ actor: input.usuario, action: 'Cierre de caja', resource: input.alcance, detail: dif === 0 ? 'cuadrado' : `${dif > 0 ? 'sobrante' : 'faltante'} $${Math.abs(dif)}` })
  if (hasSupabase) {
    supabase.from('cash_closings').insert({ id: c.id, fecha: input.fecha, alcance: input.alcance, esperado: input.esperado, contado: input.contado, diferencia: c.diferencia, motivo: input.motivo, usuario: input.usuario, created_by: currentUserId() })
      .then(({ error }) => { if (error) console.warn('[cash_closings] insert', error.message); live.reload() })
  }
  return c
}
