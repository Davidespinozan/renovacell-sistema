// @vitest-environment jsdom
// W4-05/07 · MENSAJES AL CLIENTE — la pantalla nunca dice más de lo que el servidor sabe.
//
// Lo que se protege: que "enviado" aparezca solo con confirmación, que un corte se vea
// como "sin confirmar" (ni éxito ni fracaso), que sin proveedor activado se diga que NO
// se envió nada, y que reenviar algo que quizá llegó exija una decisión explícita.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { MensajeCliente } from '../../data/ops/comunicaciones'

const m = (p: Partial<MensajeCliente>): MensajeCliente => ({
  id: 'm1', event_key: 'pedido_recibido:o1', plantilla: 'pedido_recibido', order_id: 'o1',
  to_address: 'dra@clinica.mx', to_name: 'Dra. Ana', status: 'pendiente', attempts: 0,
  last_error: null, sent_at: null, created_at: '2026-10-05T10:00:00Z', payload: { folio: 'S123456' }, ...p,
})

const mocks = vi.hoisted(() => ({ cargarMensajes: vi.fn(), despacharMensajes: vi.fn(), reintentarMensaje: vi.fn() }))
vi.mock('../../data/ops/comunicaciones', async (orig) => {
  const real = await orig<typeof import('../../data/ops/comunicaciones')>()
  return { ...real, ...mocks }
})

import { Comunicaciones } from './Comunicaciones'

const BUZON = [
  m({ id: 'a', status: 'pendiente', plantilla: 'pago_recibido' }),
  m({ id: 'b', status: 'enviado', sent_at: '2026-10-05T10:01:00Z', plantilla: 'pedido_recibido' }),
  m({ id: 'c', status: 'incierto', plantilla: 'pedido_enviado', last_error: 'timeout' }),
  m({ id: 'd', status: 'fallido', plantilla: 'pedido_entregado', last_error: 'rechazado 422' }),
  m({ id: 'e', status: 'sin_destinatario', to_address: null, plantilla: 'pedido_cancelado' }),
]

beforeEach(() => {
  cleanup()
  for (const x of Object.values(mocks)) x.mockReset()
  mocks.cargarMensajes.mockResolvedValue({ data: BUZON, error: null })
  mocks.despacharMensajes.mockResolvedValue({ ok: true, procesados: 1, enviado: 1, fallido: 0, incierto: 0 })
  mocks.reintentarMensaje.mockResolvedValue({ ok: true })
})

describe('los estados dicen lo que el servidor sabe', () => {
  it('abre en "requieren atención": lo incierto, lo rechazado y lo que no tiene correo', async () => {
    render(<Comunicaciones />)
    expect(await screen.findByText('Sin confirmar')).toBeInTheDocument()
    expect(screen.getByText('No se envió')).toBeInTheDocument()
    expect(screen.getByText('Sin correo')).toBeInTheDocument()
    // Lo enviado y lo pendiente no están en esta vista.
    expect(screen.queryByText('Enviado')).toBeNull()
  })

  it('un corte se muestra como "sin confirmar": ni enviado ni fracasado', async () => {
    render(<Comunicaciones />)
    const fila = (await screen.findByText('Pedido en camino')).closest('tr') as HTMLElement
    expect(fila.textContent).toContain('Sin confirmar')
    expect(fila.textContent).toContain('No se sabe si llegó')
    expect(fila.textContent).not.toContain('Enviado')
    expect(fila.textContent).not.toContain('No se envió')
  })

  it('el contador distingue por enviar, enviados y con problema', async () => {
    render(<Comunicaciones />)
    expect(await screen.findByText('1 por enviar')).toBeInTheDocument()
    expect(screen.getByText('1 enviados')).toBeInTheDocument()
    expect(screen.getByText('3 requieren atención')).toBeInTheDocument()
  })

  it('"enviado" solo aparece para el que el proveedor confirmó', async () => {
    render(<Comunicaciones />)
    await screen.findByText('Sin confirmar')
    fireEvent.click(screen.getByText('Enviados', { selector: 'button' }))
    expect(screen.getAllByText('Enviado')).toHaveLength(1)
  })

  it('el texto crudo del proveedor no se muestra al operador', async () => {
    render(<Comunicaciones />)
    await screen.findByText('No se envió')
    expect(screen.queryByText(/rechazado 422|timeout/)).toBeNull()
  })
})

