// @vitest-environment jsdom
// IA-VENDEDORA · ficha del producto en el catálogo: escalera de precio (pieza, medio mayoreo, mayoreo, promoción y si se
// junta), ficha técnica aprobada o "en preparación", sin precio sin verificar, "Preguntar" abre el chat con la pregunta.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FichaProducto, escalera } from './FichaProducto'
import { EVENTO_ABRIR_CHAT, tomarBorrador } from '../../data/store/chatUiStore'
import { resumenInteres } from '../../data/ops/actividadCatalogo'
import type { VolumeRule } from '../../data/ops/volumePricing'
import type { ProductSafe } from '../../data/types'

afterEach(cleanup)
const P = { id: 'P1', name: 'Nabota 100', category: 'Toxinas', image_url: null, price: 1300, sellable: true } as unknown as ProductSafe
const R: VolumeRule[] = [
  { product_id: 'P1', min_quantity: 10, price: 1170, active: true, nivel: 'medio' },
  { product_id: 'P1', min_quantity: 50, price: 800, active: true, nivel: 'mayoreo' },
  { product_id: 'P1', min_quantity: 5, price: 1100, active: true, promo: { nombre: 'Promo Otoño', hasta: '2026-11-15' } },
]

describe('escalera de precio', () => {
  it('pieza, medio mayoreo (se junta), mayoreo (todo el pedido) y promoción con fecha', () => {
    const e = escalera(1300, R, 'P1')
    expect(e.map((x) => [x.etiqueta, x.desde, x.precio])).toEqual([['Pieza', 1, 1300], ['Medio mayoreo', 10, 1170], ['Mayoreo', 50, 800], ['Promo Otoño', 5, 1100]])
    expect(e[1].nota).toMatch(/juntar piezas con otros productos de 10/)
    expect(e[2].nota).toMatch(/todo tu pedido pasa a mayoreo/)
    expect(e[3].nota).toBe('promoción · hasta el 15 nov')
  })
})

describe('ficha', () => {
  const leerCon = (conocimiento: Record<string, { nivel: string; contenido: string }>) => vi.fn(async () => ({ product_id: 'P1', nombre: 'Nabota 100', categoria: null, familia: null, presentacion: null, imagen_url: null, folleto_url: null, conocimiento, disclaimers: [], audiencia: 'verified' }))
  it('verificado: escalera y secciones aprobadas en orden de lectura', async () => {
    render(<FichaProducto p={P} precio={1300} verificado reglas={R} qty={0} puedeAgregar onAdd={() => {}} onDec={() => {}} onClose={() => {}}
      leer={leerCon({ composicion: { nivel: 'T1', contenido: 'Toxina botulínica tipo A 100 U' }, resumen: { nivel: 'T0', contenido: 'Toxina de Daewoong' } })} />)
    expect(screen.getByTestId('ficha-escalera')).toHaveTextContent('Mayoreo · desde 50 piezas')
    const sec = await screen.findByTestId('ficha-secciones')
    expect(sec.textContent!.indexOf('Qué es')).toBeLessThan(sec.textContent!.indexOf('Composición'))
  })
  it('sin ficha aprobada: "en preparación"; sin verificar: sin precios', async () => {
    render(<FichaProducto p={P} precio={null} verificado={false} reglas={R} qty={0} puedeAgregar onAdd={() => {}} onDec={() => {}} onClose={() => {}} leer={leerCon({})} />)
    expect(await screen.findByTestId('ficha-en-preparacion')).toBeTruthy()
    expect(screen.getByTestId('ficha-sin-precio')).toBeTruthy()
    expect(screen.queryByTestId('ficha-escalera')).toBeNull()
    expect(screen.queryByTestId('ficha-agregar')).toBeNull()
  })
  it('"Preguntar por este producto" abre el chat con la pregunta escrita', async () => {
    const abrir = vi.fn(); window.addEventListener(EVENTO_ABRIR_CHAT, abrir)
    const cerrar = vi.fn()
    render(<FichaProducto p={P} precio={1300} verificado reglas={R} qty={0} puedeAgregar onAdd={() => {}} onDec={() => {}} onClose={cerrar} leer={leerCon({})} />)
    fireEvent.click(screen.getByTestId('ficha-preguntar'))
    expect(abrir).toHaveBeenCalled(); expect(cerrar).toHaveBeenCalled()
    expect(tomarBorrador()).toBe('Hola, me interesa Nabota 100. ¿Me das más información?')
    expect(tomarBorrador()).toBeNull()   // se toma una sola vez
    window.removeEventListener(EVENTO_ABRIR_CHAT, abrir)
  })
})

describe('lado del vendedor', () => {
  it('resumen corto de lo que buscó y miró', () => {
    expect(resumenInteres([
      { tipo: 'ficha', product_id: 'P1', producto: 'Nabota 100', termino: null, cuando: '', veces: 3 },
      { tipo: 'busqueda', product_id: null, producto: null, termino: 'botox', cuando: '', veces: 1 },
      { tipo: 'sin_resultados', product_id: null, producto: null, termino: 'exosomas', cuando: '', veces: 1 },
    ])).toBe('vio Nabota 100 (3) · buscó «botox» · buscó «exosomas» sin resultados')
  })
})
