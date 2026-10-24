// @vitest-environment jsdom
// ENT-1 · El checkout canónico muestra las opciones de entrega del SERVIDOR (flete y promesa), preselecciona la sugerida,
// suma el flete al total que ve el doctor, manda SOLO el id de la opción al revisar y no exige dirección para recoger.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { CheckoutCanonico } from './CheckoutCanonico'
import type { RevisionCheckout, ResultadoCheckout } from '../../data/ops/carrito'
import type { OpcionesEntrega, EntregaPedido, HorariosDisponibles } from '../../data/ops/entrega'

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
const DIR = { location_id: 'L1', address: { line1: 'Av. del Mar 10', cp: '82000' } }   // el servidor revisa con la ubicación predeterminada
const sinEntrega = (): RevisionCheckout => ({ listo: false, cart_id: 'K', cart_rev: 3, total: 1050, moneda: 'MXN', lineas: [LINEA], problemas: ['REQUIERE_ENTREGA'], entrega: null, entrega_opciones: OPS, direccion: DIR })
const lista = (entrega: EntregaPedido): RevisionCheckout => ({ listo: true, cart_id: 'K', cart_rev: 3, review_id: `R${++nRev}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), total: 1050, moneda: 'MXN', lineas: [LINEA], problemas: [], entrega, entrega_opciones: OPS, envio: entrega.flete, total_con_envio: 1050 + entrega.flete, direccion: DIR })

// ENT-H · horarios de entrega local (hoy 21 oct 14:00)
const DISP: HorariosDisponibles = {
  zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '14:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60,
  franjas: [{ desde: '10:30', hasta: '13:30' }, { desde: '15:30', hasta: '17:30' }],
  dias: [{ fecha: '2026-10-21', dia_semana: 3, disponibles: 2, slots: [
    { inicio: '15:30', fin: '16:00', ocupados: 0, cupo: 1, disponible: true, motivo: null }, { inicio: '16:00', fin: '16:30', ocupados: 1, cupo: 1, disponible: false, motivo: 'OCUPADO' }, { inicio: '16:30', fin: '17:00', ocupados: 0, cupo: 1, disponible: true, motivo: null },
  ] }],
}
const OPS_LOCAL: OpcionesEntrega = { ...OPS, cp: '80020', local: true, sugerida: 'local_chofer', opciones: OPS.opciones.map((o) => o.id === 'local_chofer' ? { ...o, permitido: true, motivo: null } : o.id === 'foraneo_dhl' || o.id === 'foraneo_t1' ? { ...o, permitido: false, motivo: 'ZONA_LOCAL' } : o) }

function montar(confirmacion: ResultadoCheckout = { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S100009', total: 1650, envio: 600, entrega: ENTREGA_DHL }, ops: OpcionesEntrega = OPS) {
  const rev: Array<{ loc: string | null | undefined; dir: unknown; entrega: string | null | undefined; horario?: unknown }> = []
  const cliente = {
    revisarCheckout: async (_c: string, loc?: string | null, dir?: unknown, entrega?: string | null, horario?: { fecha: string; inicio: string } | null) => {
      rev.push({ loc, dir, entrega, horario })
      if (!entrega) return { ok: true as const, data: { ...sinEntrega(), entrega_opciones: ops } }
      const o = ops.opciones.find((x) => x.id === entrega)!
      if (o.tipo === 'local' && !horario) return { ok: true as const, data: { ...sinEntrega(), problemas: ['HORARIO_REQUERIDO'], entrega_opciones: ops } }
      const h = horario ? { ...horario, fin: horario.inicio === '15:30' ? '16:00' : '17:00' } : null
      return { ok: true as const, data: { ...lista({ ...ENTREGA_DHL, opcion: o.id, tipo: o.tipo, paqueteria: o.paqueteria, texto: o.texto, flete: o.flete, flete_regla: o.flete, llega_desde: h?.fecha ?? o.llega_desde, llega_hasta: h?.fecha ?? o.llega_hasta, horario: h }), entrega_opciones: ops } }
    },
    confirmarCheckout: async () => ({ ok: true as const, data: confirmacion }),
  }
  const onPay = vi.fn(); const onDone = vi.fn()
  render(<CheckoutCanonico base={null} servidor={{ cliente: cliente as never, obtenerCartId: async () => 'K', cargarHorarios: async () => ({ ok: true, data: DISP }) }} onPay={onPay} onDone={onDone} onClose={() => {}} />)
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
    expect(screen.getByTestId('entrega-local_chofer')).toHaveTextContent(/fuera de la zona de entrega local/)   // CX-V2-A · causa real, no el código
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
  it('ENT-H · entrega local: el doctor de Culiacán debe elegir horario; sin él no puede pedir; con él viaja {fecha, inicio} y la promesa dice el horario', async () => {
    const ENT_LOCAL: EntregaPedido = { ...ENTREGA_DHL, opcion: 'local_chofer', tipo: 'local', paqueteria: 'chofer', texto: 'Entrega local (chofer de Renovacell)', flete: 0, flete_regla: 0, local: true, cp: '80020', llega_desde: '2026-10-21', llega_hasta: '2026-10-21', horario: { fecha: '2026-10-21', inicio: '15:30', fin: '16:00' } }
    const { rev, onDone } = montar({ confirmado: true, cart_id: 'K', order_id: 'O3', folio: 'S100011', total: 1050, envio: 0, entrega: ENT_LOCAL }, OPS_LOCAL)
    await waitFor(() => expect(screen.getByTestId('entrega-local_chofer').querySelector('input')).toBeChecked())
    expect(screen.getByTestId('entrega-local_chofer')).toHaveTextContent(/Eliges un horario de media hora/)
    await waitFor(() => expect(screen.getByTestId('checkout-horario')).toBeInTheDocument())
    expect(screen.getByTestId('checkout-horario')).toHaveTextContent(/elige un horario/)
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()   // sin horario no hay pedido
    expect(screen.queryByTestId('checkout-aviso')).toBeNull()     // HORARIO_REQUERIDO no se grita: se elige aquí
    await waitFor(() => expect(screen.getByTestId('horario-2026-10-21-15:30')).toBeInTheDocument())
    expect(screen.getByTestId('horario-2026-10-21-16:00')).toBeDisabled()
    fireEvent.click(screen.getByTestId('horario-2026-10-21-15:30'))
    expect(screen.getByTestId('entrega-local_chofer')).toHaveTextContent(/Llega hoy a las 15:30/)
    await waitFor(() => expect(screen.getByTestId('checkout-crear')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await waitFor(() => expect(screen.getByTestId('checkout-exito')).toBeInTheDocument())
    const ultima = rev[rev.length - 1]
    expect(ultima).toMatchObject({ loc: 'L1', entrega: 'local_chofer', horario: { fecha: '2026-10-21', inicio: '15:30' } })
    expect(JSON.stringify(ultima)).not.toMatch(/flete|fin/)   // solo fecha e inicio: el fin y el cupo los decide el servidor
    expect(screen.getByTestId('checkout-promesa')).toHaveTextContent(/Entrega local/)
    expect(screen.getByTestId('checkout-promesa')).toHaveTextContent(/Llega hoy entre 15:30 y 16:00/)
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
