// @vitest-environment jsdom
// Regresión de navegación: el sidebar de Administración DEBE renderizar "Por verificar"
// (av_verif) dentro de la sección Comercial, sin perder "Doctores" (av_doc = directorio).
// Este guard existe porque el ítem estaba en roles.ts/registry pero se reportó ausente en
// producción; se confirmó que NO es un bug de render (el código sí lo dibuja) sino de deploy.
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Sidebar } from './Sidebar'

beforeEach(() => { try { localStorage.clear() } catch { /* sin almacenamiento */ } })

describe('<Sidebar> admin — navegación Clientes', () => {
  // MENÚ AGRUPADO (dueño, 17 oct 2026): "Por verificar" ya no es entrada del menú: es pestaña dentro de "Clientes"
  // (g_clientes); Clientes y Ventas NO van en la misma sección (Ventas vive en Mi trabajo).
  it('renderiza UNA entrada "Clientes" (g_clientes) y ninguna "Por verificar" suelta', () => {
    renderWithRole(<Sidebar />)
    expect(screen.queryByText('Por verificar')).toBeNull()
    const clientes = screen.getAllByText('Clientes').map((el) => el.closest('a')).filter(Boolean)
    expect(clientes).toHaveLength(1)
    expect(screen.getByText('Ventas').closest('a')).toBeTruthy()
  })

  it('"Clientes" vive bajo el encabezado de sección Clientes y "Ventas" bajo Mi trabajo', () => {
    const { container } = renderWithRole(<Sidebar />)
    const nav = container.querySelector('nav.nav') as HTMLElement
    expect(nav).toBeTruthy()
    const headers = Array.from(nav.querySelectorAll('.grp')).map((el) => el.textContent)
    expect(headers).toContain('Clientes'); expect(headers).toContain('Mi trabajo')
    const link = within(nav).getByText('Ventas').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('role')).toBe('button')
  })
})

describe('<Sidebar> · secciones plegables (como en CuboPolar)', () => {
  it('Dirección arranca con Mi trabajo, Clientes y Conversaciones abiertas y Finanzas plegada; picar el encabezado la abre y se recuerda', () => {
    renderWithRole(<Sidebar />)
    expect(screen.getByText('Tablero')).toBeTruthy(); expect(screen.getByText('Conversaciones', { selector: 'a *' })).toBeTruthy()
    expect(screen.queryByText('Cobros')).toBeNull()
    const fin = screen.getByTestId('seccion-Finanzas')
    expect(fin.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(fin)
    expect(screen.getByText('Cobros')).toBeTruthy(); expect(fin.getAttribute('aria-expanded')).toBe('true')
    expect(JSON.parse(localStorage.getItem('rc_sidebar_secciones') ?? '{}').Finanzas).toBe(true)
    fireEvent.click(screen.getByTestId('seccion-Clientes'))
    expect(screen.queryAllByText('Clientes').filter((el) => el.closest('a'))).toHaveLength(0)
    // el Hub también se pliega (y la pantalla activa, Inicio, lo vuelve a abrir al navegar a él)
    fireEvent.click(screen.getByTestId('seccion-Hub Renovacell'))
    expect(screen.queryByText('Chat del equipo')).toBeNull()
  })
})
