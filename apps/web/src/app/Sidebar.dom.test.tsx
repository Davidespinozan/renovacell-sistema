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
    const { container } = renderWithRole(<Sidebar />)
    const nav = container.querySelector('nav.nav') as HTMLElement   // «Ventas» también es un botón de VER COMO (fuera del menú)
    expect(within(nav).queryByText('Por verificar')).toBeNull()
    const clientes = within(nav).getAllByText('Clientes').map((el) => el.closest('a')).filter(Boolean)
    expect(clientes).toHaveLength(1)
    expect(within(nav).getByText('Ventas').closest('a')).toBeTruthy()
  })

  it('MENÚ ORDENADO · Clientes y Conversaciones van en la misma sección; "Ventas" sigue bajo Mi trabajo', () => {
    const { container } = renderWithRole(<Sidebar />)
    const nav = container.querySelector('nav.nav') as HTMLElement
    expect(nav).toBeTruthy()
    const headers = Array.from(nav.querySelectorAll('.grp')).map((el) => el.textContent)
    expect(headers).toContain('Clientes y conversaciones'); expect(headers).toContain('Mi trabajo')
    expect(within(nav).getByText('Clientes', { selector: 'a *' }).closest('a')).toBeTruthy()
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
    expect(JSON.parse(localStorage.getItem('rc_sidebar_secciones_v2') ?? '{}').Finanzas).toBe(true)
    expect(screen.getByTestId('seccion-Clientes y conversaciones').getAttribute('aria-expanded')).toBe('true')   // MENÚ ORDENADO · Clientes y Conversaciones juntos, abierta por defecto
    expect(screen.queryAllByText('Clientes').filter((el) => el.closest('a'))).toHaveLength(1)
    // el Hub también se pliega (y la pantalla activa, Inicio, lo vuelve a abrir al navegar a él)
    fireEvent.click(screen.getByTestId('seccion-Hub Renovacell'))
    expect(screen.queryByText('Chat del equipo')).toBeNull()
  })
})

// MENÚ ORDENADO (dueño, 23 nov 2026): ninguna sección del menú de un rol de personal queda con una sola opción.
import { ROLES } from './roles'
describe('MENÚ ORDENADO · sin secciones de una sola opción', () => {
  for (const r of ROLES.filter((x) => x.isStaff)) it(r.key, () => {
    const conteo: Record<string, number> = {}
    for (const m of r.modules) { const h = m.section ?? r.group; conteo[h] = (conteo[h] ?? 0) + 1 }
    expect(Object.entries(conteo).filter(([, n]) => n < 2).map(([h]) => h)).toEqual([])
  })
})
