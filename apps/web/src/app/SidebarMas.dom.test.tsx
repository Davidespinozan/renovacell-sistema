// @vitest-environment jsdom
// MENÚ CORTO · «Más» arranca cerrada, se abre con un toque y el sistema lo recuerda; lo de almacén siempre a la vista.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ screen: 'inicio' }))
vi.mock('../auth/RoleContext', () => ({ useRole: () => ({ role: 'warehouse', screen: h.screen, setScreen: vi.fn(), user: { name: 'Alberto', email: 'a@x' }, logout: vi.fn(),
  capabilities: ['anuncios', 'contenido', 'eventos', 'diseno', 'stryv_care'], vistaPrevia: null, verComo: vi.fn(), multirol: false }) }))
import { Sidebar } from './Sidebar'

beforeEach(() => { cleanup(); h.screen = 'inicio'; try { localStorage.clear() } catch { /* sin almacenamiento */ } })

describe('<Sidebar> Almacén · sección «Más»', () => {
  it('al entrar: Pedidos, Inventario y Entradas a la vista; lo de «Más» oculto', () => {
    render(<Sidebar />)
    for (const t of ['Pedidos', 'Inventario', 'Entradas']) expect(screen.getByText(t)).toBeTruthy()
    const mas = screen.getByTestId('seccion-Más')
    expect(mas.getAttribute('aria-expanded')).toBe('false')
    for (const t of ['Promociones', 'Catálogo y sitio', 'Eventos', 'Diseño']) expect(screen.queryByText(t)).toBeNull()
    fireEvent.click(mas)
    for (const t of ['Promociones', 'Catálogo y sitio', 'Eventos', 'Diseño']) expect(screen.getByText(t)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('rc_sidebar_secciones_v2') ?? '{}')['Más']).toBe(true)
  })
  it('si está parado en una pantalla de «Más», la sección se abre sola', () => {
    h.screen = 'g_eventos'
    render(<Sidebar />)
    expect(screen.getByTestId('seccion-Más').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Eventos')).toBeTruthy()
  })
})
