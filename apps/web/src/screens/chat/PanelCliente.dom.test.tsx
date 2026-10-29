// @vitest-environment jsdom
// VINCULAR-CLIENTE · panel "Cliente": sugiere quién es, vincula, muestra la ficha y manda el acceso al portal por el chat.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PanelCliente } from './PanelCliente'
import type { ClienteExpediente, FichaConversacion } from '../../data/ops/expediente'
import type { ClienteChat } from '../../data/ops/chat'

vi.mock('../../data/ops/invitacion', () => ({ crearInvitacion: vi.fn(async () => ({ ok: true, data: { enlace: 'https://sistema.renovacell.mx/invitacion?t=abc', expira_at: '', nombre: 'Lourdes', email: null, telefono: null, correo: 'no_pedido' } })) }))
afterEach(cleanup)

const LOURDES = { customer_id: 'CU1', nombre: 'LOURDES VELAZQUEZ NAVARRETE', motivo: 'nombre' as const, telefono: '••••2562', ciudad: 'Tlalnepantla', tiene_cuenta: false, tu_cartera: false, vendedor: 'Roberto Ibarra' }
function falso(fichas: FichaConversacion[]) {
  let i = 0
  const c = {
    ficha: vi.fn(async () => ({ ok: true as const, data: fichas[Math.min(i++, fichas.length - 1)] })),
    sugerencias: vi.fn(async () => ({ ok: true as const, data: [LOURDES] })),
    vincular: vi.fn(async () => ({ ok: true as const, data: { customer_id: 'CU1', idempotente: false, numero_guardado: true, reasignada: true, vendedor: 'R', vendedor_nombre: 'Roberto Ibarra' } })),
    desvincular: vi.fn(async () => ({ ok: true as const, data: { idempotente: false } })),
  }
  return c as unknown as ClienteExpediente & typeof c
}
const VINCULADA: FichaConversacion = { vinculado: true, con_cuenta: false, customer_id: 'CU1', por: 'personal', nombre: 'LOURDES VELAZQUEZ NAVARRETE', ciudad: 'Tlalnepantla', tiene_cuenta: false, vendedor_nombre: 'Roberto Ibarra', es_tuyo: true, pedidos: 0, invitacion_vigente: false }

describe('PanelCliente', () => {
  it('sin ficha: sugiere por el nombre que escribió y la vincula guardando el número', async () => {
    const c = falso([{ vinculado: false, con_cuenta: false }, VINCULADA]); const onCambio = vi.fn()
    render(<PanelCliente conversationId="C1" cliente={c} onCambio={onCambio} />)
    expect(await screen.findByText('Lourdes Velazquez Navarrete')).toBeInTheDocument()
    expect(screen.getByText(/Por el nombre que escribió/)).toBeInTheDocument()
    expect(screen.getByText(/Cliente de Roberto Ibarra/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('pc-vincular'))
    await waitFor(() => expect(c.vincular).toHaveBeenCalledWith('C1', 'CU1', true))
    expect(await screen.findByTestId('pc-msg')).toHaveTextContent(/pasó a Roberto Ibarra/)
    expect(onCambio).toHaveBeenCalled()
  })
  it('vinculada y es suya: ficha y "Mandar acceso al portal" por el mismo chat', async () => {
    const c = falso([VINCULADA]); const enviar = vi.fn(async () => ({ ok: true, data: {} }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<PanelCliente conversationId="C1" cliente={c} chat={{ enviar } as unknown as ClienteChat} />)
    expect(await screen.findByText('Sin cuenta en el portal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('pc-acceso'))
    await waitFor(() => expect(enviar).toHaveBeenCalled())
    expect(String((enviar.mock.calls[0] as unknown[])[1])).toMatch(/Crea tu contraseña aquí: https:\/\/sistema\.renovacell\.mx\/invitacion\?t=abc/)
    expect(await screen.findByTestId('pc-msg')).toHaveTextContent(/Le mandaste su acceso/)
  })
  it('doctor con cuenta y sin ficha: no estorba (lo atiende Por verificar)', async () => {
    const c = falso([{ vinculado: false, con_cuenta: true }])
    const { container } = render(<PanelCliente conversationId="C1" cliente={c} />)
    await waitFor(() => expect(c.ficha).toHaveBeenCalled())
    expect(container.querySelector('[data-testid=panel-cliente]')).toBeNull()
  })
})
