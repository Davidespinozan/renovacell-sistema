// W2 · Store del dinero. Mantiene VIVAS las tres lecturas que las pantallas necesitan:
//   · v_order_money   — el dinero de cada pedido (definición única del servidor)
//   · payment_claims  — los comprobantes declarados (cola "Pagos por validar")
//   · payment_entries — el libro (ficha de pedido y conciliación)
// Ninguna pantalla calcula dinero: lee de aquí. Toda mutación pasa por ops/money.ts
// y después llama a `reloadMoney()` (write-through, sin éxito optimista).
import { supabase, hasSupabase } from '../../lib/supabase'
import { makeLive } from './live'
import { CLAIM_COLS, ENTRY_COLS, MONEY_COLS, type OrderMoney, type PaymentClaim, type PaymentEntry } from '../ops/money'
import { leerTodo } from './lectura'

const moneyLive = makeLive<OrderMoney>(async () => {
  const { data, error } = await leerTodo('el estado de cobro de los pedidos', (a, b) => supabase.from('v_order_money').select(MONEY_COLS).order('order_id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as OrderMoney[]
}, [])

const claimsLive = makeLive<PaymentClaim>(async () => {
  const { data, error } = await leerTodo('los pagos declarados', (a, b) => supabase.from('payment_claims').select(CLAIM_COLS).order('declared_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as PaymentClaim[]
}, [])

const entriesLive = makeLive<PaymentEntry>(async () => {
  const { data, error } = await leerTodo('los cobros', (a, b) => supabase.from('payment_entries').select(ENTRY_COLS).order('created_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []) as unknown as PaymentEntry[]
}, [])

export const subscribeMoney = moneyLive.subscribe
export const getMoneySnapshot = moneyLive.getSnapshot
export const moneyReady = moneyLive.ready

export const subscribeClaims = claimsLive.subscribe
export const getClaimsSnapshot = claimsLive.getSnapshot
export const claimsReady = claimsLive.ready

export const subscribeEntries = entriesLive.subscribe
export const getEntriesSnapshot = entriesLive.getSnapshot
export const entriesReady = entriesLive.ready

// Tras CUALQUIER comando de dinero: el servidor es la autoridad, se vuelve a leer.
export async function reloadMoney(): Promise<void> {
  if (!hasSupabase) return
  await Promise.all([moneyLive.reload(), claimsLive.reload(), entriesLive.reload()])
}

// --- MODO DEMO (sin backend) --------------------------------------------------
// En demo no hay tablas: el crédito autorizado vive aquí para que el flujo se pueda
// mostrar. En producción esto NUNCA se usa (la autoridad es `credit_grants`).
let creditosDemo: Record<string, { due_date: string } | undefined> = {}
const demoListeners = new Set<() => void>()
export const subscribeDemoCredits = (cb: () => void) => { demoListeners.add(cb); return () => { demoListeners.delete(cb) } }
export const getDemoCredits = () => creditosDemo
export function setDemoCredit(orderId: string, grant: { due_date: string } | null): void {
  creditosDemo = { ...creditosDemo, [orderId]: grant ?? undefined }
  demoListeners.forEach((l) => l())
}

// Índice por pedido para las pantallas (O(1) en render).
export function moneyIndex(list: OrderMoney[]): Record<string, OrderMoney> {
  return Object.fromEntries(list.map((m) => [m.order_id, m]))
}

// Comprobante ABIERTO de un pedido (a lo más uno: uq_claim_abierta lo garantiza).
export function claimAbierto(claims: PaymentClaim[], orderId: string): PaymentClaim | null {
  return claims.find((c) => c.order_id === orderId && c.status === 'reportado') ?? null
}

// Último comprobante rechazado (para decirle al cliente por qué no se le aceptó).
export function ultimoRechazo(claims: PaymentClaim[], orderId: string): PaymentClaim | null {
  return claims.find((c) => c.order_id === orderId && c.status === 'rechazado') ?? null
}
