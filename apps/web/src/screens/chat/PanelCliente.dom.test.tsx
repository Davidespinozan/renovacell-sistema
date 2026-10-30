// @vitest-environment jsdom
// VINCULAR-CLIENTE → EXPEDIENTE EN EL CHAT · franja, menú «+» y hojas: sugiere quién es, vincula, da de alta verificada,
// manda el acceso al portal, registra el pago con la foto del hilo y manda el recibo — todo dentro de la conversación.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { PanelCliente, accionesIneVisitante } from './PanelCliente'
import { elegirIne, ineDe } from '../../data/store/ineSeleccion'
import { cerrarHoja, hojaDe } from '../../data/store/hojaChat'
import type { ClientePagos, PedidoCliente } from '../../data/ops/pagoConversacion'
import type { ClienteExpediente, FichaConversacion } from '../../data/ops/expediente'
import type { ClienteChat } from '../../data/ops/chat'

vi.mock('../../data/ops/invitacion', () => ({ crearInvitacion: vi.fn(async () => ({ ok: true, data: { enlace: 'https://sistema.renovacell.mx/invitacion?t=abc', expira_at: '', nombre: 'Lourdes', email: null, telefono: null, correo: 'no_pedido' } })) }))
afterEach(() => { cleanup(); ['C1', 'C7', 'C8'].forEach(cerrarHoja) })

const LOURDES = { customer_id: 'CU1', nombre: 'LOURDES VELAZQUEZ NAVARRETE', motivo: 'nombre' as const, telefono: '••••2562', ciudad: 'Tlalnepantla', tiene_cuenta: false, tu_cartera: false, vendedor: 'Roberto Ibarra' }
function falso(fichas: FichaConversacion[]) {
  let i = 0
  const c = {
    ficha: vi.fn(async () => ({ ok: true as const, data: fichas[Math.min(i++, fichas.length - 1)] })),
    sugerencias: vi.fn(async () => ({ ok: true as const, data: [LOURDES] })),
    vincular: vi.fn(async () => ({ ok: true as const, data: { customer_id: 'CU1', idempotente: false, numero_guardado: true, reasignada: true, vendedor: 'R', vendedor_nombre: 'Roberto Ibarra' } })),
    desvincular: vi.fn(async () => ({ ok: true as const, data: { idempotente: false } })),
    alta: vi.fn(async () => ({ ok: true as const, data: { customer_id: 'CU9', nombre: 'Ana Gómez Ruiz', vendedor: 'A' } })),
  }
  return c as unknown as ClienteExpediente & typeof c
}
const VINCULADA: FichaConversacion = { vinculado: true, con_cuenta: false, customer_id: 'CU1', por: 'personal', nombre: 'LOURDES VELAZQUEZ NAVARRETE', ciudad: 'Tlalnepantla', tiene_cuenta: false, vendedor_nombre: 'Roberto Ibarra', es_tuyo: true, pedidos: 0, invitacion_vigente: false }

