// @vitest-environment jsdom
// Regresión de navegación: el sidebar de Administración DEBE renderizar "Por verificar"
// (av_verif) dentro de la sección Comercial, sin perder "Doctores" (av_doc = directorio).
// Este guard existe porque el ítem estaba en roles.ts/registry pero se reportó ausente en
// producción; se confirmó que NO es un bug de render (el código sí lo dibuja) sino de deploy.
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { Sidebar } from './Sidebar'

describe('<Sidebar> admin — navegación Comercial', () => {
  it('renderiza "Por verificar" (av_verif) y conserva "Doctores" (av_doc)', () => {
    renderWithRole(<Sidebar />)
    // RoleProvider arranca en rol admin → el nav de Administración se dibuja.
    const porVerificar = screen.getByText('Por verificar')
    expect(porVerificar).toBeTruthy()
    // Debe seguir existiendo el directorio comercial "Doctores" como entrada aparte.
    expect(screen.getByText('Doctores')).toBeTruthy()
    // Son dos enlaces distintos (no se fusionó ni se duplicó la navegación).
    expect(screen.getByText('Por verificar')).not.toBe(screen.getByText('Doctores'))
  })

  it('"Por verificar" vive bajo el encabezado de sección Comercial', () => {
    const { container } = renderWithRole(<Sidebar />)
    const nav = container.querySelector('nav.nav') as HTMLElement
    expect(nav).toBeTruthy()
    const headers = Array.from(nav.querySelectorAll('.grp')).map((el) => el.textContent)
    expect(headers).toContain('Comercial')
    // El enlace es un <a role="button"> con su etiqueta (patrón del Sidebar).
    const link = within(nav).getByText('Por verificar').closest('a')
    expect(link).toBeTruthy()
    expect(link?.getAttribute('role')).toBe('button')
  })
})
