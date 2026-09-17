// @vitest-environment jsdom
// Envío CFDI (UI) — el campo "Correo de envío" + botón "Enviar factura" aparecen SOLO para un
// CFDI timbrado real; prefill con el correo del doctor; editable; loading anti doble-clic;
// tras éxito el botón dice "Reenviar factura"; email inválido bloquea el botón.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ sendCfdi: vi.fn() }))
// Mockea solo sendCfdi; conserva el emailValido real.
vi.mock('../../data/ops/cfdiSend', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, sendCfdi: h.sendCfdi }
})

import { BillDetail } from './Facturacion'
import { mkOrder, mkItem } from '../../test/factories'

beforeEach(() => { cleanup(); h.sendCfdi.mockReset() })

const productsById = { p1: { id: 'p1', name: 'Golden Serum' } as never }
const base = { productsById, clientName: 'Dra. Uno', onClose: () => {} }
const TIMBRADA = { status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false }
const render1 = (invoice_meta: unknown, clientEmail = '') =>
  render(<BillDetail order={mkOrder({ payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: invoice_meta as never })} clientEmail={clientEmail} {...base} />)

describe('<BillDetail> · enviar factura', () => {
  it('CFDI timbrado real → muestra "Correo de envío" y "Enviar factura", prefilled con el correo del doctor', () => {
    render1(TIMBRADA, 'laura@renova.mx')
    expect(screen.getByText('Correo de envío')).toBeInTheDocument()
    expect(screen.getByText('Enviar factura')).toBeInTheDocument()
    expect((screen.getByPlaceholderText('correo@cliente.mx') as HTMLInputElement).value).toBe('laura@renova.mx')
  })

  it('folio simulado → NO muestra envío', () => {
    render1({ status: 'emitida', uuid: 'SIM', simulated: true })
    expect(screen.queryByText('Enviar factura')).toBeNull()
    expect(screen.queryByText('Correo de envío')).toBeNull()
  })

  it('invoice_meta null → NO muestra envío', () => {
    render1(null)
    expect(screen.queryByText('Enviar factura')).toBeNull()
  })

  it('POS/sin doctor → campo vacío para captura manual', () => {
    render1(TIMBRADA, '')
    expect((screen.getByPlaceholderText('correo@cliente.mx') as HTMLInputElement).value).toBe('')
  })

  it('email inválido → botón deshabilitado y aviso; válido → habilitado', () => {
    render1(TIMBRADA, 'malo@sinpunto')
    const btn = screen.getByText('Enviar factura').closest('button') as HTMLButtonElement
    expect(btn).toBeDisabled()
    expect(screen.getByText('Correo no válido.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('correo@cliente.mx'), { target: { value: 'ok@dominio.mx' } })
    expect(btn).not.toBeDisabled()
  })

  it('éxito → loading anti doble-clic y el botón pasa a "Reenviar factura"', async () => {
    let resolve!: (v: boolean) => void
    h.sendCfdi.mockReturnValue(new Promise<boolean>((r) => { resolve = r }))
    render1(TIMBRADA, 'ok@dominio.mx')
    const btn = screen.getByText('Enviar factura').closest('button') as HTMLButtonElement
    fireEvent.click(btn)
    // en vuelo: "Enviando…" y deshabilitado; un 2º clic no vuelve a llamar
    await screen.findByText('Enviando…')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(h.sendCfdi).toHaveBeenCalledTimes(1)
    resolve(true)
    await waitFor(() => expect(screen.getByText('Reenviar factura')).toBeInTheDocument())
  })

  it('error → NO cambia a "Reenviar" (sigue "Enviar factura")', async () => {
    h.sendCfdi.mockResolvedValue(false)
    render1(TIMBRADA, 'ok@dominio.mx')
    fireEvent.click(screen.getByText('Enviar factura').closest('button') as HTMLButtonElement)
    await waitFor(() => expect(h.sendCfdi).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Enviar factura')).toBeInTheDocument()
    expect(screen.queryByText('Reenviar factura')).toBeNull()
  })
})
