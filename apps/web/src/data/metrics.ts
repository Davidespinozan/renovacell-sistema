// Capa de métricas/KPIs (funciones PURAS sobre los datos del ciclo).
// La usan el Tablero y Admin→Ventas. Nada de datos nuevos: agrega de
// orders/order_items + products + doctores existentes.
import type { OrderWithItems } from './hooks/useOrders'
import type { ProductSafe, Profile } from './types'
import { diaNegocio, diasEntre, duracionDias, etiquetaMes, hoyNegocio, mesNegocio, nombreMes, ultimosMeses } from './periodo'

// "Venta" para KPIs: cuenta solo pedidos confirmados (al menos surtidos) o cobrados.
// Excluye cancelados, borradores y pendientes de surtir → no infla ingresos con pipeline.
export const isSale = (o: OrderWithItems) => o.status != null && !['cancelled', 'draft', 'pending_payment'].includes(o.status)
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

// DOCTORES EN RIESGO (retención) — DEFINICIÓN ÚNICA.
// Un doctor está en riesgo cuando: (1) está VERIFICADO, (2) ya compró alguna vez y
// (3) su último pedido-venta fue hace `days` días de calendario del negocio o más.
// Un doctor que nunca ha comprado no está "en riesgo": no es cliente todavía.
// Lista accionable para que Ventas los llame ANTES de perderlos, ordenada por urgencia.
export const DIAS_RIESGO = 30
export interface DoctorRiesgo {
  id: string
  name: string
  phone?: string
  email?: string
  organization?: string
  lastOrder: string       // instante del último pedido
  diasSinPedir: number    // días de calendario del negocio desde ese pedido
  orders: number          // pedidos históricos (señal de qué tan valioso era)
  total: number           // gasto histórico
}
export function doctoresEnRiesgo(
  orders: OrderWithItems[],
  doctors: Profile[],
  opts: { days?: number; now?: Date } = {},
): DoctorRiesgo[] {
  const days = opts.days ?? DIAS_RIESGO
  const hoy = hoyNegocio(opts.now ?? new Date())
  // Último pedido, conteo y total por doctor (solo ventas reales).
  const m = new Map<string, { last: number; orders: number; total: number }>()
  orders.filter(isSale).forEach((o) => {
    if (!o.doctor_id) return
    const t = Date.parse(o.created_at)
    if (Number.isNaN(t)) return
    const cur = m.get(o.doctor_id) ?? { last: 0, orders: 0, total: 0 }
    cur.last = Math.max(cur.last, t)
    cur.orders += 1
    cur.total += o.total ?? 0
    m.set(o.doctor_id, cur)
  })
  const byId = new Map(doctors.map((d) => [d.id, d]))
  const out: DoctorRiesgo[] = []
  m.forEach((v, id) => {
    const d = byId.get(id)
    if (!d || !d.verified) return // solo doctores verificados (clientes reales)
    const diasSinPedir = diasEntre(diaNegocio(v.last), hoy)
    if (diasSinPedir < days) return // aún activo
    out.push({
      id,
      name: d.full_name ?? 'Doctor',
      phone: (d.meta?.phone as string) ?? undefined,
      email: d.email ?? undefined,
      organization: d.organization ?? undefined,
      lastOrder: new Date(v.last).toISOString(),
      diasSinPedir,
      orders: v.orders,
      total: v.total,
    })
  })
  return out.sort((a, b) => b.diasSinPedir - a.diasSinPedir)
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

// Ventas por MES DEL NEGOCIO (últimos N meses, del más antiguo al actual), para la
// gráfica de tendencia. Cada pedido cae en el mes de su día del negocio: el mismo
// corte que usan las cifras de cabecera del servidor.
export interface MonthPoint {
  key: string
  label: string
  titulo: string
  revenue: number
}
export function monthlySales(orders: OrderWithItems[], months = 6, ahora: Date = new Date()): MonthPoint[] {
  const buckets: MonthPoint[] = ultimosMeses(months, ahora).map((mes) => ({
    key: mes, label: nombreMes(mes).slice(0, 3), titulo: etiquetaMes(mes), revenue: 0,
  }))
  const idx = new Map(buckets.map((b, i) => [b.key, i]))
  orders.filter(isSale).forEach((o) => {
    const i = idx.get(mesNegocio(o.created_at))
    if (i != null) buckets[i].revenue += o.total ?? 0
  })
  return buckets
}

// % de pedidos-venta en los que el cliente solicitó CFDI. (El dinero cobrado y por
// cobrar NO se calcula aquí: sale de `kpi_ventas` / `kpi_por_cobrar`.)
export function cfdiSolicitados(orders: OrderWithItems[]): number {
  const valid = orders.filter(isSale)
  return valid.length ? valid.filter((o) => o.invoice_requested).length / valid.length : 0
}

// ── LEAD TIME pedido → entrega ────────────────────────────────────────────────
// Cuánto tarda el negocio en cumplir, de punta a punta: de que el doctor levanta
// el pedido a que el paquete queda entregado. Es el KPI de servicio que le importa
// a Dirección (y el que revela si el cuello está en surtido o en reparto).
export interface LeadTime { entregados: number; promedioDias: number | null; peorDias: number | null }

export function leadTime(
  orders: OrderWithItems[],
  shipments: { order_id: string; delivered_at: string | null }[],
): LeadTime {
  const entregaPorPedido = new Map<string, string>()
  shipments.forEach((s) => { if (s.delivered_at) entregaPorPedido.set(s.order_id, s.delivered_at) })
  const dias: number[] = []
  orders.forEach((o) => {
    const fin = entregaPorPedido.get(o.id)
    if (!fin || !o.created_at) return
    const d = duracionDias(o.created_at, fin)
    if (Number.isFinite(d) && d >= 0) dias.push(d)
  })
  if (dias.length === 0) return { entregados: 0, promedioDias: null, peorDias: null }
  const suma = dias.reduce((s, d) => s + d, 0)
  return {
    entregados: dias.length,
    promedioDias: Math.round((suma / dias.length) * 10) / 10,
    peorDias: Math.round(Math.max(...dias) * 10) / 10,
  }
}

// ── VALOR EN RIESGO por caducidad ─────────────────────────────────────────────
// No basta con "7 lotes por vencer": Dirección necesita saber CUÁNTO DINERO está
// en riesgo. Se valúa a COSTO (lo que se perdería), no a precio de venta.
// Un lote sin costo registrado NO vale cero: se cuenta aparte, y el valor que se
// muestra es un MÍNIMO mientras haya alguno.
export interface ValorEnRiesgo {
  valor: number            // Σ cantidad × costo de los lotes con costo conocido
  lotesSinCosto: number
  unidadesSinCosto: number
  completo: boolean        // false ⇒ `valor` es un mínimo, no el total
}
export function valorEnRiesgo(lots: { quantity: number; unit_cost?: number | null }[]): ValorEnRiesgo {
  const r: ValorEnRiesgo = { valor: 0, lotesSinCosto: 0, unidadesSinCosto: 0, completo: true }
  lots.forEach((l) => {
    if (l.unit_cost == null) { r.lotesSinCosto += 1; r.unidadesSinCosto += l.quantity; return }
    r.valor += l.quantity * l.unit_cost
  })
  r.completo = r.lotesSinCosto === 0
  return r
}
