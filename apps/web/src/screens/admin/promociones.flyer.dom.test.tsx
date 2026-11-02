// @vitest-environment jsdom
// PROMOCIÓN DESDE UN FLYER · subir la imagen llena el formulario de siempre para revisarlo; al guardar puede publicarse
// también como flyer del portal ligado a la promoción.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'p-botox', name: 'Botox 100 UI', price: 4600, active: true }] }), isActiveProduct: () => true }))
vi.mock('../../data/hooks/usePricing', () => ({ usePricing: () => ({ lists: [] }) }))
import { Promociones } from './Promociones'

beforeEach(cleanup)
const leido = { nombre: 'Promo Allergan', desde: '2026-11-10', hasta: '2026-11-25', condiciones: 'Hasta agotar existencias', lineas: [{ producto_id: 'p-botox', texto: 'Botox', min_qty: 5, precio: 3800 }], sin_leer: [] }
const promoGuardada = { id: 'promo1', nombre: 'Promo Allergan', estado: 'programada', activa: true, desde: '2026-11-10', hasta: '2026-11-25', lineas: [], listas: null }

describe('<Promociones> · subir flyer', () => {
  it('lee el flyer, llena el formulario y publica el flyer al guardar', async () => {
    const leerFlyer = vi.fn(async () => ({ ok: true as const, data: leido }))
    const guardar = vi.fn(async () => ({ ok: true as const, data: promoGuardada as never }))
    const publicarFlyer = vi.fn(async () => ({ ok: true }))
    render(<Promociones listar={async () => ({ ok: true, data: [] })} guardar={guardar} leerFlyer={leerFlyer} publicarFlyer={publicarFlyer} flyers={false} />)
    const f = new File(['x'], 'flyer.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('promo-flyer-input'), { target: { files: [f] } })
    expect(await screen.findByTestId('promo-form')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre de la promoción')).toHaveValue('Promo Allergan')
    expect(screen.getByLabelText('Nota')).toHaveValue('Hasta agotar existencias')
    expect(screen.getByTestId('promo-flyer-publicar')).toBeInTheDocument()
    expect(screen.getByTestId('promo-aviso')).toHaveTextContent('Leí el flyer: 1 renglón')
  })
  it('si no se puede leer, lo dice', async () => {
    render(<Promociones listar={async () => ({ ok: true, data: [] })} leerFlyer={async () => ({ ok: false as const, error: 'No se pudo leer el flyer; intenta de nuevo.' })} flyers={false} />)
    fireEvent.change(screen.getByTestId('promo-flyer-input'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo leer el flyer')
  })
})
