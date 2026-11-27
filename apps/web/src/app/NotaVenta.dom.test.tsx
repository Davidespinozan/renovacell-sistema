// @vitest-environment jsdom
// NOTA DE VENTA y QR de la factura (27 nov 2026): un comprobante con marca para toda venta, con la forma de pago
// correcta y el código para que el cliente pida su factura dentro del mes.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ enlace: null as null | { url: string; limite: string } }))
vi.mock('../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p1', name: 'Linurase 100 UI', unit: null }, { id: 'u1', name: 'ULTRAFILTRADO MOBILIS 2.5 ml', unit: 'Media caja/10 viales' }] }) }))
vi.mock('../data/store/companyStore', () => ({ currentCompany: () => ({ direccion: 'Av. Ejemplo 100, Culiacán', telefono: '6670000000' }) }))
vi.mock('../data/ops/autofactura', async (orig) => ({ ...(await orig<object>()), useEnlaceFactura: () => h.enlace }))
import { NotaVentaView, BotonNotaVenta, QRFactura, textoNotaVenta } from './NotaVenta'
import { trazoQR } from '../data/ops/autofactura'

const URL_QR = 'https://sistema.renovacell.mx/factura#11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAA'
const pedido = (x: Record<string, unknown> = {}) => ({ id: 'o1', external_ref: 'S298415', created_at: '2026-11-25T18:00:00Z', status: 'paid', payment_status: 'paid', payment_method: 'transferencia', total: 12360, shipping_cost: 600,
  shipping_meta: { customer: { name: 'FERNANDA ROJO IBARRA', phone: '6671234567' } },
  items: [{ id: 'i1', product_id: 'p1', qty: 3, unit_price: 1800 }, { id: 'i2', product_id: 'u1', qty: 2, unit_price: 3180 }], ...x }) as never

beforeEach(() => { cleanup(); h.enlace = { url: URL_QR, limite: '2026-11-30' } })

describe('<NotaVentaView>', () => {
  it('lleva marca, cliente, productos con precio, envío, total y total en letras', () => {
    render(<NotaVentaView order={pedido()} enlace={h.enlace} />)
    const n = screen.getByTestId('nota-venta')
    expect(n).toHaveTextContent('Renovacell'); expect(n).toHaveTextContent('Nota de venta'); expect(n).toHaveTextContent('S298415')
    expect(n).toHaveTextContent('Fernanda Rojo Ibarra')                         // ya no en MAYÚSCULAS
    expect(n).toHaveTextContent('Linurase 100 UI'); expect(n).toHaveTextContent('$5,400')
    expect(screen.getByTestId('nota-envio')).toHaveTextContent('$600')
    expect(screen.getByTestId('nota-total')).toHaveTextContent('$12,360')
    expect(n).toHaveTextContent(/Son: .*PESOS/i)
    expect(n).toHaveTextContent('Este documento no es un comprobante fiscal.')
    expect(n.textContent).not.toMatch(/sistema operativo/i)
  })
  it('la media caja se lee en cajas con su precio por caja', () => {
    render(<NotaVentaView order={pedido()} enlace={null} />)
    const fila = screen.getByText('ULTRAFILTRADO MOBILIS 2.5 ml').closest('tr')!
    expect(fila).toHaveTextContent('1 caja'); expect(fila).toHaveTextContent('$6,360')
  })
  it('la forma de pago se dice bien: una transferencia ya no sale como «Efectivo»', () => {
    render(<NotaVentaView order={pedido()} enlace={null} />)
    expect(screen.getByTestId('nota-pago')).toHaveTextContent('Transferencia')
    expect(screen.getByTestId('nota-estado')).toHaveTextContent('Pagado')
    cleanup()
    render(<NotaVentaView order={pedido({ payment_status: 'pending', payment_method: 'contra_entrega' })} enlace={null} />)
    expect(screen.getByTestId('nota-estado')).toHaveTextContent('Por cobrar')
    expect(screen.getByTestId('nota-pago').textContent).not.toMatch(/_/)
  })
  it('trae el QR de la factura con la fecha límite; sin enlace o cancelada, no', () => {
    const r = render(<NotaVentaView order={pedido()} enlace={h.enlace} />)
    expect(screen.getByTestId('codigo-qr').getAttribute('data-texto')).toBe(URL_QR)
    expect(screen.getByTestId('qr-factura-limite')).toHaveTextContent('Tienes hasta el 30 de noviembre de 2026')
    r.unmount()
    const s = render(<NotaVentaView order={pedido()} enlace={null} />)
    expect(screen.queryByTestId('qr-factura')).toBeNull()
    s.unmount()
    render(<NotaVentaView order={pedido({ status: 'cancelled' })} enlace={h.enlace} />)
    expect(screen.queryByTestId('qr-factura')).toBeNull()
    expect(screen.getByTestId('nota-estado')).toHaveTextContent('Cancelado')
  })
})

