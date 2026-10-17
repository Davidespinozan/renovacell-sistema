// @vitest-environment jsdom
// ENT-1 · El checkout canónico muestra las opciones de entrega del SERVIDOR (flete y promesa), preselecciona la sugerida,
// suma el flete al total que ve el doctor, manda SOLO el id de la opción al revisar y no exige dirección para recoger.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { CheckoutCanonico } from './CheckoutCanonico'
import type { RevisionCheckout, ResultadoCheckout } from '../../data/ops/carrito'
import type { OpcionesEntrega, EntregaPedido } from '../../data/ops/entrega'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'D1', supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() } } }))
vi.mock('../../data/hooks/useDoctorLocations', () => {
  // misma referencia en cada render (el selector de ubicación reacciona a `data`)
  const DATA = [{ id: 'L1', doctor_id: 'D1', name: 'Consultorio', line1: 'Av. del Mar 10', postal_code: '82000', city: 'Mazatlán', state: 'Sinaloa', contact_phone: '6691234567', is_default: true, active: true }]
  return { useDoctorLocations: () => ({ data: DATA, loading: false, reload: async () => {}, createDoctorLocation: async () => ({ ok: true, id: 'L2' }), setDefaultDoctorLocation: async () => ({ ok: true }) }) }
})
vi.mock('../../data/mock/profiles', () => ({ clientOf: () => ({ address: '—', city: '—', phone: '' }) }))
vi.mock('../doctor/PaymentModal', () => ({ PaymentModal: () => <div data-testid="pago" /> }))
beforeEach(cleanup)

