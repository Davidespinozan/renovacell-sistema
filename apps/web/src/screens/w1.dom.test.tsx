// @vitest-environment jsdom
// W1 · pantallas nuevas/adaptadas (modo mock): renderizan y respetan las reglas visibles.
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Devoluciones } from './warehouse/Devoluciones'
import { ControlInventario } from './admin/ControlInventario'
import { CancelOrderModal } from '../app/CancelOrderModal'
import { MermaModal } from './warehouse/MermaModal'

beforeEach(cleanup)

describe('<Devoluciones> (Almacén)', () => {
  it('muestra reingresos por confirmar y recepción de devoluciones', () => {
    renderWithRole(<Devoluciones />)
    expect(screen.getByText('Devoluciones y reingresos')).toBeInTheDocument()
    expect(screen.getByText(/Reingresos por confirmar/)).toBeInTheDocument()
    expect(screen.getByText(/Recibir devolución/)).toBeInTheDocument()
  })
})

describe('<ControlInventario> (Dirección)', () => {
  it('muestra disposición, conciliación y bajas de almacén', () => {
    renderWithRole(<ControlInventario />)
    expect(screen.getByText('Control de inventario')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Conciliación' }))
    expect(screen.getByText(/Conciliación lote ↔ kardex/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Bajas de almacén' }))
    expect(screen.getByText(/Bajas de almacén · últimos 30 días/)).toBeInTheDocument()
  })
})

describe('<CancelOrderModal>', () => {
  it('staff: el motivo es obligatorio antes de cancelar', () => {
    renderWithRole(<CancelOrderModal orderId="x" folio="S1" requireReason actor="Administración" onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Cancelar pedido' })
    expect(btn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('¿Por qué se cancela?'), { target: { value: 'Cliente desistió' } })
    expect(btn).not.toBeDisabled()
  })
  it('doctor: sin motivo', () => {
    renderWithRole(<CancelOrderModal orderId="x" folio="S1" requireReason={false} actor="Portal del Doctor" onClose={() => {}} />)
    expect(screen.queryByPlaceholderText('¿Por qué se cancela?')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancelar pedido' })).not.toBeDisabled()
  })
})

describe('<MermaModal>', () => {
  it('exige cantidad antes de dar de baja', () => {
    renderWithRole(<MermaModal lot={{ id: 'l1', lot_code: 'A1', quantity: 5 }} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /Dar de baja 0 u/ })).toBeDisabled()
  })
})
