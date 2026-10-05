// KPIs DE CABECERA — definición única de ventas, cobrado, por cobrar y utilidad.
//
// La AUTORIDAD es el servidor: `kpi_ventas`, `kpi_por_cobrar` y `kpi_resultado`
// (supabase/migrations/20261022120000_w5_kpis.sql). Con backend, las pantallas
// muestran lo que esas funciones responden (hooks/useKpis.ts).
//
// Este módulo es el ESPEJO de esas tres funciones, regla por regla y con las mismas
// llaves: sirve a la demo sin backend y a las pruebas. No es una segunda definición:
// `kpis.paridad.test.ts` le pasa el mismo escenario que la base ejecuta en
// supabase/tests/db/tests/w5_01_kpis.sql y exige los MISMOS números.
import type { OrderWithItems } from './hooks/useOrders'
import type { InventoryMovement } from './types'
import type { OrderMoney, PaymentEntry } from './ops/money'
import { isSale, isPosOrder } from './metrics'
import { enPeriodo, type Periodo } from './periodo'

type Rango = Pick<Periodo, 'desde' | 'hasta'>
export type MoneyIndex = Record<string, OrderMoney | undefined>

/** Ventas y cobranza de un periodo. Mismas llaves que `kpi_ventas`. */
export interface KpiVentas {
  ventas: number            // Σ total de los pedidos-venta levantados en el periodo
  pedidos: number
  ticket: number            // ventas ÷ pedidos
  cobrado_entradas: number  // dinero que ENTRÓ en el periodo (fecha contable del libro)
  cobrado_salidas: number   // dinero que SALIÓ en el periodo (reembolsos y reversas)
  cobrado_neto: number      // entradas − salidas
  saldo_ventas: number      // de lo vendido en el periodo, lo que aún falta cobrar
}

/** Por cobrar: posición a hoy. Mismas llaves que `kpi_por_cobrar`. */
export interface KpiPorCobrar {
  total: number
  pedidos: number
  a_credito: number
  vencido: number
}

/** Resultado del periodo. Mismas llaves que `kpi_resultado`. Solo Dirección. */
export interface KpiResultado {
  ventas: number
  devoluciones: number
  ventas_netas: number
  unidades_vendidas: number
  unidades_sin_costo: number     // salieron del almacén sin costo registrado
  unidades_sin_surtir: number    // vendidas que aún no salen: su costo no existe todavía
  cobertura_pct: number          // % de unidades vendidas con costo conocido (nunca 100 si falta algo)
  costo_confiable: boolean       // todas las unidades vendidas tienen costo conocido
  costo_ventas_conocido: number  // lo que SÍ se conoce (un costo desconocido no suma cero)
  costo_ventas: number | null    // null si el costo no es confiable
  utilidad_bruta: number | null  // null si el costo no es confiable
  margen_bruto_pct: number | null
  gastos: number
  mermas_conocidas: number
  merma_unidades_sin_costo: number
  utilidad_neta_confiable: boolean
  utilidad_neta: number | null   // null si falta costo de ventas o de alguna merma
  margen_neto_pct: number | null
}

/** Devolución autorizada sobre un pedido (renglón mínimo de `refunds`). */
export interface RefundLine { order_id: string; monto: number; metodo?: string | null }
/** Gasto del negocio; `fecha` ya es un día del negocio. */
export interface GastoLinea { fecha: string; monto: number }
type Asiento = Pick<PaymentEntry, 'direction' | 'amount' | 'value_date'>
type Movimiento = Pick<InventoryMovement, 'change' | 'reason' | 'reference' | 'created_at' | 'unit_cost'> & { order_id?: string | null }

// Mismo redondeo que `round()` de Postgres sobre numeric (mitad lejos de cero).
const redondear = (x: number, d: number): number => {
  const f = 10 ** d
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f
}

/** Pedidos que cuentan como venta en el periodo (espejo de `_kpi_ventas`). */
export function ventasDelPeriodo(orders: OrderWithItems[], p: Rango): OrderWithItems[] {
  return orders.filter((o) => isSale(o) && enPeriodo(o.created_at, p))
}

// Saldo de un pedido: el del libro. Solo en la demo sin backend (no hay libro) se
// deriva del pedido, que es lo único observable ahí.
const saldoDe = (o: OrderWithItems, money: MoneyIndex): number => {
  const m = money[o.id]
  return m ? m.saldo : (o.payment_status === 'paid' ? 0 : (o.total ?? 0))
}

export function calcularVentas(
  d: { orders: OrderWithItems[]; entries: Asiento[]; money: MoneyIndex },
  p: Rango,
): KpiVentas {
  const sales = ventasDelPeriodo(d.orders, p)
  const ventas = sales.reduce((s, o) => s + (o.total ?? 0), 0)
  const pedidos = sales.length
  let entradas = 0, salidas = 0
  d.entries.forEach((e) => {
    if (!enPeriodo(e.value_date, p)) return
    if (e.direction === 'in') entradas += e.amount
    else salidas += e.amount
  })
  return {
    ventas, pedidos,
    ticket: pedidos > 0 ? redondear(ventas / pedidos, 2) : 0,
    cobrado_entradas: entradas,
    cobrado_salidas: salidas,
    cobrado_neto: entradas - salidas,
    saldo_ventas: sales.reduce((s, o) => s + Math.max(saldoDe(o, d.money), 0), 0),
  }
}

