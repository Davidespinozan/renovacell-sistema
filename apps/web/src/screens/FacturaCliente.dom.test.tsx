// @vitest-environment jsdom
// AUTOFACTURA · página pública /factura: el cliente abre el enlace de su recibo, ve su compra y pide su factura.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { FacturaCliente } from './FacturaCliente'
import type { VistaFactura } from '../data/ops/autofactura'

const P = '11111111-1111-4111-8111-111111111111'
const ENLACE = `#${P}.AAAAAAAAAAAAAAAAAAAAAA`
const vista = (x: Partial<VistaFactura> = {}): VistaFactura => ({ estado: 'disponible', mensaje: '', folio: 'S298415', fecha: '2026-11-25', total: 5400, limite: '2026-11-30', pagado: true, receptor: null, ...x })
const llenar = () => {
  fireEvent.change(screen.getByLabelText('RFC'), { target: { value: 'gode561231gr8' } })
  fireEvent.change(screen.getByLabelText('Nombre o razón social'), { target: { value: 'Dra. Uno' } })
  fireEvent.change(screen.getByLabelText('Régimen fiscal'), { target: { value: '612' } })
  fireEvent.change(screen.getByLabelText('Código postal fiscal'), { target: { value: '80020' } })
  fireEvent.change(screen.getByLabelText('Uso de la factura'), { target: { value: 'G03' } })
  fireEvent.change(screen.getByLabelText('Correo donde quieres recibirla'), { target: { value: 'dra@x.mx' } })
}
beforeEach(cleanup)

