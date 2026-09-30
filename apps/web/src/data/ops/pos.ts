// Venta en Punto de Venta: inmediata y pagada. W2 · el cobro nace como ASIENTO en el
// libro dentro de la MISMA transacción de la venta (vender_pos), así que `payment_status`
// del POS siempre está respaldado por dinero registrado. Reutiliza la FEFO de Almacén
// (allocateFEFO) para descontar por lote. Con backend, la venta es ATÓMICA: orden +
// renglones + salidas de inventario en UNA transacción (RPC vender_pos). Si el
// inventario no alcanza (otra caja vendió lo mismo), NADA se crea y se revierte lo
// optimista — el cajero recibe el error real, no un falso éxito.
import { getSnapshotLots, consume, reloadInventory } from '../store/lotsStore'
import { createPosOrder, posShippingMeta, reloadOrders, type OrderWithItems } from '../store/ordersStore'
import { allocateFEFO } from './surtir'
import { hasSupabase } from '../../lib/supabase'
import { runW1Command, newOpId } from './w1Command'
import type { Json } from '../database.types'

export interface PosLine {
  product_id: string
  qty: number
  unit_price: number
}

export interface PosResult {
  ok: boolean
  order?: OrderWithItems
  shortfall?: { product_id: string; missing: number }[]
  error?: string
}

const isUuid = (v?: string | null): v is string =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

// Identidad ESTABLE de una venta (W1): order_id = op_id de vender_pos. La caja la conserva
// mientras la misma venta se reintenta (respuesta ambigua) y la renueva al confirmar.
export interface PosOp { orderId: string; folio: string }
export const newPosOp = (): PosOp => ({ orderId: newOpId(), folio: `POS-${Date.now().toString().slice(-6)}` })

// opts: cliente (doctor) y vendedor OPCIONALES. Sin cliente = venta de mostrador
// (público general). El folio, el pago inmediato y la baja de inventario no cambian.
export async function venderPOS(
  lines: PosLine[],
  total: number,
  paymentMethod: string,
  opts: { doctorId?: string | null; customerId?: string | null; customer?: { name: string; phone?: string | null } | null; seller?: string | null; eventId?: string | null; invoiceRequested?: boolean; invoiceMeta?: Record<string, unknown> | null; op?: PosOp; efectivoRecibido?: number | null } = {},
): Promise<PosResult & { ambiguous?: boolean }> {
  if (lines.length === 0) return { ok: false }

  const lots = getSnapshotLots()
  const plans = lines.map((l) => ({ line: l, ...allocateFEFO(l.product_id, l.qty, lots) }))

  const shortfall = plans.filter((p) => p.shortfall > 0).map((p) => ({ product_id: p.line.product_id, missing: p.shortfall }))
  if (shortfall.length > 0) return { ok: false, shortfall }

  const posLines = plans.map((p) => ({
    product_id: p.line.product_id,
    qty: p.line.qty,
    unit_price: p.line.unit_price,
    lot_id: p.allocations[0]?.lot.id ?? null,
  }))
  const orderInput = {
    lines: posLines, total, payment_method: paymentMethod,
    doctor_id: opts.doctorId ?? null, customer_id: opts.customerId ?? null, customer: opts.customer ?? null,
    seller: opts.seller ?? null, event_id: opts.eventId ?? null,
    invoice_requested: opts.invoiceRequested ?? false, invoice_meta: opts.invoiceMeta ?? null,
  }

  if (hasSupabase) {
    // W1: la venta la confirma el SERVIDOR antes de mostrar el ticket (sin éxito optimista).
    // Asignaciones por renglón (line_index): el servidor valida producto, caducidad, cobertura y stock.
    const op = opts.op ?? newPosOp()
    const allocations = plans.flatMap((p, i) => p.allocations.map((a) => ({ line_index: i, lot_id: a.lot.id, qty: a.qty })))
    const r = await runW1Command<{ value?: boolean; order_id?: string }>('vender_pos', {
      p_order_id: op.orderId,
      p_folio: op.folio,
      p_total: total,
      p_payment_method: paymentMethod,
      p_doctor_id: (isUuid(opts.doctorId) ? opts.doctorId : null) as unknown as string, // NULL = mostrador (válido en SQL)
      p_customer_id: (isUuid(opts.customerId) ? opts.customerId : undefined),
      p_shipping_meta: posShippingMeta(orderInput) as Json,
      p_lines: posLines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price })),
      p_allocations: allocations,
      p_invoice_requested: opts.invoiceRequested ?? false,
      p_invoice_meta: (opts.invoiceMeta ?? undefined) as Json | undefined,
      // W2 · el efectivo con el que pagó el cliente queda como EVIDENCIA del asiento
      // (recibido/cambio), que es lo que el corte de caja necesita poder explicar.
      // No entra en la huella de idempotencia: corregirlo no crea otra venta.
      p_efectivo_recibido: (opts.efectivoRecibido ?? undefined),
    }, op.orderId)
    if (!r.ok) {
      reloadOrders(); reloadInventory()
      return { ok: false, error: r.error, ambiguous: r.ambiguous }
    }
    if (r.data.value === false) {
      reloadOrders(); reloadInventory()
      return { ok: false, error: 'No se pudo completar la venta: el inventario no alcanza. Verifica existencias.' }
    }
    // Confirmada: refleja el ticket con el MISMO id/folio del servidor y sincroniza.
    const order = createPosOrder({ ...orderInput, id: op.orderId, folio: op.folio }, true)
    reloadOrders(); reloadInventory()
    return { ok: true, order }
  }

  // Modo local (sin backend): descuento local directo.
  const order = createPosOrder(orderInput, false)
  const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })))
  consume(allocations, order.external_ref ?? order.id, 'venta')
  return { ok: true, order }
}
