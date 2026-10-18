// @vitest-environment jsdom
// PROMO-9 · Flyers del portal: subir una imagen (se revisa tipo y peso), ponerle título, ligarla a una promoción o dejarla
// suelta con fechas, y publicar; la lista muestra el estado; pausar y eliminar van por sus comandos.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Flyers } from './Flyers'
import { revisarImagenFlyer, subirImagenFlyer, type Flyer } from '../../data/ops/flyers'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() } } }))
vi.mock('../../data/hooks/useProducts', () => ({ useProducts: () => ({ data: [{ id: 'B', name: 'Botox 100 UI', price: 4600, active: true }] }), isActiveProduct: () => true }))
vi.mock('../../data/hooks/usePricing', () => ({ usePricing: () => ({ lists: [{ id: 'L1', name: 'General', is_default: true, sort: 1 }, { id: 'L2', name: 'Mayoreo', is_default: false, sort: 2 }], prices: [], priceFor: () => null }) }))
beforeEach(cleanup)

const F: Flyer = { id: 'F1', titulo: 'Hoy último día · Botox', imagen_url: 'https://cdn.test/f1.jpg', promocion_id: null, product_id: 'B', producto: 'Botox 100 UI', desde: '2026-10-18', hasta: null, activo: true, orden: 0, listas: null, estado: 'vigente' }
const archivo = (nombre: string, tipo: string, kb: number) => new File([new Uint8Array(kb * 1024)], nombre, { type: tipo })

