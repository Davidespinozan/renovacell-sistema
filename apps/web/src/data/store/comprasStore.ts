// Reabastecimiento (Dirección). Cuando el sistema muestra stock bajo (tablero +
// campana), Dirección registra el reabastecimiento: COMPRA a un proveedor o
// PRODUCCIÓN interna (modelo mixto). Almacén luego RECIBE y da de alta el lote.
// Mock hoy; con Supabase = tabla replenishments. El alta de inventario real
// (lote + caducidad) se hace en Almacén → Entradas / al recibir.
import { notify } from './notificationsStore'
import { logAudit } from './auditStore'

export type ReplenKind = 'compra' | 'produccion'
export type ReplenStatus = 'pendiente' | 'recibida'

export interface PurchaseOrder {
  id: string
  product_id: string
  product_name: string
  qty: number
  unit_cost: number         // costo unitario (proveedor o producción) → hereda al lote
  kind: ReplenKind
  supplier: string | null   // proveedor (solo en compra)
  status: ReplenStatus
  paid: boolean             // si es compra: ¿ya se pagó al proveedor? (cuentas por pagar)
  created_at: string
}

let orders: PurchaseOrder[] = []
let seq = 0
const listeners = new Set<() => void>()
let snapshot: PurchaseOrder[] = []

function emit() {
  snapshot = [...orders]
  listeners.forEach((l) => l())
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const getSnapshot = (): PurchaseOrder[] => snapshot

// Dirección registra el reabastecimiento (compra o producción). Avisa a Almacén
// para que lo reciba y dé de alta el lote.
export function createReplenishment(input: { product_id: string; product_name: string; qty: number; unit_cost: number; kind: ReplenKind; supplier?: string | null }): PurchaseOrder {
  seq += 1
  const po: PurchaseOrder = {
    id: `po-${seq}`, product_id: input.product_id, product_name: input.product_name, qty: input.qty,
    unit_cost: input.unit_cost,
    kind: input.kind, supplier: input.kind === 'compra' ? (input.supplier ?? null) : null,
    status: 'pendiente', paid: input.kind !== 'compra', // producción no genera cuenta por pagar
    created_at: new Date().toISOString(),
  }
  orders = [po, ...orders]
  emit()
  const verbo = input.kind === 'compra' ? 'Compra' : 'Producción'
  notify({ text: `${verbo} por recibir: ${input.product_name} ×${input.qty}`, roles: ['warehouse'], screen: 'compras' })
  logAudit({ actor: 'Dirección', action: input.kind === 'compra' ? 'Compra a proveedor' : 'Orden de producción', resource: input.product_name, detail: `×${input.qty}${po.supplier ? ` · ${po.supplier}` : ''}` })
  return po
}

export function markReceived(id: string) {
  const po = orders.find((o) => o.id === id)
  orders = orders.map((o) => (o.id === id ? { ...o, status: 'recibida' } : o))
  emit()
  if (po) logAudit({ actor: 'Almacén', action: 'Reabastecimiento recibido', resource: po.product_name, detail: `×${po.qty}` })
}

// Pago al proveedor: liquida la cuenta por pagar (salida de efectivo, NO gasto:
// el costo ya va a Costo de Ventas cuando se venda el lote).
export function markPaid(id: string) {
  const po = orders.find((o) => o.id === id)
  orders = orders.map((o) => (o.id === id ? { ...o, paid: true } : o))
  emit()
  if (po) logAudit({ actor: 'Dirección', action: 'Pago a proveedor', resource: po.product_name, detail: `$${po.unit_cost * po.qty}${po.supplier ? ` · ${po.supplier}` : ''}` })
}
