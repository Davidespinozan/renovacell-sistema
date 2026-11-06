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

describe('PanelCliente · Mandar ubicación (pedido de Alejandra)', () => {
  it('manda la sucursal por el mismo chat', async () => {
    const c = falso([VINCULADA]); const enviar = vi.fn(async () => ({ ok: true, data: {} }))
    render(<PanelCliente conversationId="C1" cliente={c} chat={{ enviar } as unknown as ClienteChat} />)
    fireEvent.click(await screen.findByTestId('accion-ubicacion'))
    fireEvent.click(screen.getByTestId('ubic-sucursal'))
    await waitFor(() => expect(enviar).toHaveBeenCalled())
    expect(String((enviar.mock.calls[0] as unknown[])[1])).toMatch(/^📍 Renovacell · Sucursal Culiacán\nBoulevard Pedro Infante 2911/)
    expect(await screen.findByTestId('pc-msg')).toHaveTextContent('Le mandaste la ubicación.')
  })
  it('pega un enlace de Google Maps: sale con sus coordenadas y el nombre que escribió (también sin ficha)', async () => {
    const c = falso([{ vinculado: false, con_cuenta: false }]); const enviar = vi.fn(async () => ({ ok: true, data: {} }))
    render(<PanelCliente conversationId="C1" cliente={c} chat={{ enviar } as unknown as ClienteChat} />)
    fireEvent.click(await screen.findByTestId('accion-ubicacion'))
    fireEvent.change(screen.getByTestId('ubic-enlace'), { target: { value: 'https://www.google.com/maps/@24.8069,-107.3938,15z' } })
    expect(screen.getByTestId('ubic-lista')).toHaveTextContent('24.8069, -107.3938')
    fireEvent.change(screen.getByTestId('ubic-nombre'), { target: { value: 'Punto de entrega' } })
    fireEvent.click(screen.getByTestId('ubic-mandar'))
    await waitFor(() => expect(enviar).toHaveBeenCalled())
    expect(String((enviar.mock.calls[0] as unknown[])[1])).toBe('📍 Punto de entrega\nhttps://www.google.com/maps/search/?api=1&query=24.8069,-107.3938')
  })
  it('sin chat no aparece la acción', async () => {
    const c = falso([VINCULADA])
    render(<PanelCliente conversationId="C1" cliente={c} />)
    expect(await screen.findByText('Sin cuenta')).toBeInTheDocument()
    expect(screen.queryByTestId('accion-ubicacion')).toBeNull()
  })
})

describe('PanelCliente · Pasar a otro vendedor (dueño, caso Dra. Vea)', () => {
  const ROBERTO = { id: 'R', nombre: 'Roberto Ibarra' }, LUCIA = { id: 'L', nombre: 'Lucía · Ventas' }
  function conPase(fichas: FichaConversacion[], pasar = vi.fn(async () => ({ ok: true as const, data: { seller: 'R', vendedor_nombre: 'Roberto Ibarra', idempotente: false } }))) {
    const c = falso(fichas) as ReturnType<typeof falso> & { vendedoresTraspaso: ReturnType<typeof vi.fn>; pasar: typeof pasar }
    c.vendedoresTraspaso = vi.fn(async () => ({ ok: true as const, data: [LUCIA, ROBERTO] }))
    c.pasar = pasar
    return c
  }
  it('elige vendedor, escribe el motivo y la pasa; queda el aviso y se avisa el cambio', async () => {
    const c = conPase([{ vinculado: false, con_cuenta: false }]); const onCambio = vi.fn()
    render(<PanelCliente conversationId="C1" cliente={c} onCambio={onCambio} />)
    fireEvent.click(await screen.findByTestId('accion-pasar'))
    fireEvent.click(await screen.findByTestId('pasar-a-R'))
    expect(screen.getByTestId('pasar-confirmar')).toBeDisabled()   // sin motivo no se puede
    fireEvent.change(screen.getByTestId('pasar-motivo'), { target: { value: 'Ya es cliente de Roberto' } })
    fireEvent.click(screen.getByTestId('pasar-confirmar'))
    await waitFor(() => expect(c.pasar).toHaveBeenCalledWith('C1', 'R', 'Ya es cliente de Roberto'))
    expect(await screen.findByText(/Le pasaste la conversación a Roberto Ibarra/)).toBeInTheDocument()
    expect(onCambio).toHaveBeenCalled()
  })
  it('ya es cliente de otro vendedor: lo sugiere con el motivo prellenado', async () => {
    const c = conPase([{ ...VINCULADA, es_tuyo: false, vendedor: 'R', vendedor_nombre: 'Roberto Ibarra' }])
    render(<PanelCliente conversationId="C1" cliente={c} />)
    fireEvent.click(await screen.findByTestId('accion-pasar'))
    await waitFor(() => expect(screen.getByTestId('pasar-a-R')).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByTestId('pasar-motivo')).toHaveValue('Ya es cliente de Roberto Ibarra')
  })
  it('el servidor dice que no es suya: se muestra y no se pierde la hoja', async () => {
    const c = conPase([{ vinculado: false, con_cuenta: false }], vi.fn(async () => ({ ok: false as const, mensaje: 'Solo quien atiende la conversación puede pasarla (o Dirección).' })) as never)
    render(<PanelCliente conversationId="C1" cliente={c} />)
    fireEvent.click(await screen.findByTestId('accion-pasar'))
    fireEvent.click(await screen.findByTestId('pasar-a-L'))
    fireEvent.change(screen.getByTestId('pasar-motivo'), { target: { value: 'Le toca a Lucía' } })
    fireEvent.click(screen.getByTestId('pasar-confirmar'))
    expect(await screen.findByText(/Solo quien atiende la conversación/)).toBeInTheDocument()
    expect(screen.getByTestId('pc-hoja-pasar')).toBeInTheDocument()
  })
})
