// @vitest-environment jsdom
// CX-ENLACE · tarjeta del enlace de contacto en Dirección: muestra el enlace único, lo copia y lo comparte.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { EnlaceContacto, EnlaceContactoBotones } from './EnlaceContacto'
import atencionSrc from '../screens/admin/AtencionComercial.tsx?raw'
import bandejaSrc from '../screens/admin/BandejaConversaciones.tsx?raw'
import asesoriasSrc from '../screens/chat/Asesorias.tsx?raw'

afterEach(cleanup)
describe('Enlace de contacto (Dirección)', () => {
  it('muestra el enlace, explica a quién le llega y lo copia', async () => {
    const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } })
    render(<EnlaceContacto url="https://renovacell.mx/contacto" />)
    expect(screen.getByTestId('enlace-contacto-url').textContent).toBe('https://renovacell.mx/contacto')
    expect(screen.getByTestId('enlace-contacto').textContent).toMatch(/un solo enlace para todos/)
    expect(screen.getByTestId('enlace-contacto').textContent).toMatch(/Dirección/)
    fireEvent.click(screen.getByTestId('enlace-contacto-copiar'))
    await waitFor(() => expect(screen.getByTestId('enlace-contacto-copiar').textContent).toMatch(/Copiado/))
    expect(writeText).toHaveBeenCalledWith('https://renovacell.mx/contacto')
  })
  it('compartir por WhatsApp lleva el texto de la marca y el enlace', () => {
    render(<EnlaceContacto url="https://renovacell.mx/contacto" />)
    const href = decodeURIComponent((screen.getByTestId('enlace-contacto-whatsapp') as HTMLAnchorElement).getAttribute('href') ?? '')
    expect(href).toBe('https://wa.me/?text=Renovacell · Tecnologías Antiedad. Chatea con un asesor: https://renovacell.mx/contacto')
    expect(href).not.toMatch(/sistema operativo/i)
  })
  it('vive en la Bandeja de Conversaciones, la pantalla de Dirección donde se asigna vendedor', () => {
    expect(atencionSrc).toMatch(/\{titulo\}<\/div>\s*\n\s*\{pestanas\.includes\('pendientes'\) && <EnlaceContacto \/>\}/)   // REORG CRM · vive en la Bandeja de Conversaciones (solicitudes)
  })
  // 29 oct 2026 (dueño: "el url ya no lo tiene a la mano nadie desde conversaciones"): siempre visible en el encabezado.
  it('la barra del enlace copia y comparte, y está en el encabezado de ambas bandejas', async () => {
    const writeText = vi.fn(async () => {}); Object.assign(navigator, { clipboard: { writeText } })
    render(<EnlaceContactoBotones url="https://renovacell.mx/contacto" />)
    fireEvent.click(screen.getByTestId('copiar-enlace'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://renovacell.mx/contacto'))
    expect(decodeURIComponent((screen.getByTestId('compartir-enlace-whatsapp') as HTMLAnchorElement).href)).toMatch(/Chatea con un asesor: https:\/\/renovacell\.mx\/contacto$/)
    expect(bandejaSrc).toMatch(/<div className="bq-head">[\s\S]{0,400}<EnlaceContactoBotones \/>/)
    expect(asesoriasSrc).toMatch(/Conversaciones con clientes<\/h2>[\s\S]{0,1200}<EnlaceContactoBotones \/>/)
  })
})
