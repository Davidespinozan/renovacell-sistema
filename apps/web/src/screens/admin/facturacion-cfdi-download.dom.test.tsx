// @vitest-environment jsdom
// Descarga CFDI (gating de UI) — los botones "Descargar XML/PDF" aparecen SOLO para un CFDI
// timbrado real (status 'timbrada' + facturama_id, no simulado). Nunca para folios simulados,
// 'emitida' sin timbre, sin facturama_id o invoice_meta null.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BillDetail } from './Facturacion'
import { mkOrder, mkItem } from '../../test/factories'

beforeEach(cleanup)

const productsById = { p1: { id: 'p1', name: 'Golden Serum' } as never }
const props = { productsById, clientName: 'Dra. Uno', onClose: () => {} }
const render1 = (invoice_meta: unknown) =>
  render(<BillDetail order={mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: invoice_meta as never })} {...props} />)

describe('<BillDetail> · descarga XML/PDF', () => {
  it('CFDI TIMBRADO real (con facturama_id) → ofrece "Descargar XML" y "Descargar PDF"', () => {
    render1({ status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false })
    expect(screen.getByText('Descargar XML')).toBeInTheDocument()
    expect(screen.getByText('Descargar PDF')).toBeInTheDocument()
  })

  it('folio SIMULADO (emitida, simulated:true) → NO ofrece descarga', () => {
    render1({ status: 'emitida', uuid: 'SIM-1', simulated: true })
    expect(screen.queryByText('Descargar XML')).toBeNull()
    expect(screen.queryByText('Descargar PDF')).toBeNull()
  })

  it('timbrada SIN facturama_id → NO ofrece descarga', () => {
    render1({ status: 'timbrada', uuid: 'SAT-9' })
    expect(screen.queryByText('Descargar XML')).toBeNull()
    expect(screen.queryByText('Descargar PDF')).toBeNull()
  })

  it('invoice_meta null → NO ofrece descarga', () => {
    render1(null)
    expect(screen.queryByText('Descargar XML')).toBeNull()
    expect(screen.queryByText('Descargar PDF')).toBeNull()
  })
})