describe('QR', () => {
  it('se dibuja aquí mismo, es estable y crece con el texto', () => {
    const a = trazoQR(URL_QR); const b = trazoQR(URL_QR); const corto = trazoQR('hola')
    expect(a.d).toBe(b.d); expect(a.lado).toBeGreaterThan(corto.lado)
    expect(a.d.startsWith('M0 0h1v1h-1z')).toBe(true)                            // el patrón de esquina siempre empieza oscuro
    expect(a.lado % 4).toBe(1)                                                   // las medidas de un QR son 21, 25, 29…
  })
  it('<QRFactura> no pinta nada sin enlace', () => {
    const { container } = render(<QRFactura enlace={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('<BotonNotaVenta>', () => {
  it('abre la nota, la imprime sola y arma el mensaje de WhatsApp con el enlace de la factura', async () => {
    window.print = vi.fn(); const abrir = vi.fn(); window.open = abrir as never
    render(<BotonNotaVenta order={pedido()} />)
    expect(screen.queryByTestId('nota-venta')).toBeNull()
    fireEvent.click(screen.getByTestId('nota-venta-abrir'))
    expect(screen.getByTestId('nota-venta-ventana')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nota-venta-whatsapp'))
    const url = decodeURIComponent(String(abrir.mock.calls[0][0]))
    expect(url).toContain('wa.me/526671234567'); expect(url).toContain('Folio: S298415'); expect(url).toContain('Total: $12,360')
    expect(url).toContain('Pago: Transferencia · Pagado'); expect(url).toContain(URL_QR); expect(url).toContain('hasta el 30 de noviembre de 2026')
    fireEvent.click(screen.getByTestId('nota-venta-imprimir'))
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1))
    expect(document.title).toBe('Nota de venta S298415')
    fireEvent(window, new Event('afterprint'))
    expect(document.body.classList.contains('printing-remision')).toBe(false)
  })
  it('el texto de WhatsApp sin enlace no inventa uno', () => {
    const t = textoNotaVenta(pedido(), () => 'Producto ×1', null)
    expect(t).not.toMatch(/factura\?/i); expect(t).toContain('no es un comprobante fiscal')
  })
  it('con la factura ya emitida el mensaje dice dónde bajarla, no que la pida; con cancelación en curso no ofrece nada', () => {
    const TIMBRADA = { status: 'timbrada', uuid: 'SAT-9', facturama_id: 'FAC-9', simulated: false }
    const t = textoNotaVenta(pedido({ invoice_meta: TIMBRADA }), () => 'Producto ×1', h.enlace)
    expect(t).toContain('Tu factura ya está lista'); expect(t).toContain(URL_QR); expect(t).toContain('RFC'); expect(t).not.toContain('Pídela aquí')
    const c = textoNotaVenta(pedido({ invoice_meta: { ...TIMBRADA, cancel: { status: 'cancelada' } } }), () => 'Producto ×1', h.enlace)
    expect(c).not.toContain(URL_QR)
    const r = textoNotaVenta(pedido({ invoice_meta: { ...TIMBRADA, cancel: { status: 'rechazada' } } }), () => 'Producto ×1', h.enlace)
    expect(r).toContain('Tu factura ya está lista')
  })
})
