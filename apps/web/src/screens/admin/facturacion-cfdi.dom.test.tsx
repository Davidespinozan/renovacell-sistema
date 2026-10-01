// @vitest-environment jsdom
// P0-CFDI (aceptación) · W3-A — la pantalla ya no ofrece "Emitir CFDI", porque el cliente no
// timbra: ofrece "Solicitar factura", que registra la intención durable en el servidor.
// Un pedido ya timbrado muestra el estado emitido (deshabilitado) y sin acción.
//
// Lo que se protege aquí es que la UI no vuelva a prometer una emisión que no controla.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BillDetail } from './Facturacion'
import { mkOrder, mkItem } from '../../test/factories'

// Sin backend el estado fiscal es 'sin_solicitud'; se evita cualquier llamada real.
vi.mock('../../data/ops/fiscalIntent', async (orig) => {
  const real = await orig<typeof import('../../data/ops/fiscalIntent')>()
  return { ...real, estadoFiscalPedido: vi.fn(async () => real.SIN_SOLICITUD) }
})

beforeEach(cleanup)

const productsById = { p1: { id: 'p1', name: 'Golden Serum' } as never }
const props = { productsById, clientName: 'Dra. Uno', onClose: () => {} }

describe('<BillDetail> · acción fiscal', () => {
  it('CFDI ya TIMBRADO → no hay acción de emitir ni de solicitar (se muestra emitido, deshabilitado)', () => {
    const order = mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: { status: 'timbrada', uuid: 'SAT-UUID-9' } })
    render(<BillDetail order={order} {...props} />)
    expect(screen.queryByText('Emitir CFDI')).toBeNull()
    expect(screen.queryByText('Solicitar factura')).toBeNull()
    const emitido = screen.getByText('CFDI emitido').closest('button') as HTMLButtonElement
    expect(emitido).toBeDisabled()
  })

  it('pedido pagado SIN CFDI y CON datos fiscales completos → ofrece "Solicitar factura"', () => {
    const receiver = { rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', email_facturacion: 'dra@x.mx' }
    const order = mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: { receiver } as never })
    render(<BillDetail order={order} {...props} />)
    expect(screen.getByText('Solicitar factura')).toBeInTheDocument()
    // Y NUNCA promete un timbrado: la palabra "Emitir" desaparece de la acción.
    expect(screen.queryByText('Emitir CFDI')).toBeNull()
  })

  it('pedido pagado SIN datos fiscales → NO ofrece nada; pide completar datos', () => {
    const order = mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: null })
    render(<BillDetail order={order} {...props} />)
    expect(screen.queryByText('Emitir CFDI')).toBeNull()
    expect(screen.queryByText('Solicitar factura')).toBeNull()
    expect(screen.getByText(/Completa los datos fiscales del pedido/)).toBeInTheDocument()
  })

  it('pedido SIN pagar → no se ofrece factura (el gate de pago sigue visible al operador)', () => {
    const receiver = { rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', email_facturacion: 'dra@x.mx' }
    const order = mkOrder({ payment_status: 'pending', invoice_requested: true, items: [mkItem()], invoice_meta: { receiver } as never })
    render(<BillDetail order={order} {...props} />)
    expect(screen.queryByText('Solicitar factura')).toBeNull()
    expect(screen.getByText(/debe estar pagado antes de facturarse/)).toBeInTheDocument()
  })
})