describe('<FacturaCliente>', () => {
  it('muestra la compra y hasta cuándo puede pedir la factura', async () => {
    const ver = vi.fn(async () => ({ ok: true as const, data: vista() }))
    render(<FacturaCliente enlace={ENLACE} ver={ver} pedir={vi.fn()} />)
    const c = await screen.findByTestId('factura-compra')
    expect(ver).toHaveBeenCalledWith(P, 'AAAAAAAAAAAAAAAAAAAAAA')
    expect(c).toHaveTextContent('S298415'); expect(c).toHaveTextContent('25 nov 2026'); expect(c).toHaveTextContent('$5,400')
    expect(screen.getByTestId('factura-plazo')).toHaveTextContent('hasta el 30 de noviembre de 2026')
    expect(screen.getByTestId('factura-plazo')).toHaveTextContent('factura global del mes')
  })
  it('no envía con datos incompletos: dice qué falta', async () => {
    const pedir = vi.fn()
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista() })} pedir={pedir} />)
    fireEvent.click(await screen.findByTestId('factura-pedir'))
    expect(screen.getByTestId('factura-error')).toHaveTextContent('Escribe tu RFC')
    expect(pedir).not.toHaveBeenCalled()
  })
  it('con los datos completos la pide y confirma a qué correo llega', async () => {
    const pedir = vi.fn(async () => ({ ok: true as const, data: vista({ estado: 'solicitada', receptor: { rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', correo: 'd•••@x.mx' } }) }))
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista() })} pedir={pedir} />)
    await screen.findByTestId('factura-form'); llenar()
    fireEvent.click(screen.getByTestId('factura-pedir'))
    await waitFor(() => expect(screen.getByTestId('factura-solicitada')).toHaveTextContent('¡Listo! Recibimos tus datos.'))
    expect(pedir).toHaveBeenCalledWith(P, 'AAAAAAAAAAAAAAAAAAAAAA', { rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', email_facturacion: 'dra@x.mx' })
    expect(screen.getByTestId('factura-solicitada')).toHaveTextContent('d•••@x.mx')
    expect(screen.queryByTestId('factura-form')).toBeNull()
  })
  it('sin pagar todavía, avisa que se emite al registrarse el pago', async () => {
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'solicitada', pagado: false, receptor: { rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', correo: 'd•••@x.mx' } }) })} pedir={vi.fn()} />)
    expect(await screen.findByTestId('factura-solicitada')).toHaveTextContent('Se emite cuando se registre el pago')
  })
  it('una ya pedida se puede corregir: abre el formulario con lo capturado (el correo se escribe de nuevo)', async () => {
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'solicitada', receptor: { rfc: 'GODE561231GR8', razon_social: 'Dra. Uno', regimen: '612', cp: '80020', uso_cfdi: 'G03', correo: 'd•••@x.mx' } }) })} pedir={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('factura-corregir'))
    expect((screen.getByLabelText('RFC') as HTMLInputElement).value).toBe('GODE561231GR8')
    expect((screen.getByLabelText('Correo donde quieres recibirla') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('factura-pedir')).toHaveTextContent('Guardar mis datos')
  })
  it('pasado el mes ya no hay formulario: explica que va en la global a público en general', async () => {
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'fuera_de_mes', mensaje: 'El plazo para facturar esta compra terminó. Ya forma parte de la factura global del mes a público en general y no puede facturarse a tu nombre.' }) })} pedir={vi.fn()} />)
    const a = await screen.findByTestId('factura-fuera_de_mes')
    expect(a).toHaveTextContent('público en general'); expect(a).toHaveTextContent('El plazo era hasta el 30 de noviembre de 2026')
    expect(screen.queryByTestId('factura-form')).toBeNull()
  })
  it('ya facturada o cancelada: lo dice y no ofrece formulario', async () => {
    const r = render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'facturada', mensaje: 'Tu factura ya fue emitida y se envió a tu correo.' }) })} pedir={vi.fn()} />)
    expect(await screen.findByTestId('factura-facturada')).toHaveTextContent('ya fue emitida')
    expect(screen.queryByTestId('factura-form')).toBeNull()
    r.unmount()
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'cancelada', mensaje: 'Esta compra fue cancelada: no se factura.' }) })} pedir={vi.fn()} />)
    expect(await screen.findByTestId('factura-cancelada')).toHaveTextContent('cancelada')
  })
  it('ya timbrada: se descarga aquí mismo en PDF o XML, escribiendo el RFC de la factura', async () => {
    const archivo = { filename: 'S298415_UUID.pdf', contentType: 'application/pdf', base64: 'JVBERi0=' }
    const descargar = vi.fn(async () => ({ ok: true as const, data: archivo })); const guardar = vi.fn()
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'facturada', mensaje: 'Tu factura ya fue emitida y se envió a tu correo. También puedes descargarla aquí.' }) })} pedir={vi.fn()} descargar={descargar} guardar={guardar} />)
    await screen.findByTestId('factura-descarga')
    fireEvent.click(screen.getByTestId('factura-pdf'))                           // sin RFC no sale al servidor
    expect(screen.getByTestId('factura-descarga-error')).toHaveTextContent('Escribe el RFC')
    expect(descargar).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/escribe el RFC con el que se facturó/), { target: { value: 'gode561231gr8' } })
    fireEvent.click(screen.getByTestId('factura-pdf'))
    await waitFor(() => expect(guardar).toHaveBeenCalledWith(archivo))
    expect(descargar).toHaveBeenCalledWith(P, 'AAAAAAAAAAAAAAAAAAAAAA', 'GODE561231GR8', 'pdf')
    fireEvent.click(screen.getByTestId('factura-xml'))
    await waitFor(() => expect(descargar).toHaveBeenLastCalledWith(P, 'AAAAAAAAAAAAAAAAAAAAAA', 'GODE561231GR8', 'xml'))
  })
  it('con otro RFC el servidor no la entrega y la página lo dice', async () => {
    const descargar = vi.fn(async () => ({ ok: false as const, mensaje: 'Ese RFC no coincide con el de la factura. Escríbelo tal como lo capturaste.' })); const guardar = vi.fn()
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista({ estado: 'facturada', mensaje: 'Tu factura ya fue emitida.' }) })} pedir={vi.fn()} descargar={descargar} guardar={guardar} />)
    await screen.findByTestId('factura-descarga')
    fireEvent.change(screen.getByLabelText(/escribe el RFC con el que se facturó/), { target: { value: 'XAXX010101000' } })
    fireEvent.click(screen.getByTestId('factura-pdf'))
    await waitFor(() => expect(screen.getByTestId('factura-descarga-error')).toHaveTextContent('no coincide'))
    expect(guardar).not.toHaveBeenCalled()
  })
  it('mientras no esté timbrada no se ofrece descarga', async () => {
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista() })} pedir={vi.fn()} />)
    await screen.findByTestId('factura-form')
    expect(screen.queryByTestId('factura-descarga')).toBeNull()
  })
  it('un enlace incompleto o que el servidor no reconoce no muestra ninguna compra', async () => {
    const ver = vi.fn()
    const r = render(<FacturaCliente enlace="#roto" ver={ver} pedir={vi.fn()} />)
    expect(await screen.findByTestId('factura-invalida')).toHaveTextContent('Vuelve a escanear')
    expect(ver).not.toHaveBeenCalled()
    r.unmount()
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: false, mensaje: 'Este enlace no es válido.' })} pedir={vi.fn()} />)
    expect(await screen.findByTestId('factura-invalida')).toHaveTextContent('Este enlace no es válido.')
    expect(screen.queryByTestId('factura-compra')).toBeNull()
  })
  it('si el servidor rechaza la solicitud, el mensaje se queda a la vista y no se pierde lo escrito', async () => {
    const pedir = vi.fn(async () => ({ ok: false as const, mensaje: 'Revisa tus datos fiscales: alguno falta o no tiene el formato correcto.' }))
    render(<FacturaCliente enlace={ENLACE} ver={async () => ({ ok: true, data: vista() })} pedir={pedir} />)
    await screen.findByTestId('factura-form'); llenar()
    fireEvent.click(screen.getByTestId('factura-pedir'))
    await waitFor(() => expect(screen.getByTestId('factura-error')).toHaveTextContent('Revisa tus datos fiscales'))
    expect((screen.getByLabelText('RFC') as HTMLInputElement).value).toBe('GODE561231GR8')
  })
})