describe('PROMO-9 · Flyers', () => {
  it('revisa la imagen antes de subirla: tipo y peso', async () => {
    expect(revisarImagenFlyer({ type: 'image/gif', size: 10 })).toMatch(/JPG, PNG o WebP/)
    expect(revisarImagenFlyer({ type: 'image/jpeg', size: 5 * 1024 * 1024 })).toMatch(/más de 4 MB/)
    expect(revisarImagenFlyer({ type: 'image/webp', size: 1000 })).toBeNull()
    const r = await subirImagenFlyer(archivo('a.jpg', 'image/jpeg', 10), async () => 'data:image/jpeg;base64,xx')   // sin servidor no hay URL https
    expect(r).toEqual({ ok: false, error: 'No se pudo subir la imagen al servidor.' })
    const ok = await subirImagenFlyer(archivo('a.jpg', 'image/jpeg', 10), async (_f, carpeta) => `https://cdn.test/${carpeta}/x.jpg`)
    expect(ok).toEqual({ ok: true, data: 'https://cdn.test/flyers/x.jpg' })
  })
  it('elegir imagen → título propuesto → ligar a una promoción → publicar sube la imagen y manda el comando con la URL', async () => {
    const subir = vi.fn(async () => ({ ok: true as const, data: 'https://cdn.test/flyers/nuevo.jpg' }))
    const guardar = vi.fn(async (d: { titulo: string }) => ({ ok: true as const, data: { ...F, id: 'F2', titulo: d.titulo, promocion_id: 'P1', promocion: 'Promo Allergan' } }))
    const listar = vi.fn(async () => ({ ok: true as const, data: [] as Flyer[] }))
    render(<Flyers listar={listar} guardar={guardar} subir={subir} promociones={[{ id: 'P1', nombre: 'Promo Allergan', estado: 'vigente', desde: '2026-10-16', hasta: '2026-10-25' }, { id: 'P0', nombre: 'Vieja', estado: 'vencida', desde: '2026-09-01', hasta: '2026-09-10' }]} />)
    await waitFor(() => expect(listar).toHaveBeenCalled())
    expect(screen.getByText(/Sin flyers todavía/)).toBeTruthy()
    fireEvent.click(screen.getByTestId('flyer-nuevo'))
    expect((screen.getByTestId('flyer-guardar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('flyer-archivo'), { target: { files: [archivo('hoy-ultimo-dia.jpg', 'image/jpeg', 200)] } })
    expect((screen.getByLabelText('Título del flyer') as HTMLInputElement).value).toBe('hoy ultimo dia')
    fireEvent.change(screen.getByLabelText('Título del flyer'), { target: { value: 'Hoy último día · Botox' } })
    const sel = screen.getByTestId('flyer-promo') as HTMLSelectElement
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Ninguna', 'Promo Allergan · 16 oct al 25 oct'])   // las terminadas no se ofrecen
    fireEvent.change(sel, { target: { value: 'P1' } })
    expect(screen.getByTestId('flyer-vigencia-promo')).toHaveTextContent(/mientras dure la promoción/)
    fireEvent.click(screen.getByTestId('flyer-guardar'))
    await waitFor(() => expect(guardar).toHaveBeenCalledTimes(1))
    expect(subir).toHaveBeenCalledTimes(1)
    expect(guardar.mock.calls[0][0]).toEqual({ id: undefined, titulo: 'Hoy último día · Botox', imagen_url: 'https://cdn.test/flyers/nuevo.jpg', promocion_id: 'P1', product_id: null, desde: null, hasta: null, listas: null, orden: 0 })
    expect(screen.getByTestId('flyer-aviso')).toHaveTextContent(/publicado · vigente: ya se ve en el Inicio/)
  })
  it('una imagen que no sirve se rechaza antes de subir; con error del servidor se muestra el motivo', async () => {
    const guardar = vi.fn(async () => ({ ok: false as const, error: 'Solo Dirección o Facturación administran flyers.' }))
    render(<Flyers listar={async () => ({ ok: true, data: [] })} guardar={guardar} subir={async () => ({ ok: true, data: 'https://cdn.test/x.jpg' })} />)
    fireEvent.click(screen.getByTestId('flyer-nuevo'))
    fireEvent.change(screen.getByTestId('flyer-archivo'), { target: { files: [archivo('x.gif', 'image/gif', 10)] } })
    expect(screen.getByRole('alert')).toHaveTextContent(/JPG, PNG o WebP/)
    expect((screen.getByTestId('flyer-guardar') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('flyer-archivo'), { target: { files: [archivo('x.png', 'image/png', 10)] } })
    fireEvent.change(screen.getByLabelText('Título del flyer'), { target: { value: 'Nuevo lote' } })
    fireEvent.click(screen.getByTestId('flyer-guardar'))
    await waitFor(() => expect(guardar).toHaveBeenCalled())
    expect(screen.getByRole('alert')).toHaveTextContent(/Solo Dirección o Facturación/)
  })
  it('la lista muestra estado y a qué está ligado; pausar y eliminar van por sus comandos', async () => {
    const cambiar = vi.fn(async () => ({ ok: true as const, data: { ...F, activo: false, estado: 'pausado' as const } }))
    const eliminar = vi.fn(async () => ({ ok: true as const, data: true as const }))
    const listar = vi.fn(async () => ({ ok: true as const, data: [F, { ...F, id: 'F3', titulo: 'Promo Allergan', promocion_id: 'P1', promocion: 'Promo Allergan', product_id: null, producto: null, estado: 'terminado' as const, listas: ['L2'] }] }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Flyers listar={listar} cambiarEstado={cambiar} eliminar={eliminar} />)
    const f1 = await screen.findByTestId('flyer-F1'); const f3 = screen.getByTestId('flyer-F3')
    expect(f1).toHaveTextContent(/Vigente/); expect(f1).toHaveTextContent(/Botox 100 UI/)
    expect(f3).toHaveTextContent(/Terminado/); expect(f3).toHaveTextContent(/Promo: Promo Allergan · solo Mayoreo/)
    expect(f3.querySelector('[data-testid="flyer-pausar-F3"]')).toBeNull()   // terminado: no hay qué pausar
    fireEvent.click(screen.getByTestId('flyer-pausar-F1'))
    await waitFor(() => expect(cambiar).toHaveBeenCalledWith('F1', false))
    fireEvent.click(screen.getByTestId('flyer-eliminar-F1'))
    await waitFor(() => expect(eliminar).toHaveBeenCalledWith('F1'))
    expect(listar).toHaveBeenCalledTimes(3)
  })
})
