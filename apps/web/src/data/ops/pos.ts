// Venta en Punto de Venta: inmediata y pagada. Reutiliza la FEFO de Almacén
// (allocateFEFO) para descontar por lote. Con backend, la venta es ATÓMICA: orden +
// renglones + salidas de inventario en UNA transacción (RPC vender_pos). Si el
// inventario no alcanza (otra caja vendió lo mismo), NADA se crea y se revierte lo
// optimista — el cajero recibe el error real, no un falso éxito.
import { getSnapshotLots, consume, reloadInventory } from '../store/lotsStore'
import { createPosOrder, reloadOrders, type OrderWithItems } from '../store/ordersStore'
import { allocateFEFO } from './surtir'
import { hasSupabase, supabase } from '../../lib/supabase'
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

// opts: cliente (doctor) y vendedor OPCIONALES. Sin cliente = venta de mostrador
// (público general). El folio, el pago inmediato y la baja de inventario no cambian.
export async function venderPOS(
  lines: PosLine[],
  total: number,
  paymentMethod: string,
  opts: { doctorId?: string | null; seller?: string | null; eventId?: string | null } = {},
): Promise<PosResult> {
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
  const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })))

  // Optimista local (respuesta instantánea del ticket). Con backend, `localOnly` evita
  // la escritura suelta: la persistencia real la hace la RPC atómica de abajo.
  const order = createPosOrder({
    lines: posLines, total, payment_method: paymentMethod,
    doctor_id: opts.doctorId ?? null, seller: opts.seller ?? null, event_id: opts.eventId ?? null,
  }, hasSupabase)

  if (hasSupabase) {
    const { data, error } = await supabase.rpc('vender_pos', {
      p_order_id: order.id,
      p_folio: order.external_ref ?? order.id,
      p_total: total,
      p_payment_method: paymentMethod,
      p_doctor_id: (isUuid(opts.doctorId) ? opts.doctorId : null) as unknown as string,
      p_shipping_meta: ((order.shipping_meta ?? {}) as unknown) as Json,
      p_lines: (posLines.map((l) => ({ ...l, lot_id: isUuid(l.lot_id) ? l.lot_id : null })) as unknown) as Json,
      p_allocations: (allocations.filter((a) => isUuid(a.lot_id)) as unknown) as Json,
    })
    if (error || data !== true) {
      // La venta NO se concretó (inventario insuficiente u otro error): revierte lo
      // optimista para no dejar una venta fantasma cobrada sin bajar stock.
      reloadOrders(); reloadInventory()
      return { ok: false, error: error?.message ?? 'No se pudo completar la venta: el inventario no alcanza. Verifica existencias.' }
    }
    // El RPC ya descontó el inventario; refleja el descuento localmente y sincroniza.
    consume(allocations, order.external_ref ?? order.id, 'venta', true)
    reloadInventory()
    return { ok: true, order }
  }

  // Modo local (sin backend): descuento local directo.
  consume(allocations, order.external_ref ?? order.id, 'venta')
  return { ok: true, order }
}