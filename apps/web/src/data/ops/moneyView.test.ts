import { describe, it, expect } from 'vitest'
import { etiquetaPago, etiquetaLiberacion, esPorCobrar, reembolsoPendiente, diasVencido } from './moneyView'
import type { OrderMoney } from './money'

const base: OrderMoney = {
  order_id: 'o1', external_ref: 'S-1', order_status: 'pending_payment', payment_status: 'pending',
  total: 1000, cobrado: 0, reembolsado: 0, cobrado_neto: 0, saldo: 1000, estado_pago: 'pending',
  sobrepago: false, reembolso_pendiente: 0, credito_autorizado: false, due_date: null, vencido: false, liberado: false,
}
const con = (p: Partial<OrderMoney>): OrderMoney => ({ ...base, ...p })

describe('etiquetaPago — proyección financiera', () => {
  it('sin cobro ⇒ "Sin pago"', () => {
    expect(etiquetaPago(base)).toMatchObject({ texto: 'Sin pago', tono: 'bad' })
  })
  it('cobro suficiente ⇒ "Pagado"', () => {
    expect(etiquetaPago(con({ estado_pago: 'paid', cobrado: 1000, cobrado_neto: 1000, saldo: 0 }))).toMatchObject({ texto: 'Pagado', tono: 'ok' })
  })
  it('cobro incompleto ⇒ parcial con el faltante', () => {
    const e = etiquetaPago(con({ estado_pago: 'parcial', cobrado: 400, cobrado_neto: 400, saldo: 600 }))
    expect(e.texto).toBe('Pago parcial')
    expect(e.detalle).toContain('600')
  })
  it('sobrepago se avisa (no se esconde)', () => {
    expect(etiquetaPago(con({ estado_pago: 'paid', cobrado_neto: 1200, saldo: -200, sobrepago: true })).texto).toBe('Sobrepago')
  })
  it('reembolsado íntegro ⇒ "Reembolsado"', () => {
    expect(etiquetaPago(con({ estado_pago: 'refunded', cobrado: 1000, reembolsado: 1000, cobrado_neto: 0, saldo: 1000 })).texto).toBe('Reembolsado')
  })
})

describe('etiquetaLiberacion — crédito NO es pago (objetivo 4)', () => {
  const credito = con({ credito_autorizado: true, due_date: '2026-10-30', liberado: true })
  it('crédito autorizado libera para surtir', () => {
    expect(etiquetaLiberacion(credito).texto).toBe('Crédito autorizado')
  })
  it('crédito autorizado NUNCA se muestra como pagado', () => {
    const e = etiquetaLiberacion(credito)
    expect(e.texto.toLowerCase()).not.toContain('pagad')
    expect(etiquetaPago(credito).texto).toBe('Sin pago')
  })
  it('la etiqueta de crédito muestra lo que se sigue debiendo', () => {
    expect(etiquetaLiberacion(credito).detalle).toContain('1000')
  })
  it('crédito vencido se marca en rojo', () => {
    expect(etiquetaLiberacion({ ...credito, vencido: true })).toMatchObject({ texto: 'Crédito VENCIDO', tono: 'bad' })
  })
  it('pagado sin crédito ⇒ liberado por cobro', () => {
    expect(etiquetaLiberacion(con({ estado_pago: 'paid', saldo: 0, liberado: true })).texto).toBe('Liberado por cobro')
  })
  it('sin cobro ni crédito ⇒ no liberado, con qué hacer', () => {
    const e = etiquetaLiberacion(base)
    expect(e.texto).toBe('No liberado')
    expect(e.detalle).toMatch(/cobro|crédito/i)
  })
})

describe('cobranza', () => {
  it('saldo pendiente entra a por cobrar; cancelado no', () => {
    expect(esPorCobrar(base)).toBe(true)
    expect(esPorCobrar(con({ order_status: 'cancelled' }))).toBe(false)
    expect(esPorCobrar(con({ saldo: 0 }))).toBe(false)
  })
  it('reembolso autorizado sin pagar se detecta', () => {
    expect(reembolsoPendiente(base)).toBe(false)
    expect(reembolsoPendiente(con({ reembolso_pendiente: 250 }))).toBe(true)
  })
  it('los días vencidos se cuentan desde el vencimiento del crédito', () => {
    expect(diasVencido(con({ credito_autorizado: true, due_date: '2026-09-20' }), '2026-09-29')).toBe(9)
    expect(diasVencido(con({ credito_autorizado: true, due_date: '2026-10-30' }), '2026-09-29')).toBe(0)
    expect(diasVencido(base, '2026-09-29')).toBe(0)
  })
})
