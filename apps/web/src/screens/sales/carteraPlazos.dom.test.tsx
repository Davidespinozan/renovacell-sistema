// @vitest-environment jsdom
// CARTERA-PLAZO (3 nov 2026) · "Por vencer": mis clientes con los días que me quedan (urgencia por color) y la
// competencia del mes entre vendedores.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { CarteraPlazos } from './CarteraPlazos'
import { textoPlazo, textoSinCompra, tonoPlazo, type ClientePlazo } from '../../data/ops/carteraPlazos'

afterEach(cleanup)
const cli = (x: Partial<ClientePlazo>): ClientePlazo => ({ tipo: 'ficha', profile_id: null, customer_id: 'CU1', visitor_id: null, nombre: 'DRA. ANA PEREZ', telefono: '6691112233', dias_sin_compra: 175, dias_restantes: 5, vence: '2026-11-08', vendedor: null, ...x })

describe('Por vencer', () => {
  it('textos y urgencia', () => {
    expect(textoPlazo(5)).toBe('Le quedan 5 días'); expect(textoPlazo(1)).toBe('Le queda 1 día'); expect(textoPlazo(0)).toBe('Vence hoy')
    expect(textoSinCompra(0)).toBe('Asignado hoy'); expect(textoSinCompra(31)).toBe('31 días sin comprar')
    expect([tonoPlazo(7), tonoPlazo(20), tonoPlazo(90)]).toEqual(['dang', 'warn', 'neu'])
  })
  it('muestra la competencia (yo resaltado) y mis clientes por vencer con cómo hablarles', async () => {
    const plazos = vi.fn(async (d: number) => ({ plazo_dias: 180, clientes: d === 30 ? [cli({}), cli({ tipo: 'prospecto', customer_id: null, visitor_id: 'V1', nombre: 'WhatsApp …3188 · Yara', dias_restantes: 25, dias_sin_compra: 155 })] : [] }))
    const ranking = async () => [
      { vendedor: 'Roberto Ibarra', soy_yo: false, en_cartera: 1258, por_vencer_30: 40, compraron_mes: 12, rescatados_mes: 3, nuevos_mes: 5, perdidos_mes: 1 },
      { vendedor: 'Alejandra Cázarez', soy_yo: true, en_cartera: 601, por_vencer_30: 2, compraron_mes: 9, rescatados_mes: 4, nuevos_mes: 6, perdidos_mes: 0 },
    ]
    render(<CarteraPlazos plazos={plazos} ranking={ranking} />)
    const filas = await screen.findAllByTestId('ranking-fila')
    expect(filas[0]).toHaveTextContent('1. Roberto'); expect(filas[1]).toHaveTextContent('2. Tú'); expect(filas[1].className).toContain('yo')
    const items = await screen.findAllByTestId('plazo')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Le quedan 5 días'); expect(items[0]).toHaveTextContent('175 días sin comprar')
    expect(items[0].querySelector('[data-testid="plazo-dias"]')!.className).toContain('p-dang')
    expect(items[1]).toHaveTextContent('Prospecto'); expect(items[1].querySelector('[data-testid="plazo-dias"]')!.className).toContain('p-warn')
    expect((items[0].querySelector('a[href^="https://wa.me/526691112233"]') as HTMLAnchorElement)).toBeTruthy()
    fireEvent.click(screen.getByTestId('ventana-730'))
    await waitFor(() => expect(plazos).toHaveBeenCalledWith(730))
    expect(await screen.findByTestId('plazos-vacio')).toHaveTextContent('Tu cartera está vacía.')
  })
})
