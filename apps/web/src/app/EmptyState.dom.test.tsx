// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Vacio, Cargando, CargandoKpis } from './EmptyState'

afterEach(cleanup)

describe('EmptyState · receta única de vacío y carga', () => {
  it('Vacio: ícono, frase, pista y acción, con role=status y testid pasante', () => {
    render(<Vacio icono="search" titulo="Nada aquí." pista="Prueba otro filtro." accion={<button>Limpiar</button>} data-testid="v" />)
    const el = screen.getByTestId('v')
    expect(el).toHaveAttribute('role', 'status')
    expect(el.querySelector('.empty-ic svg')).not.toBeNull()
    expect(screen.getByText('Nada aquí.')).toBeInTheDocument()
    expect(screen.getByText('Prueba otro filtro.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpiar' })).toBeInTheDocument()
  })
  it('Cargando y CargandoKpis: esqueleto con aria-busy, sin texto visible', () => {
    const { container } = render(<><Cargando filas={3} etiqueta="Cargando pedidos…" /><CargandoKpis n={2} /></>)
    const estados = screen.getAllByRole('status')
    expect(estados).toHaveLength(2)
    expect(estados[0]).toHaveAttribute('aria-busy', 'true')
    expect(estados[0]).toHaveAttribute('aria-label', 'Cargando pedidos…')
    expect(container.querySelectorAll('.skel-row')).toHaveLength(3)
    expect(container.querySelectorAll('.skel-kpi')).toHaveLength(2)
    expect(container.textContent).toBe('')
  })
})
