// @vitest-environment jsdom
// COMPRADORES × PROMOCIÓN (3 nov 2026) · "A quién ofrecerle": clientes que ya compraron algo que hoy está en promoción,
// con el mensaje listo para WhatsApp/correo y el botón al embudo; en "Por producto", la etiqueta y el filtro de promoción.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ProductosClientes } from './ProductosClientes'
import { mensajeOferta, textoPromo, whatsappCon, type OportunidadPromo, type PromoProducto } from '../../data/ops/busqueda'

afterEach(cleanup)

const promo: PromoProducto = { promocion_id: 'PM1', nombre: 'Buen Fin', hasta: '2026-11-17', product_id: 'V2', producto: 'Toxina 300 U', precio_normal: 1500,
  escalones: [{ desde: 5, precio: 1200 }, { desde: 1, precio: 1300 }] }
const oferta: OportunidadPromo = { customer_id: 'CU1', nombre: 'DRA. ANA PEREZ', telefono: '669 111 2233', email: 'ana@x.mx', tiene_cuenta: true, vendedor: null, ultima: '2026-10-01T18:00:00Z',
  ofertas: [{ familia_id: 'F', familia: 'Toxina', veces: 2, unidades: 3, ultima: '2026-10-01T18:00:00Z', presentaciones: ['Toxina 100 U'], promos: [promo] }] }

describe('texto de la oferta', () => {
  it('escalones en orden, precio normal y mensaje en voz del vendedor', () => {
    expect(textoPromo(promo)).toBe('Toxina 300 U: $1,300 (normal $1,500); desde 5 piezas, $1,200')
    const m = mensajeOferta('Dra. Ana Perez', oferta.ofertas, (d) => d)
    expect(m).toContain('Hola Dra. Ana Perez, le escribo de Renovacell.')
    expect(m).toContain('• Toxina 300 U: $1,300 (normal $1,500); desde 5 piezas, $1,200 — Buen Fin, hasta el 2026-11-17')
    expect(m).toContain('¿Le aparto piezas?')
  })
  it('WhatsApp: 10 dígitos abre su chat; sin teléfono válido, eliges a quién', () => {
    expect(whatsappCon('669 111 2233', 'hola')).toBe('https://wa.me/526691112233?text=hola')
    expect(whatsappCon(null, 'hola')).toBe('https://wa.me/?text=hola')
  })
})

describe('Productos › A quién ofrecerle', () => {
  const productos = vi.fn(async () => [
    { product_id: 'F', nombre: 'Toxina', sku: null, categoria: 'Toxinas', activo: true, clientes: 1, ultima: '2026-10-01T18:00:00Z', promos: [promo] },
    { product_id: 'P3', nombre: 'Ácido', sku: null, categoria: null, activo: true, clientes: 2, ultima: '2026-10-01T18:00:00Z', promos: [] },
  ])
  it('abre en la pestaña de ofertas cuando hay a quién, con mensaje listo y al embudo', async () => {
    const alEmbudo = vi.fn(async () => ({ ok: true as const }))
    render(<ProductosClientes productos={productos} oportunidades={async () => [oferta]} compradores={async () => []} alEmbudo={alEmbudo} />)
    const o = await screen.findByTestId('oferta')
    expect(screen.getByTestId('tab-ofrecer')).toHaveTextContent('A quién ofrecerle (1)')
    expect(o).toHaveTextContent('Dra. Ana Perez'); expect(o).toHaveTextContent('Compró Toxina 100 U 2 veces')
    expect(o).toHaveTextContent('Buen Fin hasta el')
    const wa = screen.getByTestId('oferta-whatsapp') as HTMLAnchorElement
    expect(wa.href).toContain('wa.me/526691112233'); expect(decodeURIComponent(wa.href)).toContain('Toxina 300 U')
    expect(o.querySelector('a[href^="mailto:ana@x.mx?subject="]')).toBeTruthy()
    fireEvent.click(screen.getByTestId('oferta-embudo'))
    await waitFor(() => expect(alEmbudo).toHaveBeenCalledWith('CU1', 'Promoción: Toxina'))
    expect(await screen.findByText('En tu embudo')).toBeTruthy()
  })
  it('si ya tiene oportunidad abierta lo dice claro', async () => {
    render(<ProductosClientes productos={productos} oportunidades={async () => [oferta]} compradores={async () => []} alEmbudo={async () => ({ ok: false, error: 'YA_ABIERTA: ese cliente ya tiene una oportunidad abierta' })} />)
    fireEvent.click(await screen.findByTestId('oferta-embudo'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya tiene una oportunidad abierta en el embudo.')
  })
  it('sin ofertas abre en "Por producto"; la etiqueta y el filtro de promoción funcionan', async () => {
    render(<ProductosClientes productos={productos} oportunidades={async () => []} compradores={async () => []} />)
    await waitFor(() => expect(screen.getAllByTestId('producto')).toHaveLength(2))
    expect(screen.getAllByTestId('producto-promo')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('solo-promo'))
    expect(screen.getAllByTestId('producto')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('tab-ofrecer'))
    expect(screen.getByTestId('ofrecer-vacio')).toHaveTextContent('ningún cliente tuyo compró algo que esté en promoción')
  })
  it('en el detalle del producto: la promoción arriba y el mensaje solo a quien le aplica', async () => {
    const compradores = vi.fn(async () => [
      { customer_id: 'CU1', nombre: 'Ana', telefono: '6691112233', email: null, tiene_cuenta: true, veces: 1, unidades: 2, ultima: '2026-10-01T18:00:00Z', ultimo_folio: 'S1', vendedor: null, presentaciones: ['Toxina 100 U'], promo_aplica: true },
      { customer_id: 'CU2', nombre: 'Beto', telefono: '6691112234', email: null, tiene_cuenta: false, veces: 1, unidades: 1, ultima: '2026-09-01T18:00:00Z', ultimo_folio: null, vendedor: null, presentaciones: [], promo_aplica: false },
    ])
    render(<ProductosClientes productos={productos} oportunidades={async () => []} compradores={compradores} />)
    fireEvent.click((await screen.findAllByTestId('producto'))[0])
    expect(await screen.findByTestId('compradores-promo')).toHaveTextContent('Buen Fin')
    const cs = await screen.findAllByTestId('comprador')
    expect(cs[0]).toHaveTextContent('Presentación: Toxina 100 U'); expect(cs[0].querySelector('[data-testid="oferta-whatsapp"]')).toBeTruthy()
    expect(cs[1]).toHaveTextContent('no aplica a su lista'); expect(cs[1].querySelector('[data-testid="oferta-whatsapp"]')).toBeNull()
  })
})
