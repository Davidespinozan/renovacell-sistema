// @vitest-environment jsdom
// LINK DE PAGO (2 nov 2026) · lista del vendedor, envío con dominio a la vista y bloque del portal del doctor.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { LinksPago } from './LinksPago'
import { LinkPagoTarjeta } from '../doctor/LinkPagoTarjeta'
import type { ClienteLinksPago, LinkPago } from '../../data/ops/linksPago'
import { dominioDe, esBanBajio } from '../../data/ops/linksPago'

beforeEach(cleanup)
const base: LinkPago = { id: 'l1', order_id: 'o1', folio: 'S123', estado: 'solicitado', monto: 4600, via: 'whatsapp', url: null, dominio: null, banbajio: null, created_at: '2026-11-02T20:00:00Z', enviado_at: null, pagado_at: null, referencia: null, cliente: 'dra. ana pérez', vendedor: 'Alejandra', es_mio: true }
function falso(over: Partial<ClienteLinksPago> = {}, lista: LinkPago[] = [base]): ClienteLinksPago {
  return {
    lista: async () => ({ ok: true, data: lista }),
    solicitar: vi.fn(async () => ({ ok: true as const, data: { ...base, via: 'portal' as const } })),
    dePedido: async () => ({ ok: true, data: null }),
    enviar: vi.fn(async () => ({ ok: true as const, data: { ...base, estado: 'enviado' as const, whatsapp: true } })),
    cancelar: vi.fn(async () => ({ ok: true as const, data: { ...base, estado: 'cancelado' as const } })),
    pagado: vi.fn(async () => ({ ok: true as const, data: { ...base, estado: 'pagado' as const } })),
    ...over,
  }
}

describe('dominio del link', () => {
  it('solo https; reconoce BanBajío', () => {
    expect(dominioDe('https://pagos.bb.com.mx/l/1')).toBe('pagos.bb.com.mx'); expect(dominioDe('http://x.com')).toBeNull()
    expect(esBanBajio('pagos.bb.com.mx')).toBe(true); expect(esBanBajio('www.bancobajio.com.mx')).toBe(true); expect(esBanBajio('otro.com')).toBe(false)
  })
})

describe('<LinksPago> (vendedor)', () => {
  it('muestra la solicitud con monto exacto y envía el link pegado', async () => {
    const c = falso()
    render(<LinksPago cliente={c} />)
    expect(await screen.findByText(/pedido S123 · \$4,600/)).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('link-url'), { target: { value: 'https://otro.com/x' } })
    expect(screen.getByTestId('link-dominio')).toHaveTextContent('no parece de BanBajío')
    fireEvent.change(screen.getByTestId('link-url'), { target: { value: 'https://pagos.bb.com.mx/l/abc' } })
    expect(screen.getByTestId('link-dominio')).toHaveTextContent('(BanBajío)')
    fireEvent.click(screen.getByTestId('link-enviar'))
    await waitFor(() => expect(c.enviar).toHaveBeenCalledWith('l1', 'https://pagos.bb.com.mx/l/abc'))
  })
  it('sin rol de Dirección no aparece "Ya pagó"', async () => {
    render(<LinksPago cliente={falso({}, [{ ...base, estado: 'enviado', url_guardada: 'https://pagos.bb.com.mx/l/abc', banbajio: true }])} />)
    await screen.findByTestId('link-pago')
    expect(screen.queryByTestId('link-pagado')).toBeNull()
  })
})

describe('<LinkPagoTarjeta> (doctor)', () => {
  it('pide el link y luego avisa que su asesor se lo manda', async () => {
    const c = falso()
    render(<LinkPagoTarjeta orderId="o1" cliente={c} />)
    fireEvent.click(await screen.findByTestId('link-pago-pedir'))
    expect(await screen.findByTestId('link-pago-pedido')).toHaveTextContent('Tu asesor te lo manda')
  })
  it('con el link listo, botón para pagar', async () => {
    render(<LinkPagoTarjeta orderId="o1" cliente={falso({ dePedido: async () => ({ ok: true, data: { ...base, estado: 'enviado', url: 'https://pagos.bb.com.mx/l/abc' } }) })} />)
    expect(await screen.findByTestId('link-pago-abrir')).toHaveAttribute('href', 'https://pagos.bb.com.mx/l/abc')
  })
})
