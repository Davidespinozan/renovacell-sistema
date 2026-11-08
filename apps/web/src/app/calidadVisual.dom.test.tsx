// @vitest-environment jsdom
// CALIDAD VISUAL (7 nov 2026) · piezas nuevas: diálogos del sistema, menú «⋯», barras de pestañas y error con reintento.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { DialogosHost, confirmar, avisar, pedirTexto } from './dialogos'
import { MenuAcciones } from './MenuAcciones'
import { marcarBarra } from './barrasDesplazables'
import { ErrorCarga } from './EmptyState'

afterEach(cleanup)

describe('diálogos del sistema', () => {
  it('sin host usan el nativo (pruebas y pantallas sueltas no cambian)', async () => {
    const c = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(await confirmar('¿Seguro?')).toBe(true)
    expect(c).toHaveBeenCalledWith('¿Seguro?')
    c.mockRestore()
  })
  it('con host: confirmar (peligro en rojo), pedir texto y avisar', async () => {
    render(<DialogosHost />)
    let r1: Promise<boolean>; act(() => { r1 = confirmar('¿Eliminar el flyer?') })
    expect(await screen.findByTestId('dialogo')).toHaveTextContent('¿Eliminar el flyer?')
    expect(screen.getByTestId('dialogo-aceptar')).toHaveClass('dlg-peligro')
    fireEvent.click(screen.getByTestId('dialogo-aceptar'))
    await expect(r1!).resolves.toBe(true)
    let r2: Promise<string | null>; act(() => { r2 = pedirTexto('Motivo:', 'x') })
    const campo = await screen.findByLabelText('Motivo:')
    fireEvent.change(campo, { target: { value: 'sin stock' } })
    fireEvent.click(screen.getByTestId('dialogo-aceptar'))
    await expect(r2!).resolves.toBe('sin stock')
    let r3: Promise<boolean>; act(() => { r3 = confirmar('¿Aprobar?') })
    fireEvent.click(await screen.findByTestId('dialogo-cancelar'))
    await expect(r3!).resolves.toBe(false)
    let r4: Promise<void>; act(() => { r4 = avisar('Listo') })
    expect(await screen.findByText('Entendido')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Entendido'))
    await expect(r4!).resolves.toBeUndefined()
  })
})

describe('menú «⋯»', () => {
  it('abre, ordena lo destructivo al final y ejecuta', async () => {
    const borrar = vi.fn(); const editar = vi.fn()
    render(<MenuAcciones acciones={[{ etiqueta: 'Borrar', onElegir: borrar, peligro: true }, { etiqueta: 'Editar', onElegir: editar }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['Editar', 'Borrar'])
    expect(items[1]).toHaveClass('peligro')
    fireEvent.click(items[1])
    expect(borrar).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('barras de pestañas', () => {
  it('marca si hay más opciones a cada lado', () => {
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollWidth', { value: 600 }); Object.defineProperty(el, 'clientWidth', { value: 300 })
    el.scrollLeft = 0; marcarBarra(el); expect(el.getAttribute('data-mas')).toBe('der')
    el.scrollLeft = 150; marcarBarra(el); expect(el.getAttribute('data-mas')).toBe('ambos')
    el.scrollLeft = 300; marcarBarra(el); expect(el.getAttribute('data-mas')).toBe('izq')
  })
})

describe('error con reintento', () => {
  it('una sola receta: título, detalle y Reintentar', () => {
    const reintentar = vi.fn()
    render(<ErrorCarga titulo="No se pudo cargar el embudo" detalle="Sin conexión" onReintentar={reintentar} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el embudo')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(reintentar).toHaveBeenCalled()
  })
})
