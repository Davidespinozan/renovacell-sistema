// @vitest-environment jsdom
// «VENDER» RESALTADO (27 nov 2026, «sistema sencillo por rol»): en la barra inferior de Ventas, vender es el botón
// principal. Solo cambia cómo se ve; los destinos de la barra son los mismos.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const srv = vi.hoisted(() => ({ role: 'pos', setScreen: vi.fn() }))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: srv.role, screen: 'inicio', setScreen: srv.setScreen, capabilities: ['conversaciones'], verified: true }) }))
vi.mock('../data/store/carritoConteo', () => ({ usePiezasCarrito: () => 0 }))
import { BottomNav, BARRA_POR_ROL } from './BottomNav'

beforeEach(() => { cleanup(); srv.setScreen.mockReset(); srv.role = 'pos' })

describe('<BottomNav> · Ventas', () => {
  it('«Vender» es el botón principal y sigue abriendo la misma pantalla', () => {
    const { container } = render(<BottomNav onMenu={() => {}} />)
    const principales = container.querySelectorAll('a.bnav-principal')
    expect(principales).toHaveLength(1)
    expect(principales[0]).toHaveTextContent('Vender')
    fireEvent.click(principales[0])
    expect(srv.setScreen).toHaveBeenCalledWith('caja')
    expect(BARRA_POR_ROL.pos).toEqual(['inicio', 'asesorias', 'caja', 'clientes'])   // los destinos no cambiaron
    expect(screen.getByText('Menú')).toBeTruthy()
  })
  it('los demás roles no tienen botón resaltado', () => {
    for (const r of ['admin', 'warehouse', 'packing', 'driver', 'doctor']) {
      srv.role = r
      const { container, unmount } = render(<BottomNav onMenu={() => {}} />)
      expect(container.querySelector('a.bnav-principal'), r).toBeNull()
      unmount()
    }
  })
})
