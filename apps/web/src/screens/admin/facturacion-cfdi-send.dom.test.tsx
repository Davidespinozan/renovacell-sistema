// @vitest-environment jsdom
// Envío CFDI (UI) — el campo "Correo de envío" + botón "Enviar factura" aparecen SOLO para un
// CFDI timbrado real; prefill con el correo del doctor; editable; loading anti doble-clic;
// tras éxito el botón dice "Reenviar factura"; email inválido bloquea el botón.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ sendCfdi: vi.fn(), enlaces: vi.fn() }))
// Mockea solo sendCfdi; conserva el emailValido real.
vi.mock('../../data/ops/cfdiSend', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, sendCfdi: h.sendCfdi }
})

// El enlace del recibo lo entrega el servidor: aquí se simula (lo demás del módulo es el real).
vi.mock('../../data/ops/autofactura', async (orig) => ({ ...(await (orig() as Promise<Record<string, unknown>>)), enlacesFactura: h.enlaces }))

import { BillDetail } from './Facturacion'
import { mkOrder, mkItem } from '../../test/factories'

beforeEach(() => { cleanup(); h.sendCfdi.mockReset(); h.enlaces.mockReset(); h.enlaces.mockResolvedValue({}) })

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

// POR WHATSAPP (dueño, 27 nov 2026: «todo lo que enviemos debe poder mandarse también por WhatsApp»).
describe('<BillDetail> · enviar la factura por WhatsApp', () => {
  const URL_QR = 'https://sistema.renovacell.mx/factura#11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAA'
  const orden = (x: Record<string, unknown> = {}) => mkOrder({ id: 'o-wa', external_ref: 'S298415', payment_status: 'paid', invoice_requested: true, items: [mkItem()], invoice_meta: TIMBRADA as never, ...x } as never)

  it('con la factura timbrada abre WhatsApp del cliente con el enlace para bajarla', async () => {
    h.enlaces.mockResolvedValue({ 'o-wa': { url: URL_QR, limite: '2026-11-30' } })
    const abrir = vi.fn(); window.open = abrir as never
    render(<BillDetail order={orden({ shipping_meta: { customer: { name: 'Dra. Uno', phone: '667 123 4567' } } })} {...base} />)
    const b = screen.getByTestId('fact-whatsapp') as HTMLButtonElement
    expect(b).toBeDisabled()                                                    // mientras llega el enlace
    expect(screen.getByTestId('fact-whatsapp-nota')).toHaveTextContent('Preparando el enlace')
    await waitFor(() => expect(b).not.toBeDisabled())
    expect(h.enlaces).toHaveBeenCalledWith(['o-wa'])
    fireEvent.click(b)
    const url = decodeURIComponent(String(abrir.mock.calls[0][0]))
    expect(url).toContain('wa.me/526671234567')
    expect(url).toContain('factura de tu compra S298415'); expect(url).toContain(URL_QR); expect(url).toContain('RFC')
  })

  it('sin teléfono en el pedido usa el del doctor; sin ninguno, WhatsApp deja elegir a quién', async () => {
    h.enlaces.mockResolvedValue({ 'o-wa': { url: URL_QR, limite: '2026-11-30' } })
    const abrir = vi.fn(); window.open = abrir as never
    render(<BillDetail order={orden()} clientPhone="6679990000" {...base} />)
    await waitFor(() => expect(screen.getByTestId('fact-whatsapp')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('fact-whatsapp'))
    expect(String(abrir.mock.calls[0][0])).toContain('wa.me/526679990000?text=')
    cleanup(); abrir.mockClear()
    render(<BillDetail order={orden()} {...base} />)
    await waitFor(() => expect(screen.getByTestId('fact-whatsapp')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('fact-whatsapp'))
    expect(String(abrir.mock.calls[0][0])).toContain('wa.me/?text=')
  })

  it('si el enlace no se pudo preparar lo dice y no abre nada', async () => {
    const abrir = vi.fn(); window.open = abrir as never
    render(<BillDetail order={orden()} {...base} />)
    await waitFor(() => expect(screen.getByTestId('fact-whatsapp-nota')).toHaveTextContent('No se pudo preparar el enlace'))
    expect(screen.getByTestId('fact-whatsapp')).toBeDisabled()
    fireEvent.click(screen.getByTestId('fact-whatsapp'))
    expect(abrir).not.toHaveBeenCalled()
  })

  it('sin factura real, o con la factura cancelada, no se ofrece (ni se pide el enlace)', () => {
    render1({ status: 'emitida', uuid: 'SIM', simulated: true })
    expect(screen.queryByTestId('fact-whatsapp')).toBeNull()
    cleanup()
    render1({ ...TIMBRADA, cancel: { status: 'cancelada', motive: '02' } })
    expect(screen.queryByTestId('fact-whatsapp')).toBeNull()
    expect(h.enlaces).not.toHaveBeenCalled()
  })
})
