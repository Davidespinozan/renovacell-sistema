// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RastreoEnvio } from './RastreoEnvio'
import type { Rastreo } from '../data/shipping/rastreo'

const base: Rastreo = { estado: 'en_reparto', descripcion: 'Con el repartidor', firmadoPor: null, entregadoAt: null, actualizadoAt: '2026-10-14T15:00:00Z',
  eventos: [{ at: '2026-10-14T15:00:00Z', codigo: 'WC', descripcion: 'Con el repartidor', lugar: 'Culiacán' }, { at: '2026-10-13T18:00:00Z', codigo: 'PU', descripcion: 'Recolectado', lugar: null }], aviso: null, cierre: null }
beforeEach(cleanup)

describe('<RastreoEnvio>', () => {
  it('sin rastreo no pinta nada (o "consultando" mientras carga)', () => {
    const { container } = render(<RastreoEnvio rastreo={null} cargando={false} />)
    expect(container.textContent).toBe('')
    cleanup(); render(<RastreoEnvio rastreo={null} cargando />)
    expect(screen.getByTestId('rastreo-cargando')).toBeTruthy()
  })
  it('personal: estado, descripción, historial plegable y botón de actualizar', () => {
    const act = vi.fn()
    render(<RastreoEnvio rastreo={base} cargando={false} onActualizar={act} />)
    expect(screen.getByTestId('rastreo-estado').textContent).toBe('En reparto')
    expect(screen.queryByTestId('rastreo-historial')).toBeNull()
    fireEvent.click(screen.getByTestId('rastreo-ver-historial'))
    expect(screen.getByTestId('rastreo-historial').querySelectorAll('li')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('rastreo-actualizar')); expect(act).toHaveBeenCalledTimes(1)
  })
  it('cliente: lenguaje para el cliente y sin botón de forzar', () => {
    render(<RastreoEnvio rastreo={base} cargando={false} onActualizar={() => {}} vista="cliente" />)
    expect(screen.getByTestId('rastreo-estado').textContent).toBe('Tu paquete sale a entrega hoy')
    expect(screen.queryByTestId('rastreo-actualizar')).toBeNull()
  })
  it('entregado: quién recibió; ya no ofrece actualizar', () => {
    render(<RastreoEnvio rastreo={{ ...base, estado: 'entregado', firmadoPor: 'JUAN PEREZ', entregadoAt: '2026-10-14T16:42:00Z' }} cargando={false} onActualizar={() => {}} />)
    expect(screen.getByText(/Recibió: JUAN PEREZ/)).toBeTruthy(); expect(screen.queryByTestId('rastreo-actualizar')).toBeNull()
  })
  it('sin movimientos: explica que el paquete sigue en el local; avisos del servidor visibles', () => {
    render(<RastreoEnvio rastreo={{ ...base, estado: 'sin_eventos', descripcion: null, eventos: [], aviso: 'La paquetería no respondió; se muestra lo último conocido.' }} cargando={false} />)
    expect(screen.getByText(/sigue en el local/)).toBeTruthy(); expect(screen.getByTestId('rastreo-aviso')).toBeTruthy()
  })
})
