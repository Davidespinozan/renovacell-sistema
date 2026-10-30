// @vitest-environment jsdom
// PERF · pantallas bajo demanda: cargan al abrirlas; si la descarga falla (versión nueva publicada) se pide actualizar
// en vez de recargar sola.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { lazyPantalla, PantallaDesactualizada } from './lazyPantalla'

afterEach(cleanup)
const conCarga = (el: React.ReactNode) => <React.Suspense fallback={<div>Cargando…</div>}>{el}</React.Suspense>

describe('lazyPantalla', () => {
  it('muestra la pantalla al terminar de descargarla, con sus props', async () => {
    const Hola = ({ nombre }: { nombre: string }) => <div>Hola {nombre}</div>
    const Perezosa = lazyPantalla(async () => Hola)
    render(conCarga(<Perezosa nombre="Alberto" />))
    expect(await screen.findByText('Hola Alberto')).toBeTruthy()
  })

  it('si la descarga falla, pide actualizar (no recarga sola)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Rota = lazyPantalla<React.FC>(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))
    render(conCarga(<Rota />))
    expect(await screen.findByTestId('pantalla-desactualizada')).toBeTruthy()
  })

  it('el botón Actualizar recarga solo cuando la persona lo pide', () => {
    const recargar = vi.fn()
    render(<PantallaDesactualizada recargar={recargar} />)
    expect(recargar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Actualizar'))
    expect(recargar).toHaveBeenCalledTimes(1)
  })
})
