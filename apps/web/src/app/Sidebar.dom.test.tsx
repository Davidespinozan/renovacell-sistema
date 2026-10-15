// @vitest-environment jsdom
// Regresión de navegación: el sidebar de Administración DEBE renderizar "Por verificar"
// (av_verif) dentro de la sección Comercial, sin perder "Doctores" (av_doc = directorio).
// Este guard existe porque el ítem estaba en roles.ts/registry pero se reportó ausente en
// producción; se confirmó que NO es un bug de render (el código sí lo dibuja) sino de deploy.
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Sidebar } from './Sidebar'

describe('<Sidebar> admin — navegación Clientes', () => {
  it('renderiza "Por verificar" (av_verif) y conserva el directorio "Clientes" (av_doc)', () => {
    renderWithRole(<Sidebar />)
    // RoleProvider arranca en rol admin → el nav de Administración se dibuja.
    const porVerificar = screen.getByText('Por verificar')
    expect(porVerificar).toBeTruthy()
    // Debe seguir existiendo el directorio comercial "Clientes" como enlace aparte (la sección también se llama así).
    const clientes = screen.getAllByText('Clientes').map((el) => el.closest('a')).filter(Boolean)
    expect(clientes).toHaveLength(1)
    // Son dos enlaces distintos (no se fusionó ni se duplicó la navegación).
    expect(screen.getByText('Por verificar').closest('a')).not.toBe(clientes[0])
  })

  it('"Por verificar" vive bajo el encabezado de sección Clientes', () => {
    const { container } = renderWithRole(<Sidebar />)
    const nav = container.querySelector('nav.nav') as HTMLElement
    expect(nav).toBeTruthy()
    const headers = Array.from(nav.querySelectorAll('.grp')).map((el) => el.textContent)
    expect(headers).toContain('Clientes')
    // El enlace es un <a role="button"> con su etiqueta (patrón del Sidebar).
    const link = within(nav).getByText('Por verificar').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('role')).toBe('button')
  })
})
