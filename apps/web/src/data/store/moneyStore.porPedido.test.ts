// PERF · tras un comando sobre UN pedido se releen solo sus filas (no las tres lecturas completas) y se fusionan
// con lo que ya estaba en pantalla; si la lectura falla, se cae a la recarga completa.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  tablas: {} as Record<string, Array<Record<string, unknown>>>,
  consultas: [] as Array<{ tabla: string; filtro: string | null; paginada: boolean }>,
  fallar: false,
}))
vi.mock('../../lib/supabase', () => {
  const from = (tabla: string) => {
    const q = { tabla, filtro: null as string | null, paginada: false }
    h.consultas.push(q)
    const datos = () => (q.filtro ? h.tablas[tabla].filter((r) => r.order_id === q.filtro) : h.tablas[tabla])
    const res = () => (h.fallar && q.filtro ? { data: null, error: { message: 'x' } } : { data: datos(), error: null })
    const b: Record<string, unknown> = {
      select: () => b, order: () => b,
      eq: (_c: string, v: string) => { q.filtro = v; return b },
      range: () => { q.paginada = true; return Promise.resolve(res()) },
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko),
    }
    return b
  }
  return { hasSupabase: true, supabase: { from, auth: { onAuthStateChange: () => {} } } }
})
import { reloadMoney, reloadMoneyDe, getMoneySnapshot, getClaimsSnapshot, getEntriesSnapshot, pedidoDeDeclaracion } from './moneyStore'

beforeEach(async () => {
  h.fallar = false
  h.tablas = {
    v_order_money: [{ order_id: 'A', saldo: 100 }, { order_id: 'B', saldo: 50 }],
    payment_claims: [{ id: 'c1', order_id: 'A', declared_at: '2026-10-01', status: 'reportado' }, { id: 'c2', order_id: 'B', declared_at: '2026-10-02', status: 'reportado' }],
    payment_entries: [{ id: 'e1', order_id: 'B', created_at: '2026-10-02' }],
  }
  await reloadMoney()
  h.consultas.length = 0
})

describe('reloadMoneyDe', () => {
  it('relee solo el pedido indicado, sin paginar, y conserva los demás', async () => {
    h.tablas.v_order_money[0] = { order_id: 'A', saldo: 0 }
    h.tablas.payment_claims[0] = { ...h.tablas.payment_claims[0], status: 'verificado' }
    h.tablas.payment_entries.push({ id: 'e2', order_id: 'A', created_at: '2026-10-03' })
    await reloadMoneyDe('A')
    expect(h.consultas.map((q) => [q.tabla, q.filtro, q.paginada])).toEqual([
      ['v_order_money', 'A', false], ['payment_claims', 'A', false], ['payment_entries', 'A', false]])
    expect(getMoneySnapshot()).toEqual([{ order_id: 'A', saldo: 0 }, { order_id: 'B', saldo: 50 }])
    expect(getClaimsSnapshot().map((c) => [c.id, c.status])).toEqual([['c2', 'reportado'], ['c1', 'verificado']])
    expect(getEntriesSnapshot().map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(pedidoDeDeclaracion('c2')).toBe('B')
  })

  it('si la lectura del pedido falla, recarga todo', async () => {
    h.fallar = true
    await reloadMoneyDe('A')
    expect(h.consultas.filter((q) => q.paginada).map((q) => q.tabla).sort()).toEqual(['payment_claims', 'payment_entries', 'v_order_money'])
  })
})
