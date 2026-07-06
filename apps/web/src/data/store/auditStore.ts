// BITÁCORA DE AUDITORÍA (Regla 5): registro INMUTABLE de acciones críticas. Con
// backend, logAudit() registra vía el RPC seguro `log_audit` (los clientes no
// insertan directo en la tabla inmutable) y la lectura hidrata de `audit_logs`
// (RLS: solo admin lee). Append-only: no hay edición ni borrado.
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  resource: string
  detail?: string
}

// Seeds SOLO para modo mock (sin backend).
const SEED: AuditEntry[] = [
  { id: 'a-seed-5', at: '2026-05-23T15:10:00.000Z', actor: 'Chofer', action: 'Entrega confirmada', resource: 'S3683' },
  { id: 'a-seed-4', at: '2026-05-21T11:00:00.000Z', actor: 'Empaque', action: 'Envío asignado', resource: 'S3683', detail: 'Estafeta · guía 7790-2291' },
  { id: 'a-seed-3', at: '2026-05-21T10:20:00.000Z', actor: 'Almacén', action: 'Surtido (FEFO)', resource: 'S3683' },
  { id: 'a-seed-2', at: '2026-05-21T10:00:00.000Z', actor: 'Portal del Doctor', action: 'Pedido creado', resource: 'S3683' },
  { id: 'a-seed-1', at: '2026-05-20T09:00:00.000Z', actor: 'Administración', action: 'Doctor verificado', resource: 'Dra. Laura Méndez' },
]

const live = makeLive<AuditEntry>(async () => {
  const { data, error } = await supabase.from('audit_logs')
    .select('id, action, resource_id, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw error
  return (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as { actor_name?: string; detail?: string }
    return {
      id: r.id, at: r.created_at ?? '', actor: p.actor_name ?? 'Sistema',
      action: r.action ?? '', resource: r.resource_id ?? '', detail: p.detail ?? undefined,
    }
  })
}, SEED)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0
export function logAudit(input: { actor: string; action: string; resource: string; detail?: string }) {
  seq += 1
  live.setLocal([{ id: `a-${seq}`, at: new Date().toISOString(), ...input }, ...live.current()])
  if (hasSupabase) {
    supabase.rpc('log_audit', { p_action: input.action, p_resource: input.resource, p_detail: input.detail ?? '', p_actor_name: input.actor })
      .then(({ error }) => { if (error) console.warn('[audit] log', error.message) })
  }
}
