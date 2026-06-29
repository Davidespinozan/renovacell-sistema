// BITÁCORA DE AUDITORÍA (Regla 5): registro INMUTABLE de acciones críticas
// (creación, cambio de estatus, autorizaciones, cobro, CFDI) con autor y fecha/
// hora. Append-only: no hay edición ni borrado. Mock hoy; con Supabase = tabla
// audit_logs (insert-only, sin update/delete por RLS) + trigger.
export interface AuditEntry {
  id: string
  at: string
  actor: string   // área/usuario responsable
  action: string  // qué pasó
  resource: string // folio / doctor / etc.
  detail?: string
}

let seq = 0
const listeners = new Set<() => void>()

// Seeds: reflejan el recorrido de pedidos que ya viene en los mocks (no inventan).
let entries: AuditEntry[] = [
  { id: 'a-seed-5', at: '2026-05-23T15:10:00.000Z', actor: 'Chofer', action: 'Entrega confirmada', resource: 'S3683' },
  { id: 'a-seed-4', at: '2026-05-21T11:00:00.000Z', actor: 'Empaque', action: 'Envío asignado', resource: 'S3683', detail: 'Estafeta · guía 7790-2291' },
  { id: 'a-seed-3', at: '2026-05-21T10:20:00.000Z', actor: 'Almacén', action: 'Surtido (FEFO)', resource: 'S3683' },
  { id: 'a-seed-2', at: '2026-05-21T10:00:00.000Z', actor: 'Portal del Doctor', action: 'Pedido creado', resource: 'S3683' },
  { id: 'a-seed-1', at: '2026-05-20T09:00:00.000Z', actor: 'Administración', action: 'Doctor verificado', resource: 'Dra. Laura Méndez' },
]
let snapshot: AuditEntry[] = [...entries]

function emit() {
  snapshot = [...entries]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): AuditEntry[] => snapshot

// Append-only: solo agrega al inicio. No existe update/delete a propósito.
export function logAudit(input: { actor: string; action: string; resource: string; detail?: string }) {
  seq += 1
  entries = [{ id: `a-${seq}`, at: new Date().toISOString(), ...input }, ...entries]
  emit()
}
