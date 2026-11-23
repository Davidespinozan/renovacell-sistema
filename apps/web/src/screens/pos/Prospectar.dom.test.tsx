// @vitest-environment jsdom
// PROSPECTAR · registrar al prospecto → su primer WhatsApp (presentación sugerida) → su conversación; si no escribe aún,
// puede llamarle o dejarlo (ya quedó en su cartera).
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({ setScreen: vi.fn(), irA: vi.fn(), sugerida: '' as string | undefined }))
vi.mock('../../auth/RoleContext', () => ({ useRoleOpcional: () => ({ setScreen: h.setScreen, user: { name: 'Ale' } }) }))
vi.mock('../../data/store/navIntentStore', () => ({ irAConversacion: (...a: unknown[]) => h.irA(...a) }))
vi.mock('./AltaCliente', () => ({
  avisoAlta: (p: { nombre: string }) => `${p.nombre} quedó en tu cartera. Está en tu Embudo como «Primer contacto».`,
  AltaClienteForm: ({ onListo }: { onListo: (p: unknown) => void }) => (
    <button type="button" data-testid="fake-registrar" onClick={() => onListo({ customer_id: 'c1', nombre: 'Dra. Ana', status: 'creado', celular: '6671234567', faltas: [] })}>registrar</button>),
}))
vi.mock('../chat/EscribirWhatsApp', () => ({
  EscribirWhatsApp: ({ cliente, onCerrar, onListo, sugerida }: { cliente: { nombre: string } | null; onCerrar: () => void; onListo: (c: string, v: boolean) => void; sugerida?: string }) => {
    h.sugerida = sugerida
    return cliente ? <div data-testid="fake-wa">WhatsApp a {cliente.nombre}
      <button type="button" data-testid="fake-wa-mandar" onClick={() => onListo('conv-1', false)}>mandar</button>
      <button type="button" data-testid="fake-wa-cerrar" onClick={onCerrar}>cerrar</button></div> : null
  },
}))
import { Prospectar, PLANTILLA_PRESENTACION } from './Prospectar'

beforeEach(() => { h.irA.mockReset() })

describe('Prospectar', () => {
  it('registra y abre el WhatsApp con la presentación; al mandarlo abre su conversación', () => {
    const cerrar = vi.fn()
    render(<Prospectar abierto onCerrar={cerrar} />)
    fireEvent.click(screen.getByTestId('fake-registrar'))
    expect(screen.getByTestId('fake-wa').textContent).toMatch(/Dra\. Ana/)
    expect(h.sugerida).toBe(PLANTILLA_PRESENTACION)
    fireEvent.click(screen.getByTestId('fake-wa-mandar'))
    expect(h.irA).toHaveBeenCalledWith(h.setScreen, 'conv-1', { origen: 'inicio' })
    expect(cerrar).toHaveBeenCalled()
  })
  it('si no le escribe aún: queda en su cartera, puede llamarle o volver al WhatsApp', () => {
    render(<Prospectar abierto onCerrar={() => {}} />)
    fireEvent.click(screen.getByTestId('fake-registrar'))
    fireEvent.click(screen.getByTestId('fake-wa-cerrar'))
    expect(screen.getByTestId('prospectar-aviso').textContent).toMatch(/quedó en tu cartera.*Primer contacto/)
    expect(screen.getByTestId('prospectar-llamar').getAttribute('href')).toBe('tel:+526671234567')
    fireEvent.click(screen.getByTestId('prospectar-whatsapp'))
    expect(screen.getByTestId('fake-wa')).toBeTruthy()
  })
})
