// Compras a proveedores (Dirección / Facturación). Con backend la orden NACE por el comando
// idempotente `crear_orden_compra` (W1, op_id estable: un doble clic o un reintento devuelven
// la MISMA orden) y se lee de `replenishments`. COMPRA a proveedor o PRODUCCIÓN interna.
// Almacén luego RECIBE la mercancía (recibir_lote 'orden') y ahí, no antes, entra al inventario.
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import { runW1Command, newOpId } from '../ops/w1Command'
import { type Escritura } from './escritura'
import { leerTodo } from './lectura'

export type ReplenKind = 'compra' | 'produccion'
// W1: recepción parcial y acumulada; 'recibida' y 'cerrada_incompleta' son terminales (no se reabren).
export type ReplenStatus = 'pendiente' | 'parcial' | 'recibida' | 'cerrada_incompleta'

export interface PurchaseOrder {
  id: string
  product_id: string
  product_name: string
  qty: number
  unit_cost: number
  kind: ReplenKind
  supplier: string | null
  status: ReplenStatus
  paid: boolean
  created_at: string
  received_qty?: number          // acumulado recibido (lo mantiene el servidor)
  close_reason?: string | null
}
// Pendiente por recibir de una orden (lo que aún admite recepción).
export const pendingQty = (o: PurchaseOrder): number => Math.max(0, o.qty - (o.received_qty ?? 0))
export const isOpen = (o: PurchaseOrder): boolean => o.status === 'pendiente' || o.status === 'parcial'

const isUuid = (s: string | null | undefined): boolean => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)