export function calcularPorCobrar(orders: OrderWithItems[], money: MoneyIndex): KpiPorCobrar {
  const r: KpiPorCobrar = { total: 0, pedidos: 0, a_credito: 0, vencido: 0 }
  orders.forEach((o) => {
    if (o.status === 'cancelled' || o.status === 'draft' || isPosOrder(o)) return
    const saldo = saldoDe(o, money)
    if (saldo <= 0.0001) return
    const m = money[o.id]
    r.total += saldo
    r.pedidos += 1
    if (m?.credito_autorizado) { r.a_credito += saldo; if (m.vencido) r.vencido += saldo }
  })
  return r
}

const SALIDA = new Set(['surtido', 'venta'])
const REGRESO = new Set(['cancelacion', 'devolucion'])

export function calcularResultado(
  d: { orders: OrderWithItems[]; refunds: RefundLine[]; movements: Movimiento[]; gastos: GastoLinea[] },
  p: Rango,
): KpiResultado {
  const sales = ventasDelPeriodo(d.orders, p)
  const ids = new Set(sales.map((o) => o.id))
  // El kardex del servidor liga cada movimiento a su pedido por id; la demo, por folio.
  const porFolio = new Map(sales.map((o) => [o.external_ref ?? o.id, o.id]))
  const pedidoDe = (m: Movimiento): string | null =>
    m.order_id ? (ids.has(m.order_id) ? m.order_id : null) : (m.reference ? porFolio.get(m.reference) ?? null : null)

  const ventas = sales.reduce((s, o) => s + (o.total ?? 0), 0)
  const devoluciones = d.refunds.filter((r) => ids.has(r.order_id)).reduce((s, r) => s + (r.monto ?? 0), 0)
  const ventas_netas = ventas - devoluciones

  const salidas = new Map<string, number>()
  let sinCosto = 0, costo = 0, mermas = 0, mermaSin = 0
  d.movements.forEach((m) => {
    const reason = m.reason ?? ''
    if (reason === 'merma' && m.change < 0) {
      if (!enPeriodo(m.created_at, p)) return
      if (m.unit_cost == null) mermaSin += -m.change
      else mermas += -m.change * m.unit_cost
      return
    }
    const sale = SALIDA.has(reason) && m.change < 0
    const vuelve = REGRESO.has(reason) && m.change > 0
    if (!sale && !vuelve) return
    const oid = pedidoDe(m)
    if (!oid) return
    if (sale) salidas.set(oid, (salidas.get(oid) ?? 0) - m.change)
    if (m.unit_cost == null) sinCosto += Math.abs(m.change) // desconocido: NO se cuenta como 0
    else costo += -m.change * m.unit_cost                   // salida suma, regreso resta
  })

  let vendidas = 0, sinSurtir = 0
  sales.forEach((o) => {
    const q = o.items.reduce((s, it) => s + (it.product_id ? it.qty : 0), 0)
    vendidas += q
    sinSurtir += Math.max(q - (salidas.get(o.id) ?? 0), 0)
  })

  const gastos = d.gastos.filter((g) => enPeriodo(g.fecha, p)).reduce((s, g) => s + g.monto, 0)
  const ok = sinCosto === 0 && sinSurtir === 0
  const okNeta = ok && mermaSin === 0
  const bruta = ok ? ventas_netas - costo : null
  const neta = okNeta ? ventas_netas - costo - gastos - mermas : null
  let cobertura = vendidas <= 0 ? 100 : Math.floor((100 * Math.max(vendidas - sinSurtir - sinCosto, 0)) / vendidas)
  if (!ok) cobertura = Math.min(cobertura, 99)

  return {
    ventas, devoluciones, ventas_netas,
    unidades_vendidas: vendidas,
    unidades_sin_costo: sinCosto,
    unidades_sin_surtir: sinSurtir,
    cobertura_pct: cobertura,
    costo_confiable: ok,
    costo_ventas_conocido: costo,
    costo_ventas: ok ? costo : null,
    utilidad_bruta: bruta,
    margen_bruto_pct: bruta != null && ventas_netas > 0 ? redondear((100 * bruta) / ventas_netas, 1) : null,
    gastos,
    mermas_conocidas: mermas,
    merma_unidades_sin_costo: mermaSin,
    utilidad_neta_confiable: okNeta,
    utilidad_neta: neta,
    margen_neto_pct: neta != null && ventas_netas > 0 ? redondear((100 * neta) / ventas_netas, 1) : null,
  }
}

/** Avance de cobro de las ventas del periodo: de lo vendido, qué parte ya no se debe. */
export function avanceDeCobro(k: Pick<KpiVentas, 'ventas' | 'saldo_ventas'>): number | null {
  if (k.ventas <= 0) return null
  return Math.max(0, Math.min(100, (100 * (k.ventas - k.saldo_ventas)) / k.ventas))
}
