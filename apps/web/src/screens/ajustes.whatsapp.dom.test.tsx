// @vitest-environment jsdom
// IA mejor que el humano · E · el doctor conecta SU WhatsApp desde Ajustes: pide el código, se abre WhatsApp con el texto
// listo y, cuando llega, queda conectado (con su número enmascarado y la opción de desconectar). Al equipo no se le muestra.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { ClienteWhatsappVinculo } from '../data/ops/whatsappVinculo'

const rol = { role: 'doctor' }
vi.mock('../auth/RoleContext', () => ({ useRoleOpcional: () => rol }))
import { Ajustes } from './Ajustes'

beforeEach(() => { cleanup(); rol.role = 'doctor' })
const cliente = (vinculado = false): ClienteWhatsappVinculo => ({
  estado: vi.fn(async () => ({ ok: true as const, data: vinculado ? { vinculado: true, numero: '•••• 7799' } : { vinculado: false } })),
  codigo: vi.fn(async () => ({ ok: true as const, data: { codigo: 'RC-123456', expira_at: '', numero: '526671647799', enlace: 'https://wa.me/526671647799?text=Conectar%20mi%20WhatsApp%20RC-123456' } })),
  quitar: vi.fn(async () => ({ ok: true as const, data: { quitados: 1 } })),
})

describe('Ajustes · WhatsApp', () => {
  it('pide el código y ofrece abrir WhatsApp con el texto listo', async () => {
    const c = cliente()
    render(<Ajustes onClose={() => {}} estado={async () => 'activo'} vinculo={c} />)
    fireEvent.click(await screen.findByTestId('whatsapp-conectar'))
    expect(await screen.findByText('RC-123456')).toBeInTheDocument()
    expect(screen.getByText('Abrir WhatsApp con el código').getAttribute('href')).toContain('wa.me/526671647799')
  })
  it('conectado: número enmascarado y desconectar', async () => {
    const c = cliente(true)
    render(<Ajustes onClose={() => {}} estado={async () => 'activo'} vinculo={c} />)
    expect(await screen.findByText(/Tu WhatsApp \(•••• 7799\) está conectado/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('whatsapp-quitar'))
    await waitFor(() => expect(c.quitar).toHaveBeenCalled())
    expect(await screen.findByTestId('whatsapp-conectar')).toBeInTheDocument()
  })
  it('al equipo no se le muestra', async () => {
    rol.role = 'pos'
    render(<Ajustes onClose={() => {}} estado={async () => 'activo'} vinculo={cliente()} />)
    await screen.findByTestId('ajustes-avisos-activos')
    expect(screen.queryByTestId('ajustes-whatsapp')).toBeNull()
  })
})
