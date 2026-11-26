// SOBRE PEDIDO (26 nov 2026, dueño): vender sin existencia solo productos marcados; espera mercancía; no se factura.
import { describe, it, expect } from 'vitest'
import { etapaSeguimiento } from './seguimientoVenta'
import mig from '../../../../../supabase/migrations/20270408000000_venta_sobre_pedido.sql?raw'

describe('venta sobre pedido', () => {
  it('el pedido con piezas sin existencia «espera mercancía» hasta surtirse', () => {
    const sm = { sobre_pedido: [{ product_id: 'p', faltan: 3 }] }
    expect(etapaSeguimiento({ status: 'paid', shipping_meta: sm, seguimiento: {} }).etapa).toBe('esperando_mercancia')
    expect(etapaSeguimiento({ status: 'pending_payment', payment_method: 'por_cobrar', shipping_meta: sm, seguimiento: {} }).etapa).toBe('esperando_mercancia')
    expect(etapaSeguimiento({ status: 'packed', shipping_meta: sm, seguimiento: { empacado_at: '2026-11-27T18:00:00Z' } }).etapa).toBe('empacado')
  })
  it('servidor: marca al crear, bloquea la factura y avisa al llegar la mercancía', () => {
    expect(mig).toMatch(/perform public\._sobre_pedido_marcar\(p_order_id\);/)
    expect(mig).toMatch(/if public\._pedido_esperando_mercancia\(d\.order_id\) then v_falta := v_falta \|\| 'Pedido sobre pedido: se factura cuando llegue la mercancía y se surta\.'/)
    expect(mig).toMatch(/create trigger trg_lots_sobre_pedido_llego after insert on public\.lots/)
    expect(mig).toMatch(/revoke all on function public\._sobre_pedido_marcar\(uuid\) from public, anon, authenticated/)
  })
})