const live = makeLive<PurchaseOrder>(async () => {
  const { data, error } = await leerTodo('las compras', (a, b) => supabase.from('replenishments')
    .select('id, product_id, product_name, qty, unit_cost, kind, supplier, status, paid, created_at, received_qty, close_reason')
    .order('created_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as PurchaseOrder[]
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
// Recarga la lista de compras (tras una recepción atómica que marcó 'recibida' en el server).
export const reloadCompras = (): void => { void live.reload() }
// Modo demo (sin backend): refleja una recepción en el cache local con el mismo acumulado que el servidor.
export function markReceivedLocal(id: string, qty?: number): void {
  live.setLocal(live.current().map((o) => {
    if (o.id !== id) return o
    const rec = Math.min(o.qty, (o.received_qty ?? 0) + (qty ?? o.qty - (o.received_qty ?? 0)))
    return { ...o, received_qty: rec, status: rec >= o.qty ? 'recibida' : 'parcial' }
  }))
}

// Dirección cierra una orden incompleta (terminal; el faltante va en una orden nueva).
export async function cerrarOrdenCompra(opId: string, id: string, reason: string): Promise<{ ok: boolean; error?: string; ambiguous?: boolean }> {
  if (!reason.trim()) return { ok: false, error: 'Escribe el motivo — es obligatorio.' }
  if (!hasSupabase) {
    live.setLocal(live.current().map((o) => (o.id === id && isOpen(o) ? { ...o, status: 'cerrada_incompleta', close_reason: reason.trim() } : o)))
    return { ok: true }
  }
  const r = await runW1Command('cerrar_orden_compra', { p_op_id: opId, p_replenishment: id, p_reason: reason.trim() }, opId)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  await live.reload()
  const po = live.current().find((o) => o.id === id)
  if (po) logAudit({ actor: 'Dirección', action: 'Orden cerrada incompleta', resource: po.product_name, detail: reason.trim() })
  return { ok: true }
}

let seq = 0
// W4: la orden solo "existe" cuando el servidor la confirmó. Antes Almacén recibía
// "compra por recibir" de una orden que el servidor podía haber rechazado.
export type OrdenCreada = { ok: true; order: PurchaseOrder; status?: string } | { ok: false; error: string; ambiguous: boolean }

// P2-1 · `opId` es la identidad de la INTENCIÓN (useOpId en la pantalla): reintentar con el mismo
// op_id no crea otra orden; una intención nueva renueva el op_id. Sin backend (demo) se simula igual.
const demoPorOp = new Map<string, PurchaseOrder>()
export async function createReplenishment(input: { product_id: string; product_name: string; qty: number; unit_cost: number; kind: ReplenKind; supplier?: string | null }, opId: string = newOpId()): Promise<OrdenCreada> {
  const verbo = input.kind === 'compra' ? 'Compra' : 'Producción'
  const supplier = input.kind === 'compra' ? (input.supplier?.trim() || null) : null
  if (!hasSupabase) {
    const previa = demoPorOp.get(opId)
    if (previa) return { ok: true, order: previa, status: 'already_applied' }
    seq += 1
    const po: PurchaseOrder = {
      id: `po-${seq}`, product_id: input.product_id, product_name: input.product_name, qty: input.qty, unit_cost: input.unit_cost,
      kind: input.kind, supplier, status: 'pendiente', paid: input.kind !== 'compra', created_at: new Date().toISOString(), received_qty: 0,
    }
    demoPorOp.set(opId, po)
    live.setLocal([po, ...live.current()])
    notify({ text: `${verbo} por recibir: ${input.product_name} ×${input.qty}`, roles: ['warehouse'], screen: 'entradas' })
    logAudit({ actor: 'Dirección', action: input.kind === 'compra' ? 'Compra a proveedor' : 'Orden de producción', resource: input.product_name, detail: `×${input.qty}${supplier ? ` · ${supplier}` : ''}` })
    return { ok: true, order: po }
  }
  const r = await runW1Command<{ replenishment_id?: string; paid?: boolean }>('crear_orden_compra', {
    p_op_id: opId, p_product: input.product_id, p_qty: input.qty, p_unit_cost: input.unit_cost, p_kind: input.kind,
    p_supplier: supplier ?? undefined, p_product_name: input.product_name,
  }, opId)
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous ?? false }
  await live.reload()
  const po = live.current().find((o) => o.id === r.data.replenishment_id)
    ?? { id: r.data.replenishment_id ?? '', product_id: input.product_id, product_name: input.product_name, qty: input.qty, unit_cost: input.unit_cost, kind: input.kind, supplier, status: 'pendiente' as const, paid: input.kind !== 'compra', created_at: new Date().toISOString(), received_qty: 0 }
  if (r.status !== 'already_applied') {
    notify({ text: `${verbo} por recibir: ${input.product_name} ×${input.qty}`, roles: ['warehouse'], screen: 'entradas' })
    logAudit({ actor: 'Dirección', action: input.kind === 'compra' ? 'Compra a proveedor' : 'Orden de producción', resource: input.product_name, detail: `×${input.qty}${supplier ? ` · ${supplier}` : ''}` })
  }
  return { ok: true, order: po, status: r.status }
}

// Modo demo: marca la orden como recibida por completo. Con backend el estado y el
// acumulado los mantiene SOLO el servidor (recibir_lote / cerrar_orden_compra).
export function markReceived(id: string) {
  if (hasSupabase) return
  const po = live.current().find((o) => o.id === id)
  live.setLocal(live.current().map((o) => (o.id === id ? { ...o, status: 'recibida', received_qty: o.qty } : o)))
  if (po) logAudit({ actor: 'Almacén', action: 'Reabastecimiento recibido', resource: po.product_name, detail: `×${po.qty}` })
}

// W4: "pagada" es un hecho de dinero. No se anuncia ni se audita hasta confirmarlo.
// P2-2 · La autoridad es del servidor (RLS: Dirección/Facturación). Un UPDATE que afecta 0 filas NO
// es éxito: se pide la fila de vuelta y, si no viene, se informa que no se marcó.
export const PUEDE_MARCAR_PAGADO = (role: string | null | undefined): boolean => role === 'admin' || role === 'billing'
export async function markPaid(id: string): Promise<Escritura> {
  const po = live.current().find((o) => o.id === id)
  if (hasSupabase) {
    if (!isUuid(id)) return { ok: false, error: 'Esta orden no existe en el servidor.', ambiguous: false }
    let res: { data: unknown[] | null; error: { message?: string } | null }
    try { res = await supabase.from('replenishments').update({ paid: true }).eq('id', id).select('id') as unknown as typeof res }
    catch { void live.reload(); return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.', ambiguous: true } }
    if (res.error) { void live.reload(); return { ok: false, error: /permission|policy|denied/i.test(res.error.message ?? '') ? 'Solo Dirección o Facturación registran el pago a proveedores.' : (res.error.message ?? 'No se pudo marcar como pagada.'), ambiguous: false } }
    if (!res.data || res.data.length === 0) { void live.reload(); return { ok: false, error: 'No se marcó como pagada: solo Dirección o Facturación registran el pago a proveedores.', ambiguous: false } }
  }
  live.setLocal(live.current().map((o) => (o.id === id ? { ...o, paid: true } : o)))
  if (po) logAudit({ actor: 'Dirección', action: 'Pago a proveedor', resource: po.product_name, detail: `$${po.unit_cost * po.qty}${po.supplier ? ` · ${po.supplier}` : ''}` })
  return { ok: true }
}
