// REF-OPCIONAL (26 nov 2026, dueño): referencia opcional y repetible; Dirección ve «Ref. repetida». Tarjeta sigue única.
import { describe, it, expect } from 'vitest'
import { referenciasRepetidas, type PaymentEntry } from './money'
import mig from '../../../../../supabase/migrations/20270407950000_referencia_opcional.sql?raw'

const e = (id: string, order_id: string, external_ref: string | null, method = 'transferencia', extra: Partial<PaymentEntry> = {}) =>
  ({ id, order_id, external_ref, method, direction: 'in', reversal_of: null, amount: 100, claim_id: null, refund_id: null, value_date: '2026-11-26', bank_account_id: null, notes: null, actor_role: 'admin', created_at: '2026-11-26', ...extra }) as PaymentEntry

describe('referencias repetidas', () => {
  it('marca los pedidos que comparten referencia (sin importar mayúsculas) y dice cuáles', () => {
    const r = referenciasRepetidas([e('1', 'A', 'SCOTIABANK RENATO'), e('2', 'B', 'scotiabank renato'), e('3', 'C', '999888777')])
    expect(r.A).toEqual([{ referencia: 'SCOTIABANK RENATO', otros: ['B'] }])
    expect(r.B?.[0].otros).toEqual(['A'])
    expect(r.C).toBeUndefined()
  })
  it('tarjeta, salidas y reversos no cuentan; dos abonos del mismo pedido tampoco', () => {
    const r = referenciasRepetidas([e('1', 'A', 'X1', 'tarjeta'), e('2', 'B', 'X1', 'tarjeta'), e('3', 'C', 'R', 'transferencia', { direction: 'out' }), e('4', 'D', 'R'), e('5', 'E', 'Z'), e('6', 'E', 'Z')])
    expect(r).toEqual({})
  })
  it('el servidor: transferencia sin obligación; índice único solo para tarjeta/Stripe', () => {
    expect(mig).not.toMatch(/raise exception 'REFERENCIA_REQUERIDA/)
    expect(mig).toMatch(/create unique index uq_entry_external_ref on public\.payment_entries \(external_ref\) where external_ref is not null and method in \('tarjeta', 'stripe'\)/)
    expect(mig).toMatch(/if p_method in \('tarjeta', 'stripe'\) and not v_srv then\s+perform public\._w2_referencia_libre/)
  })
})
