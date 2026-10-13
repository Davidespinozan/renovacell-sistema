// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Cola } from './Cola'
import { Guias } from './Guias'
import { fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { BotonRemision, LEMA_MARCA } from './Remision'

beforeEach(cleanup)

describe('Empaque', () => {
  it('<Cola> muestra la cola de empaque', () => {
    renderWithRole(<Cola />)
    expect(screen.getByText('Envíos · Por enviar')).toBeInTheDocument()
  })
  it('<Guias> muestra las guías', () => {
    renderWithRole(<Guias />)
    expect(screen.getByText('Empaque · Guías')).toBeInTheDocument()
  })
  it('la remisión se imprime desde el pedido: lleva la marca del negocio, el destinatario y el lote; nunca "Sistema operativo"', () => {
    window.print = vi.fn()
    const order = { id: 'O-1', external_ref: 'S100001', created_at: '2026-10-13T18:00:00Z', shipping_meta: { customer: { name: 'Dra. Prueba' }, address: { line1: 'Av. Uno 123', city: 'Mazatlán', state: 'Sinaloa', cp: '82000' } }, items: [{ id: 'I-1', product_id: 'P-x', lot_id: null, qty: 2, unit_price: 100 }] }
    renderWithRole(<BotonRemision order={order as never} envio={{ carrier: 'DHL', tracking_number: '8664197986' }} />)
    expect(document.querySelector('.remision-print-root')).toBeNull()
    fireEvent.click(screen.getByTestId('imprimir-remision'))
    const doc = document.querySelector('.remision-print-root') as HTMLElement
    expect(window.print).toHaveBeenCalledTimes(1)
    expect(document.body.classList.contains('printing-remision')).toBe(true)
    expect(doc.textContent).toContain(LEMA_MARCA); expect(doc.textContent).toContain('Dra. Prueba'); expect(doc.textContent).toContain('C.P. 82000')
    expect(doc.textContent).toContain('DHL · guía 8664197986'); expect(doc.textContent).toContain('2 pzas')
    expect(doc.textContent).not.toMatch(/sistema operativo/i)
    fireEvent(window, new Event('afterprint'))
    expect(document.body.classList.contains('printing-remision')).toBe(false)
  })
})
