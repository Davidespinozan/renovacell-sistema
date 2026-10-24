// @vitest-environment jsdom
// CX-V2-A/B · checkout del doctor: solo las alternativas relevantes, faltante con los números del servidor explicado una vez,
// "Agregar productos" (carrito intacto), recálculo al cambiar de dirección, elección conservada mientras sea válida y, si deja
// de serlo, aviso y nueva elección (nunca cambia sola a recoger); dirección solo cuando corresponde; total del servidor junto
// al botón con desglose cuando hay envío con costo.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { CheckoutCanonico } from './CheckoutCanonico'
import { opsPara } from './entregaUx.fixtures'
import type { RevisionCheckout } from '../../data/ops/carrito'
import type { OpcionesEntrega } from '../../data/ops/entrega'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'D1', supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() } } }))
const h = vi.hoisted(() => ({ ubicaciones: [] as unknown[] }))
vi.mock('../../data/hooks/useDoctorLocations', () => ({ useDoctorLocations: () => ({ data: h.ubicaciones, loading: false, reload: async () => {}, createDoctorLocation: async () => ({ ok: true, id: 'L9' }), setDefaultDoctorLocation: async () => ({ ok: true }) }) }))
vi.mock('../../data/mock/profiles', () => ({ clientOf: () => ({ address: '—', city: '—', phone: '' }) }))
vi.mock('../doctor/PaymentModal', () => ({ PaymentModal: () => <div data-testid="pago" /> }))

const CULIACAN = { id: 'L1', doctor_id: 'D1', name: 'Consultorio', line1: 'Blvd. Pedro Infante 100', postal_code: '80020', city: 'Culiacán', state: 'Sinaloa', contact_phone: '6671234567', is_default: true, active: true }
const MAZATLAN = { id: 'L2', doctor_id: 'D1', name: 'Casa', line1: 'Av. del Mar 10', postal_code: '82000', city: 'Mazatlán', state: 'Sinaloa', contact_phone: '6691234567', is_default: false, active: true }
const CP: Record<string, string> = { L1: '80020', L2: '82000' }
beforeEach(() => { cleanup(); h.ubicaciones = [CULIACAN, MAZATLAN] })