describe('PanelCliente', () => {
  it('sin ficha: sugiere por el nombre que escribió y la vincula guardando el número', async () => {
    const c = falso([{ vinculado: false, con_cuenta: false }, VINCULADA]); const onCambio = vi.fn()
    render(<PanelCliente conversationId="C1" cliente={c} onCambio={onCambio} />)
    // la franja ya dice a quién se parece; el menú «+» abre la hoja para vincular
    expect(await screen.findByText(/Puede ser Lourdes Velazquez Navarrete/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('accion-vincular'))
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
    render(<PanelCliente conversationId="C1" cliente={c} chat={{ enviar } as unknown as ClienteChat} />)
    expect(await screen.findByText('Sin cuenta')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('accion-acceso'))
    expect(screen.getByLabelText('Lo que le llega')).toHaveTextContent(/Hola Lourdes, te dejo tu acceso/)   // ve lo que le va a llegar
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
  it('no es cliente: alta verificada con sus datos y la INE marcada en el chat', async () => {
    const c = falso([{ vinculado: false, con_cuenta: false }, VINCULADA])
    render(<PanelCliente conversationId="C7" cliente={c} />)
    fireEvent.click(await screen.findByTestId('accion-alta'))
    fireEvent.change(screen.getByLabelText('Nombre completo'), { target: { value: 'Ana Gómez Ruiz' } })
    fireEvent.change(screen.getByLabelText('Cédula profesional'), { target: { value: '12345678' } })
    elegirIne('C7', 'frente', 'AD1')
    expect(await screen.findByText('INE frente ✓')).toBeInTheDocument()
    expect(screen.getByTestId('pc-alta-guardar')).toBeDisabled()   // sin confirmar que revisó su cédula e INE no se da de alta
    fireEvent.click(screen.getByTestId('pc-alta-revisado'))
    fireEvent.click(screen.getByTestId('pc-alta-guardar'))
    await waitFor(() => expect(c.alta).toHaveBeenCalledWith('C7', expect.objectContaining({ nombre: 'Ana Gómez Ruiz', cedula: '12345678', ineFrente: 'AD1' })))
    expect(await screen.findByTestId('pc-msg')).toHaveTextContent(/quedó dada de alta/)
  })
  it('pago desde la conversación: reporta con la foto marcada como comprobante y, validado, manda el recibo', async () => {
    const c = falso([VINCULADA])
    const base: PedidoCliente = { id: 'O1', folio: 'S1203', fecha: '2026-10-29T10:00:00Z', total: 2000, estado: 'pending_payment', saldo: 2000, cobrado: 0, estado_pago: 'pendiente', en_revision: false, ultimo_pago: null }
    const pagado: PedidoCliente = { ...base, saldo: 0, cobrado: 2000, ultimo_pago: { monto: 2000, fecha: '2026-10-29', metodo: 'transferencia' } }
    let lista = [base]
    const pagos = { pedidos: vi.fn(async () => ({ ok: true as const, data: lista })), reportar: vi.fn(async () => ({ ok: true as const, data: { status: 'applied' } })) }
    const enviar = vi.fn(async () => ({ ok: true, data: {} }))
    render(<PanelCliente conversationId="C8" cliente={c} pagos={pagos as unknown as ClientePagos} chat={{ enviar } as unknown as ClienteChat} />)
    await screen.findByTestId('accion-pago')
    // la conversación quedó marcada como ligada: debajo de sus fotos se ofrece "comprobante", no "INE"
    expect(ineDe('C8').vinculada).toBe(true)
    const { container } = render(<>{accionesIneVisitante('C8', ineDe('C8'), (lado, id, url) => elegirIne('C8', lado, id, url))({ actor: 'visitor', adjunto: { id: 'ADJ1', url: 'https://firmada/adj1' } })}</>)
    expect(container).toHaveTextContent('Usar como comprobante de pago')
    // tocar la foto abre la hoja del pago dentro del chat, con el único pedido por cobrar ya elegido y la foto puesta
    fireEvent.click(screen.getByText('Usar como comprobante de pago'))
    expect(hojaDe('C8')).toBe('pc:pago')
    await waitFor(() => expect(screen.getByTestId('pc-pago-enviar')).not.toBeDisabled())
    expect(screen.getByAltText('Comprobante')).toHaveAttribute('src', 'https://firmada/adj1')
    lista = [{ ...base, en_revision: true }]
    fireEvent.click(screen.getByTestId('pc-pago-enviar'))
    await waitFor(() => expect(pagos.reportar).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'O1', adjuntoId: 'ADJ1', amount: 2000, method: 'transferencia' })))
    expect(await screen.findByTestId('pc-msg')).toHaveTextContent(/Dirección lo valida/)
    expect(await screen.findByText(/pago en revisión/)).toBeInTheDocument()
    expect(hojaDe('C8')).toBeNull()
    expect(ineDe('C8').comprobante).toBeUndefined()
    cleanup()
    lista = [pagado]
    render(<PanelCliente conversationId="C8" cliente={falso([VINCULADA])} pagos={pagos as unknown as ClientePagos} chat={{ enviar } as unknown as ClienteChat} />)
    fireEvent.click(await screen.findByTestId('accion-recibo'))
    fireEvent.click(await screen.findByTestId('pc-recibo'))
    await waitFor(() => expect(enviar).toHaveBeenCalled())
    expect(String((enviar.mock.calls[0] as unknown[])[1])).toMatch(/^Hola Lourdes, recibimos tu pago de \$2,000.* del pedido S1203\. Tu pedido quedó pagado por completo\./)
  })
})