describe('sin proveedor activado: se dice que NO se envió nada', () => {
  it('no finge un envío', async () => {
    mocks.despacharMensajes.mockResolvedValueOnce({ ok: false, noConfigurado: true,
      error: 'El correo al cliente todavía no está activado. Los mensajes siguen pendientes: no se envió ninguno.' })
    render(<Comunicaciones />)
    fireEvent.click(await screen.findByText('Enviar pendientes'))
    expect(await screen.findByText(/todavía no está activado/)).toBeInTheDocument()
    expect(screen.getByText(/no se envió ninguno/)).toBeInTheDocument()
    expect(screen.queryByText(/enviado\(s\)/)).toBeNull()
  })

  it('un fallo al contactar el servicio no se reporta como éxito', async () => {
    mocks.despacharMensajes.mockResolvedValueOnce({ ok: false, noConfigurado: false,
      error: 'No se pudo contactar al servicio de envío. No se sabe si algún mensaje salió: revisa el buzón.' })
    render(<Comunicaciones />)
    fireEvent.click(await screen.findByText('Enviar pendientes'))
    expect(await screen.findByText(/No se sabe si algún mensaje salió/)).toBeInTheDocument()
  })
})

describe('el resultado de un envío se desglosa', () => {
  it('procesados no es lo mismo que enviados', async () => {
    mocks.despacharMensajes.mockResolvedValueOnce({ ok: true, procesados: 3, enviado: 1, fallido: 1, incierto: 1 })
    render(<Comunicaciones />)
    fireEvent.click(await screen.findByText('Enviar pendientes'))
    expect(await screen.findByText('Se procesaron 3: 1 enviado(s), 1 sin confirmar, 1 no enviado(s).')).toBeInTheDocument()
  })

  it('después de enviar se relee el buzón del servidor', async () => {
    render(<Comunicaciones />)
    fireEvent.click(await screen.findByText('Enviar pendientes'))
    await waitFor(() => expect(mocks.cargarMensajes).toHaveBeenCalledTimes(2))
  })

  it('sin nada por enviar, el botón está deshabilitado', async () => {
    mocks.cargarMensajes.mockResolvedValue({ data: [m({ status: 'enviado', sent_at: 'x' })], error: null })
    render(<Comunicaciones />)
    await screen.findByText('1 enviados')
    expect(screen.getByText('Enviar pendientes').closest('button')).toBeDisabled()
  })
})

describe('reintentar es una decisión humana', () => {
  it('reintentar devuelve el mensaje a la cola y aclara que AÚN no se envió', async () => {
    render(<Comunicaciones />)
    const fila = (await screen.findByText('Pedido entregado')).closest('tr') as HTMLElement
    fireEvent.click(fila.querySelector('button') as HTMLElement)
    await waitFor(() => expect(mocks.reintentarMensaje).toHaveBeenCalledWith('d', false))
    expect(await screen.findByText(/Todavía NO se ha enviado/)).toBeInTheDocument()
  })

  it('si pudo haber llegado, NO se reenvía sin confirmación explícita', async () => {
    mocks.reintentarMensaje.mockResolvedValueOnce({ ok: false, pideConfirmarDuplicado: true, error: 'x' })
    render(<Comunicaciones />)
    const fila = (await screen.findByText('Pedido en camino')).closest('tr') as HTMLElement
    fireEvent.click(fila.querySelector('button') as HTMLElement)
    expect(await screen.findByText('Este mensaje pudo haber llegado')).toBeInTheDocument()
    expect(screen.getByText(/podría recibirlo dos veces/)).toBeInTheDocument()
    // Hasta aquí solo se intentó SIN aceptar el riesgo.
    expect(mocks.reintentarMensaje).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Reenviar de todos modos'))
    await waitFor(() => expect(mocks.reintentarMensaje).toHaveBeenLastCalledWith('c', true))
  })

  it('un cliente sin correo ofrece "ya tiene correo", no "reintentar"', async () => {
    render(<Comunicaciones />)
    const fila = (await screen.findByText('Pedido cancelado')).closest('tr') as HTMLElement
    expect(fila.textContent).toContain('sin correo registrado')
    expect(fila.querySelector('button')?.textContent).toBe('Ya tiene correo')
  })

  it('el rechazo del servidor se muestra tal cual lo redactó', async () => {
    mocks.reintentarMensaje.mockResolvedValueOnce({ ok: false, pideConfirmarDuplicado: false, error: 'El cliente todavía no tiene un correo registrado.' })
    render(<Comunicaciones />)
    const fila = (await screen.findByText('Pedido cancelado')).closest('tr') as HTMLElement
    fireEvent.click(fila.querySelector('button') as HTMLElement)
    expect(await screen.findByText('El cliente todavía no tiene un correo registrado.')).toBeInTheDocument()
  })
})

describe('estados de carga, vacío y error', () => {
  it('buzón vacío se explica', async () => {
    mocks.cargarMensajes.mockResolvedValue({ data: [], error: null })
    render(<Comunicaciones />)
    expect(await screen.findByText(/aparecerán con el primer pedido/)).toBeInTheDocument()
  })
  it('si el buzón no se pudo leer, se dice — no se muestra vacío', async () => {
    mocks.cargarMensajes.mockResolvedValue({ data: [], error: 'No se pudo cargar el buzón de mensajes.' })
    render(<Comunicaciones />)
    expect(await screen.findByText('No se pudo cargar el buzón de mensajes.')).toBeInTheDocument()
  })
})