/** Servidor simulado: opciones según el CP de la ubicación revisada y el importe vigente del carrito. */
function montar(subtotal: () => number, onClose = vi.fn()) {
  const rev: Array<{ loc: string | null | undefined; entrega: string | null | undefined }> = []
  const linea = () => ({ product_id: 'P1', qty: Math.max(1, Math.round(subtotal() / 350)), nombre: 'Golden Placenta Mask', precio_unitario: 350, subtotal: subtotal() })
  const cliente = {
    revisarCheckout: async (_c: string, loc?: string | null, _dir?: unknown, entrega?: string | null, horario?: { fecha: string; inicio: string } | null) => {
      rev.push({ loc, entrega })
      const us = h.ubicaciones as Array<{ id: string; is_default: boolean }>
      const pred = us.length ? (us.find((u) => u.is_default) ?? us[0]).id : null
      const dir = loc ?? pred   // sin ubicación elegida el servidor usa la predeterminada (si existe)
      const ops: OpcionesEntrega = opsPara(dir ? CP[dir] ?? null : null, subtotal())
      const o = entrega ? ops.opciones.find((x) => x.id === entrega) : null
      const sin: RevisionCheckout = { listo: false, cart_id: 'K', cart_rev: 1, total: subtotal(), moneda: 'MXN', lineas: [linea()], problemas: ['REQUIERE_ENTREGA'], entrega: null, entrega_opciones: ops, direccion: dir ? { location_id: dir, address: { line1: 'x', cp: CP[dir] } } : null }
      if (!o || !o.permitido || !o.disponible) return { ok: true as const, data: sin }
      if (o.tipo === 'local' && !horario) return { ok: true as const, data: { ...sin, problemas: ['HORARIO_REQUERIDO'] } }
      const ent = { opcion: o.id, tipo: o.tipo, paqueteria: o.paqueteria, texto: o.texto, flete: o.flete, flete_regla: o.flete, local: ops.local, cp: ops.cp, salida: o.salida, antes_de_corte: true, llega_desde: o.llega_desde, llega_hasta: o.llega_hasta }
      return { ok: true as const, data: { ...sin, listo: true, review_id: 'R' + rev.length, expires_at: new Date(Date.now() + 900_000).toISOString(), problemas: [], entrega: ent, envio: o.flete, total_con_envio: subtotal() + o.flete } }
    },
    confirmarCheckout: async () => ({ ok: true as const, data: { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S1', total: subtotal() } }),
  }
  render(<CheckoutCanonico base={null} servidor={{ cliente: cliente as never, obtenerCartId: async () => 'K', cargarHorarios: async () => ({ ok: true, data: { zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '14:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60, franjas: [], dias: [] } }) }} onPay={vi.fn()} onClose={onClose} />)
  return { rev, onClose }
}
const texto = (id: string) => screen.getByTestId(`entrega-${id}-texto`).textContent ?? ''
const chip = (id: string) => screen.getByTestId(`entrega-${id}-chip`).textContent ?? ''
const radio = (id: string) => screen.getByTestId(`entrega-${id}`).querySelector('input') as HTMLInputElement | null
const marcado = (id: string) => !!screen.queryByTestId(`entrega-${id}`) && !!radio(id)?.checked
const visible = (id: string) => (screen.getByTestId(id) as HTMLElement).style.display !== 'none'

describe('1 · local $350', () => {
  it('recoger gratis seleccionado; entrega a domicilio "Gratis desde $500" con "Agrega $150" y UNA acción; DHL y T1 no ocupan tarjeta; total $350 sin desglose', async () => {
    const { onClose } = montar(() => 350)
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(chip('recoge')).toBe('Gratis')
    expect(texto('recoge')).toBe('Listo para recoger hoy · Lunes a sábado de 10:00 a 18:00')
    expect(chip('local_chofer')).toBe('Gratis desde $500')
    expect(texto('local_chofer')).toBe('Agrega $150 en productos para recibirlo gratis')
    expect(radio('local_chofer')).toBeNull()   // visible pero no habilitada: sin radio, distinta de la seleccionada
    expect(screen.queryByTestId('entrega-foraneo_dhl')).toBeNull()
    expect(screen.queryByTestId('entrega-foraneo_t1')).toBeNull()
    expect(screen.getAllByTestId('checkout-agregar')).toHaveLength(1)
    expect(screen.getByTestId('checkout-entrega').textContent?.match(/\$150/g)).toHaveLength(1)   // el faltante se dice una vez
    expect(screen.getByTestId('checkout-direccion-nota')).toHaveTextContent('No se usa para recoger en sucursal.')
    expect(screen.getByTestId('checkout-direccion-resumen')).toHaveTextContent(/Blvd\. Pedro Infante 100/)
    expect(screen.queryByTestId('checkout-corte')).toBeNull()
    expect(screen.queryByTestId('checkout-desglose')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$350')
    expect(screen.getByTestId('checkout-crear')).not.toBeDisabled()
    // 9 · agregar productos regresa al catálogo (cierra el checkout; el carrito vive en el servidor)
    fireEvent.click(screen.getByTestId('checkout-agregar'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(marcado('recoge')).toBe(true)   // pulsar la acción no cambió la selección
  })
})

describe('2 · local $500 (el carrito alcanzó el mínimo)', () => {
  it('entrega a domicilio gratis preseleccionada (sugerida), sin acción de agregar; total $500', async () => {
    montar(() => 500)
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    expect(chip('local_chofer')).toBe('Gratis')
    expect(texto('local_chofer')).toBe('Eliges un horario de media hora')
    expect(screen.queryByTestId('checkout-agregar')).toBeNull()
    expect(screen.getByTestId('checkout-corte')).toHaveTextContent('Pedidos antes de las 15:30 salen el mismo día.')
    expect(screen.queryByTestId('checkout-direccion-nota')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$500')
  })
})

describe('3/4 · cambio de dirección', () => {
  it('local → foránea: recalcula, la entrega a domicilio deja de valer → aviso y sin selección; el doctor elige DHL $600; desglose y total $1,100', async () => {
    const { rev } = montar(() => 500)
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    const n = rev.length
    fireEvent.click(screen.getAllByText(/Casa/)[0])
    await waitFor(() => expect(rev.length).toBeGreaterThan(n))
    expect(rev[rev.length - 1]).toMatchObject({ loc: 'L2' })
    await waitFor(() => expect(screen.getByTestId('checkout-entrega-aviso')).toHaveTextContent('Entrega a domicilio: no aplica para esta dirección. Elige otra opción.'))
    expect(screen.queryByTestId('entrega-local_chofer')).toBeNull()
    expect(marcado('recoge')).toBe(false); expect(marcado('foraneo_dhl')).toBe(false)   // nada se eligió en silencio
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    expect(chip('foraneo_dhl')).toBe('$600')
    expect(screen.getByTestId('entrega-foraneo_dhl-nota')).toHaveTextContent('Gratis desde $5,000 · agrega $4,500')
    fireEvent.click(screen.getByTestId('entrega-foraneo_dhl'))
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
    expect(screen.getByTestId('checkout-productos')).toHaveTextContent('$500')
    expect(screen.getByTestId('checkout-envio')).toHaveTextContent(/DHL.*\$600/)
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$1,100')
    await waitFor(() => expect(screen.getByTestId('checkout-crear')).not.toBeDisabled())
  })
  it('foránea → local conservando "recoger": la elección válida se mantiene sin aviso; DHL desaparece', async () => {
    h.ubicaciones = [{ ...MAZATLAN, is_default: true }, { ...CULIACAN, is_default: false }]
    const { rev } = montar(() => 500)
    await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    expect(marcado('recoge')).toBe(true)
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    const n = rev.length
    fireEvent.click(screen.getAllByText(/Consultorio/)[0])
    await waitFor(() => expect(rev.length).toBeGreaterThan(n))
    await waitFor(() => expect(screen.getByTestId('entrega-local_chofer')).toBeInTheDocument())
    expect(marcado('recoge')).toBe(true)
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
    expect(screen.queryByTestId('entrega-foraneo_dhl')).toBeNull()
  })
})

describe('5/6 · DHL foráneo', () => {
  it('con costo ($1,050): DHL $600 preseleccionado, faltante una vez en la tarjeta, desglose Productos/Envío y total $1,650', async () => {
    h.ubicaciones = [{ ...MAZATLAN, is_default: true }]
    montar(() => 1050)
    await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))
    expect(screen.getByTestId('entrega-foraneo_dhl-nota')).toHaveTextContent('Gratis desde $5,000 · agrega $3,950')
    expect(screen.getAllByTestId('checkout-agregar')).toHaveLength(1)
    expect(screen.getByTestId('checkout-productos')).toHaveTextContent('$1,050')
    expect(screen.getByTestId('checkout-envio')).toHaveTextContent('$600')
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$1,650')
  })
  it('gratis ($5,000): DHL "Gratis", sin nota ni acción, sin desglose; total $5,000', async () => {
    h.ubicaciones = [{ ...MAZATLAN, is_default: true }]
    montar(() => 5000)
    await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))
    expect(chip('foraneo_dhl')).toBe('Gratis')
    expect(screen.queryByTestId('entrega-foraneo_dhl-nota')).toBeNull()
    expect(screen.queryByTestId('checkout-agregar')).toBeNull()
    expect(screen.queryByTestId('checkout-desglose')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$5,000')
  })
})

describe('7 · sin dirección', () => {
  it('recoger seleccionado; una tarjeta "Entrega a domicilio" pide la dirección; el formulario queda plegado hasta pulsar "Agregar dirección"', async () => {
    h.ubicaciones = []
    montar(() => 350)
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(texto('local_chofer')).toBe('Agrega una dirección para ver si te lo llevamos')
    expect(radio('local_chofer')).toBeNull()
    expect(visible('checkout-direccion')).toBe(false)
    expect(screen.getByTestId('checkout-crear')).not.toBeDisabled()   // recoger no exige dirección
    fireEvent.click(screen.getByTestId('checkout-agregar-direccion'))
    expect(visible('checkout-direccion')).toBe(true)
    expect(marcado('recoge')).toBe(true)
  })
})

describe('8 · modalidad que deja de ser válida', () => {
  it('nunca se confirma una modalidad inválida: tras el aviso el botón sigue bloqueado hasta elegir', async () => {
    const { rev } = montar(() => 500)
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    fireEvent.click(screen.getAllByText(/Casa/)[0])
    await waitFor(() => expect(screen.getByTestId('checkout-entrega-aviso')).toBeInTheDocument())
    const n = rev.length
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(rev.length).toBe(n)   // ni siquiera se intenta revisar/confirmar
    expect(screen.queryByTestId('checkout-exito')).toBeNull()
  })
})
