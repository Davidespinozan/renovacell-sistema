// @vitest-environment jsdom
// SEG-CLI · mismo segmento en Dirección y en la cartera de Ventas: Verificados / Con portal sin verificar / Sin portal.
import React, { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FiltroSegmento, MarcaSegmento, contarSegmentos, filtrarSegmento, segmentoDe, type Segmento } from './SegmentoClientes'

const filas = [
  { n: 'Ana', portal: true, verificado: true },
  { n: 'Beto', portal: true, verificado: false },
  { n: 'Caro', portal: false, verificado: true },
  { n: 'Dani', portal: false, verificado: false },
]

describe('segmento de clientes', () => {
  it('verificado y portal son cosas distintas: el cliente de Odoo es verificado sin portal (por invitar)', () => {
    expect(segmentoDe({ portal: false, verificado: true })).toBe('por_invitar')
    expect(segmentoDe({ portal: false, verificado: false })).toBe('prospectos')
    expect(segmentoDe({ portal: true, verificado: true })).toBe('verificados')
    expect(segmentoDe({ portal: true, verificado: false })).toBe('por_verificar')
  })
  it('cuenta y filtra', () => {
    expect(contarSegmentos(filas, (f) => f)).toEqual({ todos: 4, verificados: 1, por_invitar: 1, por_verificar: 1, prospectos: 1 })
    expect(filtrarSegmento(filas, 'por_invitar', (f) => f).map((f) => f.n)).toEqual(['Caro'])
    expect(filtrarSegmento(filas, 'todos', (f) => f)).toHaveLength(4)
  })
  it('el filtro muestra los conteos y cambia de grupo; la marca dice el segmento', () => {
    function P() {
      const [s, setS] = useState<Segmento>('todos')
      return <><FiltroSegmento valor={s} onChange={setS} conteo={contarSegmentos(filas, (f) => f)} /><output data-testid="s">{s}</output></>
    }
    render(<P />)
    expect(screen.getByTestId('segmento-por_invitar').textContent).toMatch(/por invitar\) \(1\)/)
    fireEvent.click(screen.getByTestId('segmento-verificados'))
    expect(screen.getByTestId('s').textContent).toBe('verificados')
    render(<MarcaSegmento datos={{ portal: true, verificado: false }} />)
    expect(screen.getByTestId('marca-por_verificar').textContent).toBe('Portal · sin verificar')
  })
})
