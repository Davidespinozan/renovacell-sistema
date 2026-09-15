// @vitest-environment jsdom
// P0-CFDI #1 (aceptación) — un pedido con CFDI timbrado NO ofrece la acción "Emitir CFDI";
// muestra el estado emitido (deshabilitado). Un pedido sin CFDI sí ofrece "Emitir CFDI".
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BillDetail } from './Facturacion'
import { mkOrder, mkItem } from '../../test/factories'

beforeEach(cleanup)

const productsById = { p1: { id: 'p1', name: 'Golden Serum' } as never }
const props = { productsById, clientName: 'Dra. Uno', onClose: () => {} }

describe('<BillDetail> · acción Emitir CFDI', () => {
  it('CFDI ya TIMBRADO → no hay acción "Emitir CFDI" (se muestra emitido, deshabilitado)', () => {
    const order = mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: { status: 'timbrada', uuid: 'SAT-UUID-9' } })
    render(<BillDetail order={order} {...props} />)
    expect(screen.queryByText('Emitir CFDI')).toBeNull()
    const emitido = screen.getByText('CFDI emitido').closest('button') as HTMLButtonElement
    expect(emitido).toBeDisabled()
  })

  it('pedido SIN CFDI → sí ofrece la acción "Emitir CFDI"', () => {
    const order = mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: null })
    render(<BillDetail order={order} {...props} />)
    expect(screen.getByText('Emitir CFDI')).toBeInTheDocument()
  })
})
