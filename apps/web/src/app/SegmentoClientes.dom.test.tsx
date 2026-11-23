// @vitest-environment jsdom
// SEG-CLI · mismo segmento en Dirección y en la cartera de Ventas: Verificados / Con portal sin verificar / Sin portal.
import React, { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FiltroSegmento, MarcaSegmento, contarSegmentos, filtrarSegmento, segmentoDe, type Segmento } from './SegmentoClientes'

const filas = [
  { n: 'Ana', portal: true, verificado: true },
  { n: 'Beto', portal: true, verificado: false },
  { n: 'Caro', portal: false, verificado: false },
  { n: 'Dani', portal: false, verificado: false },
]

describe('segmento de clientes', () => {
  it('sin portal nunca cuenta como verificado', () => {
    expect(segmentoDe({ portal: false, verificado: true })).toBe('sin_portal')
    expect(segmentoDe({ portal: true, verificado: true })).toBe('verificados')
    expect(segmentoDe({ portal: true, verificado: false })).toBe('por_verificar')
  })
  it('cuenta y filtra', () => {
    expect(contarSegmentos(filas, (f) => f)).toEqual({ todos: 4, verificados: 1, por_verificar: 1, sin_portal: 2 })
    expect(filtrarSegmento(filas, 'sin_portal', (f) => f).map((f) => f.n)).toEqual(['Caro', 'Dani'])
    expect(filtrarSegmento(filas, 'todos', (f) => f)).toHaveLength(4)
  })
  it('el filtro muestra los conteos y cambia de grupo; la marca dice el segmento', () => {
    function P() {
      const [s, setS] = useState<Segmento>('todos')
      return <><FiltroSegmento valor={s} onChange={setS} conteo={contarSegmentos(filas, (f) => f)} /><output data-testid="s">{s}</output></>
    }
    render(<P />)
    expect(screen.getByTestId('segmento-sin_portal').textContent).toMatch(/Sin portal \(2\)/)
    fireEvent.click(screen.getByTestId('segmento-verificados'))
    expect(screen.getByTestId('s').textContent).toBe('verificados')
    render(<MarcaSegmento datos={{ portal: true, verificado: false }} />)
    expect(screen.getByTestId('marca-por_verificar').textContent).toBe('Portal · sin verificar')
  })
})
