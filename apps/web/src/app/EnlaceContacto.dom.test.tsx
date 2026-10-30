// @vitest-environment jsdom
// CX-ENLACE → ENLACE-VENDEDOR · Dirección ve el enlace general y el de cada vendedor con sus cifras; cada vendedor tiene a la
// mano SU enlace en el encabezado de Conversaciones, para copiarlo o compartirlo.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { EnlaceContacto, EnlaceContactoBotones } from './EnlaceContacto'
import atencionSrc from '../screens/admin/AtencionComercial.tsx?raw'
import bandejaSrc from '../screens/admin/BandejaConversaciones.tsx?raw'
import asesoriasSrc from '../screens/chat/Asesorias.tsx?raw'

const rol = vi.hoisted(() => ({ actual: { role: 'admin', user: { name: 'Antonio' } } as { role: string; user: { name: string } } | null }))
vi.mock('../auth/RoleContext', () => ({ useRoleOpcional: () => rol.actual }))
const enlaces = vi.hoisted(() => ({
  miEnlace: vi.fn(async () => ({ tipo: 'vendedor', codigo: 'roberto-ibarra', cifras: { visitas: 9, contactos: 4, cuentas: 1 } })),
  enlacesEquipo: vi.fn(async () => [{ seller: 'S1', nombre: 'Roberto Ibarra', codigo: 'roberto-ibarra', cifras: { visitas: 9, contactos: 4, cuentas: 1 } }]),
}))
vi.mock('../data/ops/enlaces', async (orig) => ({ ...(await orig<typeof import('../data/ops/enlaces')>()), ...enlaces }))

afterEach(cleanup)
describe('Enlaces del chat', () => {
  it('Dirección: enlace general, el de cada vendedor con sus cifras, y a quién le llega cada conversación', async () => {
    const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } })
    render(<EnlaceContacto url="https://renovacell.mx/contacto" />)
    expect(screen.getByTestId('enlace-contacto-url').textContent).toBe('https://renovacell.mx/contacto')
    const equipo = await screen.findByTestId('enlaces-equipo')
    expect(equipo).toHaveTextContent('Roberto Ibarra'); expect(equipo).toHaveTextContent('renovacell.mx/contacto/roberto-ibarra')
    expect(equipo).toHaveTextContent('9 visitas · 4 contactos · 1 con cuenta')
    expect(screen.getByTestId('enlace-contacto').textContent).toMatch(/gana la cartera/)
    fireEvent.click(screen.getByTestId('enlace-contacto-copiar'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://renovacell.mx/contacto'))
  })
  it('vive en la Bandeja de Conversaciones, la pantalla de Dirección donde se asigna vendedor', () => {
    expect(atencionSrc).toMatch(/\{titulo\}<\/div>\s*\n\s*\{pestanas\.includes\('pendientes'\) && <EnlaceContacto \/>\}/)
  })
  it('el vendedor tiene SU enlace en el encabezado: lo copia y lo comparte presentándose', async () => {
    rol.actual = { role: 'pos', user: { name: 'Roberto Ibarra' } }
    const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } })
    render(<EnlaceContactoBotones />)
    expect(await screen.findByTestId('mi-enlace-cifras')).toHaveTextContent('4 contactos')
    expect(screen.getByTestId('enlace-contacto-barra')).toHaveTextContent('Tu enlace')
    fireEvent.click(screen.getByTestId('copiar-enlace'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/contacto\/roberto-ibarra$/)))
    fireEvent.click(screen.getByTestId('compartir-enlace'))   // sin hoja nativa (jsdom): copia el mensaje completo
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^Hola, soy Roberto Ibarra, asesor de Renovacell/)))
    expect(bandejaSrc).toMatch(/<div className="bq-head">[\s\S]{0,400}<EnlaceContactoBotones \/>/)
    expect(asesoriasSrc).toMatch(/Conversaciones con clientes<\/h2>[\s\S]{0,1200}<EnlaceContactoBotones \/>/)
    rol.actual = { role: 'admin', user: { name: 'Antonio' } }
  })
})
