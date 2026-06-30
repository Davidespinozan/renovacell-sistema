// Capa de métricas/KPIs (funciones PURAS sobre los datos del ciclo).
// La usan el Tablero y Admin→Ventas. Nada de datos nuevos: agrega de
// orders/order_items + products + doctores existentes.
import type { OrderWithItems } from './hooks/useOrders'
import type { ProductSafe, Profile } from './types'

// "Venta" para KPIs: cuenta solo pedidos confirmados (al menos surtidos) o cobrados.
// Excluye cancelados, borradores y pendientes de surtir → no infla ingresos con pipeline.
const isSale = (o: OrderWithItems) => o.status != null && !['cancelled', 'draft', 'pending_payment'].includes(o.status)
export const isPosOrder = (o: OrderWithItems) => Boolean(o.external_ref && o.external_ref.startsWith('POS'))

export interface SalesSummary {
  revenue: number
  orders: number
  avgTicket: number
}
export function salesSummary(orders: OrderWithItems[]): SalesSummary {
  const valid = orders.filter(isSale)
  const revenue = valid.reduce((s, o) => s + (o.total ?? 0), 0)
  const count = valid.length
  return { revenue, orders: count, avgTicket: count ? revenue / count : 0 }
}

export interface ChannelSplit {
  pos: { orders: number; revenue: number }
  portal: { orders: number; revenue: number }
}
export function channelSplit(orders: OrderWithItems[]): ChannelSplit {
  const acc: ChannelSplit = { pos: { orders: 0, revenue: 0 }, portal: { orders: 0, revenue: 0 } }
  orders.filter(isSale).forEach((o) => {
    const k = isPosOrder(o) ? 'pos' : 'portal'
    acc[k].orders += 1
    acc[k].revenue += o.total ?? 0
  })
  return acc
}

export interface DoctorActivity {
  active: number // doctores con >=1 pedido
  repeat: number // doctores con >1 pedido
  repeatRate: number // repeat / active
}
export function doctorActivity(orders: OrderWithItems[]): DoctorActivity {
  const byDoctor = new Map<string, number>()
  orders.filter(isSale).forEach((o) => {
    if (!o.doctor_id) return
    byDoctor.set(o.doctor_id, (byDoctor.get(o.doctor_id) ?? 0) + 1)
  })
  const active = byDoctor.size
  const repeat = [...byDoctor.values()].filter((n) => n > 1).length
  return { active, repeat, repeatRate: active ? repeat / active : 0 }
}

export interface DoctorLTV {
  id: string
  name: string
  orders: number
  total: number
}
export function topDoctors(orders: OrderWithItems[], doctorsById: Record<string, Profile | undefined>, limit = 5): DoctorLTV[] {
  const m = new Map<string, { orders: number; total: number }>()
  orders.filter(isSale).forEach((o) => {
    if (!o.doctor_id) return
    const cur = m.get(o.doctor_id) ?? { orders: 0, total: 0 }
    cur.orders += 1
    cur.total += o.total ?? 0
    m.set(o.doctor_id, cur)
  })
  return [...m.entries()]
    .map(([id, v]) => ({ id, name: doctorsById[id]?.full_name ?? 'Doctor', ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
}

export interface ProductSales {
  id: string
  name: string
  units: number
  revenue: number
}
export function topProducts(orders: OrderWithItems[], productsById: Record<string, ProductSafe | undefined>, limit = 5): ProductSales[] {
  const m = new Map<string, { units: number; revenue: number }>()
  orders.filter(isSale).forEach((o) => {
    o.items.forEach((it) => {
      if (it.unit_price == null || !it.product_id) return // cotizaciones no cuentan como venta
      const cur = m.get(it.product_id) ?? { units: 0, revenue: 0 }
      cur.units += it.qty
      cur.revenue += (it.unit_price ?? 0) * it.qty
      m.set(it.product_id, cur)
    })
  })
  return [...m.entries()]
    .map(([id, v]) => ({ id, name: productsById[id]?.name ?? 'Producto', ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}

export interface LineMix {
  cosm: { units: number; revenue: number }
  prof: { units: number; revenue: number }
}
export function lineMix(orders: OrderWithItems[], productsById: Record<string, ProductSafe | undefined>): LineMix {
  const acc: LineMix = { cosm: { units: 0, revenue: 0 }, prof: { units: 0, revenue: 0 } }
  orders.filter(isSale).forEach((o) => {
    o.items.forEach((it) => {
      if (it.unit_price == null || !it.product_id) return // cotizaciones no cuentan
      const line = productsById[it.product_id]?.line === 'prof' ? 'prof' : 'cosm'
      acc[line].units += it.qty
      acc[line].revenue += it.unit_price * it.qty
    })
  })
  return acc
}

// Ventas por mes (últimos N meses), para gráfica de tendencia.
export interface MonthPoint {
  key: string
  label: string
  revenue: number
}
export function monthlySales(orders: OrderWithItems[], months = 6): MonthPoint[] {
  const now = new Date()
  const buckets: MonthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.push({ key, label: d.toLocaleString('es-MX', { month: 'short' }), revenue: 0 })
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]))
  orders.filter(isSale).forEach((o) => {
    const d = new Date(o.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const i = idx.get(key)
    if (i != null) buckets[i].revenue += o.total ?? 0
  })
  return buckets
}

// Doctores en riesgo: verificados sin pedidos recientes (analogía "miembros en riesgo").
export interface DoctorRisk {
  id: string
  name: string
  lastDays: number | null // días desde su último pedido (null = nunca)
  total: number
}
export function doctorsAtRisk(orders: OrderWithItems[], doctors: Profile[], days = 60): DoctorRisk[] {
  const last = new Map<string, number>()
  const total = new Map<string, number>()
  orders.filter(isSale).forEach((o) => {
    if (!o.doctor_id) return
    const t = new Date(o.created_at).getTime()
    last.set(o.doctor_id, Math.max(last.get(o.doctor_id) ?? 0, t))
    total.set(o.doctor_id, (total.get(o.doctor_id) ?? 0) + (o.total ?? 0))
  })
  const now = Date.now()
  return doctors
    .filter((d) => d.verified)
    .map((d) => {
      const lt = last.get(d.id)
      return { id: d.id, name: d.full_name ?? 'Doctor', lastDays: lt ? Math.floor((now - lt) / 86_400_000) : null, total: total.get(d.id) ?? 0 }
    })
    .filter((r) => r.lastDays == null || r.lastDays > days)
    .sort((a, b) => b.total - a.total)
}

// CFDI solicitados (% de pedidos) y cobrado vs pendiente.
export interface BillingSummary {
  cfdiRate: number
  paid: number
  pending: number
}
export function billingSummary(orders: OrderWithItems[]): BillingSummary {
  const valid = orders.filter(isSale)
  const cfdi = valid.filter((o) => o.invoice_requested).length
  const paid = valid.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + (o.total ?? 0), 0)
  const pending = valid.filter((o) => o.payment_status !== 'paid').reduce((s, o) => s + (o.total ?? 0), 0)
  return { cfdiRate: valid.length ? cfdi / valid.length : 0, paid, pending }
}
