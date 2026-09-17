// @vitest-environment jsdom
// Cancelación CFDI (UI) — botón/modal 02/03, badges por estado, y gates de envío/descarga.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ cancelCfdi: vi.fn(), refreshCancelStatus: vi.fn() }))
vi.mock('../../data/ops/cfdiCancel', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, cancelCfdi: h.cancelCfdi, refreshCancelStatus: h.refreshCancelStatus }
})

import { BillDetail } from './Facturacion'
import { mkOrder, mkItem } from '../../test/factories'

beforeEach(() => { cleanup(); h.cancelCfdi.mockReset(); h.refreshCancelStatus.mockReset() })

const productsById = { p1: { id: 'p1', name: 'Golden Serum' } as never }
const base = { productsById, clientName: 'Dra. Uno', clientEmail: 'ok@dominio.mx', onClose: () => {} }
const TIMBRADA = { status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false }
const render1 = (invoice_meta: unknown) =>
  render(<BillDetail order={mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: invoice_meta as never })} {...base} />)

describe('<BillDetail> · cancelación', () => {
  it('timbrado real sin cancelación → "Cancelar CFDI"; modal muestra SOLO 02/03 y confirmación', () => {
    render1(TIMBRADA)
    expect(screen.getByText('Cancelar CFDI')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Cancelar CFDI'))
    expect(screen.getByText(/02 — Comprobante emitido con errores sin relación/)).toBeInTheDocument()
    expect(screen.getByText(/03 — No se llevó a cabo la operación/)).toBeInTheDocument()
    expect(screen.getByText('Confirmar cancelación')).toBeInTheDocument()
    expect(screen.getByText('No cancelar')).toBeInTheDocument()
    // No se ofrece 01 ni 04 en esta versión
    expect(screen.queryByText(/con relación/)).toBeNull()
    expect(screen.queryByText(/factura global/)).toBeNull()
  })

  it('cancelada → badge "CFDI cancelado", sin "Enviar factura" ni "Cancelar CFDI"; descarga disponible', () => {
    render1({ ...TIMBRADA, cancel: { status: 'cancelada', motive: '02' } })
    expect(screen.getByText(/CFDI cancelado/)).toBeInTheDocument()
    expect(screen.queryByText('Enviar factura')).toBeNull()
    expect(screen.queryByText('Cancelar CFDI')).toBeNull()
    expect(screen.getByText('Descargar XML')).toBeInTheDocument()
    expect(screen.getByText('Descargar PDF')).toBeInTheDocument()
  })

  it('pendiente → badge + "Actualizar estatus", sin "Enviar factura"; descarga disponible', () => {
    render1({ ...TIMBRADA, cancel: { status: 'pendiente', motive: '02' } })
    expect(screen.getByText(/Cancelación pendiente/)).toBeInTheDocument()
    expect(screen.getByText('Actualizar estatus')).toBeInTheDocument()
    expect(screen.queryByText('Enviar factura')).toBeNull()
    expect(screen.getByText('Descargar XML')).toBeInTheDocument()
  })

  it('rechazada → sí permite "Enviar factura" y "Cancelar CFDI"', () => {
    render1({ ...TIMBRADA, cancel: { status: 'rechazada', motive: '03' } })
    expect(screen.getByText('Enviar factura')).toBeInTheDocument()
    expect(screen.getByText('Cancelar CFDI')).toBeInTheDocument()
  })

  it('confirmar cancelación → llama cancelCfdi y actualiza a badge cancelado', async () => {
    h.cancelCfdi.mockResolvedValue('cancelada')
    render1(TIMBRADA)
    fireEvent.click(screen.getByText('Cancelar CFDI'))
    fireEvent.click(screen.getByText('Confirmar cancelación'))
    await waitFor(() => expect(h.cancelCfdi).toHaveBeenCalledWith(expect.any(String), '02'))
    await waitFor(() => expect(screen.getByText(/CFDI cancelado/)).toBeInTheDocument())
    expect(screen.queryByText('Enviar factura')).toBeNull()
  })
})
