// @vitest-environment jsdom
// FIRMA DE ENTREGA · un toque no firma; un trazo sí entrega la firma; «Borrar» la quita.
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FirmaEntrega, MIN_PUNTOS } from './FirmaEntrega'

describe('FirmaEntrega', () => {
  it('un toque accidental no cuenta; un trazo sí; borrar la quita', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} })) as never
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['x'], { type: 'image/png' })) }
    const onCambio = vi.fn()
    render(<FirmaEntrega onCambio={onCambio} />)
    const c = screen.getByTestId('firma-lienzo')
    fireEvent.pointerDown(c, { clientX: 5, clientY: 5 }); fireEvent.pointerUp(c)
    expect(onCambio).not.toHaveBeenCalled()
    fireEvent.pointerDown(c, { clientX: 5, clientY: 5 })
    for (let i = 0; i <= MIN_PUNTOS; i++) fireEvent.pointerMove(c, { clientX: 5 + i * 3, clientY: 5 + i })
    fireEvent.pointerUp(c)
    await vi.waitFor(() => expect(onCambio).toHaveBeenCalledWith(expect.any(File)))
    expect(screen.getByText('Firma lista')).toBeTruthy()
    fireEvent.click(screen.getByTestId('firma-borrar'))
    expect(onCambio).toHaveBeenLastCalledWith(null)
  })
})
