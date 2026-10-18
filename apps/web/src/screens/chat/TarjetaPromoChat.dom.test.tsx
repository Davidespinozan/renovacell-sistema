// @vitest-environment jsdom
// PROMO-6 · El mensaje [promo:<id>] del chat se pinta como tarjeta (fotos, precio tachado, precio promo, escalones) mientras
// la promo siga vigente para el doctor; si ya no, se ve el texto de respaldo sin la marca.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { TarjetaPromoChat, limpiarCachePromos } from './TarjetaPromoChat'
import { renderizar } from '../../../../../supabase/functions/_shared/plantillas'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, supabase: { rpc: vi.fn() } }))
beforeEach(() => { cleanup(); limpiarCachePromos() })
const ID = '11111111-1111-4111-8111-111111111111'
const CONTENIDO = `[promo:${ID}]\nPromo Allergan (del 16 al 25 de octubre)\nBotox 100 UI: $4,000 · desde 5 pzas $3,800\nPrecios para profesionales verificados.`
const DATOS = { nombre: 'Promo Allergan', vigencia: 'del 16 al 25 de octubre', desde: '2026-10-16', hasta: '2026-10-25', lineas: [], productos: [
  { product_id: 'B', nombre: 'Botox 100 UI', imagen_url: 'https://img.test/botox.png', presentacion: 'Vial 100 UI', precio_normal: 4600, escalones: [{ desde: 1, precio: 4000 }, { desde: 5, precio: 3800 }, { desde: 10, precio: 3600 }] },
  { product_id: 'S', nombre: 'SkinVive', imagen_url: null, presentacion: null, precio_normal: 4500, escalones: [{ desde: 1, precio: 3600 }] },
] }

describe('PROMO-6 · tarjeta en el chat', () => {
  it('promo vigente: tarjeta con foto, precio normal tachado, precio promo y escalones; el botón va al catálogo', async () => {
    const ir = vi.fn()
    render(<TarjetaPromoChat content={CONTENIDO} cargar={async () => DATOS} onCatalogo={ir} />)
    const t = await screen.findByTestId('msg-promo')
    expect(t).toHaveTextContent(/Promo Allergan/); expect(t).toHaveTextContent(/Válida del 16 al 25 de octubre/)
    expect(screen.getAllByTestId('tarjeta-promo-producto')).toHaveLength(2)
    expect(t.querySelector('img')?.getAttribute('src')).toBe('https://img.test/botox.png')
    expect(t).toHaveTextContent(/\$4,600/); expect(t).toHaveTextContent(/\$4,000/); expect(t).toHaveTextContent(/Desde 5 pzas: \$3,800 · Desde 10 pzas: \$3,600/)
    fireEvent.click(screen.getByTestId('tarjeta-promo-catalogo')); expect(ir).toHaveBeenCalledTimes(1)
    expect(t).not.toHaveTextContent(/\[promo:/)
  })
  it('promo terminada o que no aplica: texto de respaldo sin la marca', async () => {
    render(<TarjetaPromoChat content={CONTENIDO} cargar={async () => null} />)
    const m = await screen.findByTestId('msg-system')
    expect(m).toHaveTextContent(/Promo Allergan \(del 16 al 25 de octubre\)/); expect(m).not.toHaveTextContent(/\[promo:/)
  })
  it('el correo de promoción lleva las fotos, el precio tachado, el precio promo y el botón; el texto plano también está completo', () => {
    const r = renderizar('promocion', DATOS as unknown as Record<string, unknown>, 'Dra. Ana')
    expect(r.asunto).toBe('Promo Allergan · del 16 al 25 de octubre')
    expect(r.html).toContain('https://img.test/botox.png'); expect(r.html).toContain('line-through'); expect(r.html).toContain('$4,600'); expect(r.html).toContain('$4,000'); expect(r.html).toContain('Desde 5 pzas: <b>$3,800</b>')
    expect(r.html).toContain('Ver el catálogo y pedir'); expect(r.html).toContain('Hola, Dra. Ana:'); expect(r.html).not.toMatch(/undefined|NaN/)
    expect(r.texto).toContain('Botox 100 UI: $4,000 · desde 5 pzas $3,800 · desde 10 pzas $3,600 (antes $4,600)')
  })
})