const OPS: OpcionesEntrega = {
  actor: 'doctor', subtotal: 1050, cp: '82000', local: false,
  corte: { hora: '15:30', zona: 'America/Mazatlan', antes_de_corte: true, hoy: '2026-10-21' },
  regla: { foraneo_gratis_desde: 5000, foraneo_flete: 600, local_gratis_desde: 500 },
  recoge: { lugar: 'Sucursal Renovacell, Culiacán', horario: 'Lunes a sábado de 10:00 a 18:00' },
  sugerida: 'foraneo_dhl',
  opciones: [
    { id: 'mostrador', tipo: 'mostrador', paqueteria: null, flete: 0, permitido: false, motivo: 'SOLO_PERSONAL', disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Entrega en mostrador' },
    { id: 'recoge', tipo: 'recoge', paqueteria: null, flete: 0, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Recoger en Sucursal Renovacell, Culiacán' },
    { id: 'local_chofer', tipo: 'local', paqueteria: 'chofer', flete: 0, permitido: false, motivo: 'ZONA_FORANEA', disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', texto: 'Entrega local (chofer de Renovacell)' },
    { id: 'foraneo_dhl', tipo: 'foraneo', paqueteria: 'dhl', flete: 600, permitido: true, motivo: null, disponible: true, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-22', llega_hasta: '2026-10-26', texto: 'Envío por DHL' },
    { id: 'foraneo_t1', tipo: 'foraneo', paqueteria: 't1', flete: 600, permitido: true, motivo: null, disponible: false, salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-23', llega_hasta: '2026-10-28', texto: 'Envío por T1' },
  ],
}
const LINEA = { product_id: 'P1', qty: 3, nombre: 'Golden Placenta Mask', precio_unitario: 350, subtotal: 1050 }
const ENTREGA_DHL: EntregaPedido = { opcion: 'foraneo_dhl', tipo: 'foraneo', paqueteria: 'dhl', texto: 'Envío por DHL', flete: 600, flete_regla: 600, local: false, cp: '82000', salida: '2026-10-21', antes_de_corte: true, llega_desde: '2026-10-22', llega_hasta: '2026-10-26' }
let nRev = 0
const sinEntrega = (): RevisionCheckout => ({ listo: false, cart_id: 'K', cart_rev: 3, total: 1050, moneda: 'MXN', lineas: [LINEA], problemas: ['REQUIERE_ENTREGA'], entrega: null, entrega_opciones: OPS })
const lista = (entrega: EntregaPedido): RevisionCheckout => ({ listo: true, cart_id: 'K', cart_rev: 3, review_id: `R${++nRev}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), total: 1050, moneda: 'MXN', lineas: [LINEA], problemas: [], entrega, entrega_opciones: OPS, envio: entrega.flete, total_con_envio: 1050 + entrega.flete })

function montar(confirmacion: ResultadoCheckout = { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S100009', total: 1650, envio: 600, entrega: ENTREGA_DHL }) {
  const rev: Array<{ loc: string | null | undefined; dir: unknown; entrega: string | null | undefined }> = []
  const cliente = {
    revisarCheckout: async (_c: string, loc?: string | null, dir?: unknown, entrega?: string | null) => {
      rev.push({ loc, dir, entrega })
      if (!entrega) return { ok: true as const, data: sinEntrega() }
      const o = OPS.opciones.find((x) => x.id === entrega)!
      return { ok: true as const, data: lista({ ...ENTREGA_DHL, opcion: o.id, tipo: o.tipo, paqueteria: o.paqueteria, texto: o.texto, flete: o.flete, flete_regla: o.flete, llega_desde: o.llega_desde, llega_hasta: o.llega_hasta }) }
    },
    confirmarCheckout: async () => ({ ok: true as const, data: confirmacion }),
  }
  const onPay = vi.fn(); const onDone = vi.fn()
  render(<CheckoutCanonico base={null} servidor={{ cliente: cliente as never, obtenerCartId: async () => 'K' }} onPay={onPay} onDone={onDone} onClose={() => {}} />)
  return { rev, onDone }
}

describe('ENT-1 · entrega en el checkout', () => {
  it('muestra las opciones del servidor con flete y promesa, preselecciona la sugerida y suma el flete al total', async () => {
    const { rev } = montar()
    await waitFor(() => expect(screen.getByTestId('checkout-entrega')).toBeInTheDocument())
    expect(rev[0].entrega).toBeNull()   // al abrir: sin opción (el servidor devuelve las opciones)
    expect(screen.queryByTestId('entrega-mostrador')).toBeNull()   // lo que es solo del personal ni se muestra
    const dhl = screen.getByTestId('entrega-foraneo_dhl')
    await waitFor(() => expect(dhl.querySelector('input')).toBeChecked())   // la sugerida se preselecciona al llegar las opciones
    expect(dhl).toHaveTextContent(/\$600/); expect(dhl).toHaveTextContent(/Sale hoy · llega entre el jueves 22 oct y el lunes 26 oct/)
    expect(screen.getByTestId('entrega-local_chofer')).toHaveTextContent(/fuera de Culiacán/)
    expect(screen.getByTestId('entrega-local_chofer').querySelector('input')).toBeDisabled()
    expect(screen.getByTestId('entrega-foraneo_t1')).toHaveTextContent(/Próximamente/)
    expect(screen.getByTestId('checkout-envio')).toHaveTextContent(/\$600/)
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,650/)
    expect(screen.getByTestId('checkout-corte')).toHaveTextContent(/antes de las 15:30 salen el mismo día/)
    expect(screen.queryByTestId('checkout-aviso')).toBeNull()   // REQUIERE_ENTREGA no se grita: la entrega se elige aquí
  })
  it('al confirmar revisa con el id de la opción elegida (nunca el flete) y muestra la promesa del pedido', async () => {
    const { rev, onDone } = montar()
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl').querySelector('input')).toBeChecked())
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await waitFor(() => expect(screen.getByTestId('checkout-exito')).toBeInTheDocument())
    expect(rev).toHaveLength(2); expect(rev[1]).toMatchObject({ loc: 'L1', entrega: 'foraneo_dhl' })
    expect(JSON.stringify(rev[1])).not.toMatch(/600|flete/)
    expect(screen.getByTestId('checkout-promesa')).toHaveTextContent(/Envío por DHL · envío \$600/)
    expect(screen.getByTestId('checkout-promesa')).toHaveTextContent(/llega entre el jueves 22 oct y el lunes 26 oct/)
    expect(onDone).toHaveBeenCalledTimes(1)
  })
  it('recoger en sucursal: sin flete, con el lugar y el horario, y se puede pedir aunque no haya dirección', async () => {
    const { rev } = montar({ confirmado: true, cart_id: 'K', order_id: 'O2', folio: 'S100010', total: 1050, envio: 0, entrega: { ...ENTREGA_DHL, opcion: 'recoge', tipo: 'recoge', paqueteria: null, texto: 'Recoger en Sucursal Renovacell, Culiacán', flete: 0, flete_regla: 0, llega_desde: '2026-10-21', llega_hasta: '2026-10-21', recoge: OPS.recoge } })
    await waitFor(() => expect(screen.getByTestId('checkout-entrega')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,050/)
    expect(screen.getByTestId('checkout-corte')).toHaveTextContent(/Sucursal Renovacell, Culiacán · Lunes a sábado/)
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await waitFor(() => expect(screen.getByTestId('checkout-exito')).toBeInTheDocument())
    expect(rev[rev.length - 1].entrega).toBe('recoge')
    expect(screen.getByTestId('checkout-promesa')).toHaveTextContent(/sin costo de envío/)
    expect(screen.getByTestId('checkout-promesa')).toHaveTextContent(/Listo para recoger/)
  })
})
