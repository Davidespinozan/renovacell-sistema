// Venta en Punto de Venta: inmediata y pagada. Reutiliza la FEFO de Almacén
// (allocateFEFO) para descontar por lote y conecta los stores compartidos:
// crea la orden POS (pagada/entregada) y registra las salidas de inventario.
import { getSnapshotLots, consume } from '../store/lotsStore'
import { createPosOrder, type OrderWithItems } from '../store/ordersStore'
import { allocateFEFO } from './surtir'

export interface PosLine {
  product_id: string
  qty: number
  unit_price: number
}

export interface PosResult {
  ok: boolean
  order?: OrderWithItems
  shortfall?: { product_id: string; missing: number }[]
}

// opts: cliente (doctor) y vendedor OPCIONALES. Sin cliente = venta de mostrador
// (público general). El folio, el pago inmediato y la baja de inventario no cambian.
export function venderPOS(
  lines: PosLine[],
  total: number,
  paymentMethod: string,
  opts: { doctorId?: string | null; seller?: string | null } = {},
): PosResult {
  if (lines.length === 0) return { ok: false }

  const lots = getSnapshotLots()
  const plans = lines.map((l) => ({ line: l, ...allocateFEFO(l.product_id, l.qty, lots) }))

  const shortfall = plans.filter((p) => p.shortfall > 0).map((p) => ({ product_id: p.line.product_id, missing: p.shortfall }))
  if (shortfall.length > 0) return { ok: false, shortfall }

  // Crea la orden POS (lot_id = lote principal por renglón).
  const order = createPosOrder({
    lines: plans.map((p) => ({
      product_id: p.line.product_id,
      qty: p.line.qty,
      unit_price: p.line.unit_price,
      lot_id: p.allocations[0]?.lot.id ?? null,
    })),
    total,
    payment_method: paymentMethod,
    doctor_id: opts.doctorId ?? null,
    seller: opts.seller ?? null,
  })

  // Descuenta inventario por lote (salida) con referencia al folio.
  const allocations = plans.flatMap((p) => p.allocations.map((a) => ({ lot_id: a.lot.id, qty: a.qty })))
  consume(allocations, order.external_ref ?? order.id, 'venta')

  return { ok: true, order }
}
