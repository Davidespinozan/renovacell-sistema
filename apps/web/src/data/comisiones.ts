// COMISIONES — ESTIMACIÓN. No es una liquidación ni una cantidad "a pagar".
//
// El modelo de comisiones (sobre qué base se pagan, con qué tasas, cuándo se
// devengan, cómo se revierten ante una devolución) es una decisión de Dirección que
// sigue abierta (D-15). Hasta que se tome, este módulo se limita a ESTIMAR y, a
// propósito, NO hace nada de lo siguiente:
//   · no congela ni reconstruye tasas históricas: usa la tasa vigente hoy y lo dice;
//   · no inventa un vendedor histórico: usa el vendedor que el pedido trae registrado;
//   · no infiere reglas de reversa: una devolución no descuenta la estimación;
//   · no genera ninguna obligación económica ni escribe un solo movimiento de dinero.
// Solo lee. Muestra por separado lo VENDIDO y lo COBRADO para que la diferencia entre
// las dos bases se vea, sin elegir una.
import type { OrderWithItems } from './hooks/useOrders'
import { isSale } from './metrics'
import { enPeriodo, type Periodo } from './periodo'

export type LineaProducto = 'cosm' | 'prof'
export interface Vendedor { id?: string; email: string; name: string }
export interface AsientoComision { order_id: string; direction: 'in' | 'out'; amount: number; value_date: string }

export interface EstimacionVendedor {
  email: string
  nombre: string
  pedidos: number            // pedidos-venta del periodo atribuidos
  vendido: number            // importe de los renglones de esos pedidos
  cobrado: number            // dinero que entró EN el periodo (neto) de pedidos atribuidos, sea cual sea su fecha
  comisionEstimada: number   // vendido × tasa VIGENTE de cada línea. Estimación.
}
export interface EstimacionComisiones {
  filas: EstimacionVendedor[]
  sinVendedor: { pedidos: number; vendido: number }
  totales: { vendido: number; cobrado: number; comisionEstimada: number }
}

/**
 * CX-0c · Vendedor comercial que el pedido trae CONGELADO (lo decide el servidor al crearlo: cartera; en POS sin
 * asignación, el cajero; si no es resoluble, ninguno). Precedencia:
 *   1. `shipping_meta.seller_profile_id` (identidad canónica) → el vendedor con ese id;
 *   2. `shipping_meta.seller` (correo) — compatibilidad con pedidos anteriores a CX-0c o vendedor fuera de la lista;
 *   3. sin vendedor.
 * `placed_by` es el CAPTURISTA y nunca atribuye comisión (D2).
 */
export function vendedorDe(o: OrderWithItems, vendedores: Vendedor[]): string | null {
  const meta = (o.shipping_meta ?? {}) as { seller?: string | null; seller_profile_id?: string | null }
  if (meta.seller_profile_id) {
    const v = vendedores.find((s) => s.id && s.id === meta.seller_profile_id)
    if (v) return v.email
  }
  return meta.seller || null
}

export function estimarComisiones(d: {
  orders: OrderWithItems[]
  entries: AsientoComision[]
  vendedores: Vendedor[]
  lineaDe: (productId: string | null) => LineaProducto
  tasaVigente: Record<LineaProducto, number>
}, p: Pick<Periodo, 'desde' | 'hasta'>): EstimacionComisiones {
  const acc = new Map<string, EstimacionVendedor>()
  const fila = (email: string): EstimacionVendedor => {
    let f = acc.get(email)
    if (!f) {
      f = { email, nombre: d.vendedores.find((s) => s.email === email)?.name ?? email, pedidos: 0, vendido: 0, cobrado: 0, comisionEstimada: 0 }
      acc.set(email, f)
    }
    return f
  }
  d.vendedores.forEach((s) => fila(s.email))
  const sinVendedor = { pedidos: 0, vendido: 0 }

  // VENDIDO: pedidos-venta levantados en el periodo (día del negocio).
  d.orders.forEach((o) => {
    if (!isSale(o) || !enPeriodo(o.created_at, p)) return
    const email = vendedorDe(o, d.vendedores)
    const f = email ? fila(email) : null
    if (f) f.pedidos += 1; else sinVendedor.pedidos += 1
    o.items.forEach((it) => {
      if (it.unit_price == null) return
      const importe = it.unit_price * it.qty
      if (!f) { sinVendedor.vendido += importe; return }
      f.vendido += importe
      f.comisionEstimada += importe * d.tasaVigente[d.lineaDe(it.product_id ?? null)]
    })
  })

  // COBRADO: asientos del libro fechados en el periodo, de pedidos atribuidos a cada
  // vendedor (un pedido de un periodo anterior cobrado ahora cuenta aquí).
  const vendedorPorPedido = new Map<string, string>()
  d.orders.forEach((o) => {
    if (o.status === 'cancelled' || o.status === 'draft') return
    const email = vendedorDe(o, d.vendedores)
    if (email) vendedorPorPedido.set(o.id, email)
  })
  d.entries.forEach((e) => {
    if (!enPeriodo(e.value_date, p)) return
    const email = vendedorPorPedido.get(e.order_id)
    if (!email) return
    fila(email).cobrado += e.direction === 'in' ? e.amount : -e.amount
  })

  const filas = [...acc.values()].sort((a, b) => b.vendido - a.vendido)
  return {
    filas, sinVendedor,
    totales: filas.reduce((t, f) => ({ vendido: t.vendido + f.vendido, cobrado: t.cobrado + f.cobrado, comisionEstimada: t.comisionEstimada + f.comisionEstimada }),
      { vendido: 0, cobrado: 0, comisionEstimada: 0 }),
  }
}
