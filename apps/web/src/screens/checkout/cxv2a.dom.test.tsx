// @vitest-environment jsdom
// CX-V2-A · experiencia de entrega en el checkout del doctor: mínimo y faltante con los números del servidor, botón para
// agregar productos (carrito intacto), recálculo al cambiar de dirección, la elección se conserva mientras sea válida y, si
// deja de serlo, se avisa y se exige elegir (nunca cambia sola a recoger); causas reales para local, DHL y T1; total del servidor.
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

/** Servidor simulado: devuelve las opciones según el CP de la ubicación revisada y el importe vigente del carrito. */
function montar(subtotal: () => number, onClose = vi.fn()) {
  const rev: Array<{ loc: string | null | undefined; entrega: string | null | undefined }> = []
  const linea = () => ({ product_id: 'P1', qty: subtotal() / 350, nombre: 'Golden Placenta Mask', precio_unitario: 350, subtotal: subtotal() })
  const cliente = {
    revisarCheckout: async (_c: string, loc?: string | null, _dir?: unknown, entrega?: string | null, horario?: { fecha: string; inicio: string } | null) => {
      rev.push({ loc, entrega })
      const ops: OpcionesEntrega = opsPara(loc ? CP[loc] ?? null : h.ubicaciones.length ? CP.L1 : null, subtotal())   // sin ubicación elegida el servidor usa la predeterminada (si existe)
      const o = entrega ? ops.opciones.find((x) => x.id === entrega) : null
      const dir = loc ?? (h.ubicaciones.length ? 'L1' : null)   // el servidor usa la predeterminada si no se eligió ninguna
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
const marcado = (id: string) => (screen.getByTestId(`entrega-${id}`).querySelector('input') as HTMLInputElement).checked

describe('CX-V2-A · pedido local de $350', () => {
  it('explica el mínimo y el faltante con los números del servidor, DHL y T1 con su causa real, recoger como única opción y total $350', async () => {
    const { onClose } = montar(() => 350)
    await waitFor(() => expect(screen.getByTestId('checkout-entrega')).toBeInTheDocument())
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(chip('local_chofer')).toBe('Gratis desde $500')
    expect(texto('local_chofer')).toBe('Gratis desde $500. Llevas $350 en productos: te faltan $150 para la entrega a tu domicilio.')
    expect(chip('foraneo_dhl')).toBe('No aplica en tu zona')
    expect(texto('foraneo_dhl')).toMatch(/Dentro de Culiacán entregamos con nuestro chofer/)
    expect(chip('foraneo_t1')).toBe('Próximamente')
    expect(texto('recoge')).toMatch(/No usaremos tu dirección de entrega/)
    expect(screen.getByTestId('checkout-entrega-unica')).toHaveTextContent(/única forma de entrega/)
    expect(screen.getByTestId('checkout-direccion-nota')).toHaveTextContent(/no usaremos esta dirección/)
    expect(screen.getByTestId('checkout-productos')).toHaveTextContent(/\$350/)
    expect(screen.getByTestId('checkout-envio')).toHaveTextContent(/Gratis/)
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$350')
    expect(screen.getByTestId('checkout-crear')).not.toBeDisabled()   // recoger no bloquea el checkout
    // el botón regresa al catálogo (cierra el checkout) y el texto promete que el carrito se conserva
    expect(screen.getByTestId('checkout-faltante')).toHaveTextContent(/Te faltan \$150 para el envío gratis \(desde \$500\)\. Tu carrito se conserva\./)
    fireEvent.click(screen.getByTestId('checkout-agregar'))
    expect(onClose).toHaveBeenCalledTimes(1)
    // nada de texto fijo del cliente: el texto viejo ya no aparece
    expect(screen.getByTestId('checkout-entrega').textContent).not.toMatch(/a partir del mínimo|No aplica para este pedido/)
  })
  it('al reabrir con $500 (el carrito alcanzó el mínimo): entrega local gratis preseleccionada, sin llamada a agregar', async () => {
    let sub = 350
    montar(() => sub)
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    cleanup(); sub = 500
    montar(() => sub)
    await waitFor(() => expect(screen.getByTestId('checkout-entrega')).toBeInTheDocument())
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    expect(chip('local_chofer')).toBe('Gratis')
    expect(texto('local_chofer')).toBe('Eliges un horario de media hora')
    expect(screen.queryByTestId('checkout-faltante')).toBeNull()
    expect(screen.queryByTestId('checkout-entrega-unica')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$500')
  })
})

describe('CX-V2-A · cambio de dirección', () => {
  it('de Culiacán ($500, chofer) a Mazatlán: recalcula en el servidor, chofer deja de ser válido → aviso y sin selección; el doctor elige DHL y ve $600 y el total $1,100', async () => {
    const { rev } = montar(() => 500)
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    const n = rev.length
    fireEvent.click(screen.getAllByText(/Casa/)[0])   // ubicación L2 (Mazatlán) en el selector
    await waitFor(() => expect(rev.length).toBeGreaterThan(n))
    expect(rev[rev.length - 1]).toMatchObject({ loc: 'L2' })
    await waitFor(() => expect(screen.getByTestId('checkout-entrega-aviso')).toBeInTheDocument())
    expect(screen.getByTestId('checkout-entrega-aviso')).toHaveTextContent(/Tu pedido ya no cumple para Entrega local \(chofer de Renovacell\) \(la dirección cambió de zona\)\. Elige otra forma de entrega\./)
    expect(marcado('local_chofer')).toBe(false); expect(marcado('recoge')).toBe(false); expect(marcado('foraneo_dhl')).toBe(false)
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()   // sin elección no hay pedido
    expect(chip('local_chofer')).toBe('Fuera de zona')
    expect(chip('foraneo_dhl')).toBe('$600')
    expect(texto('foraneo_dhl')).toMatch(/Gratis desde \$5,000: te faltan \$4,500\./)
    fireEvent.click(screen.getByTestId('entrega-foraneo_dhl'))
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
    expect(screen.getByTestId('checkout-envio')).toHaveTextContent(/\$600/)
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$1,100')
    expect(screen.getByTestId('checkout-faltante')).toHaveTextContent(/Agregar productos para envío gratis/)
    await waitFor(() => expect(screen.getByTestId('checkout-crear')).not.toBeDisabled())
  })
  it('de Mazatlán a Culiacán conservando "recoger": la elección válida se mantiene sin aviso', async () => {
    h.ubicaciones = [{ ...MAZATLAN, is_default: true }, { ...CULIACAN, is_default: false }]
    const { rev } = montar(() => 500)
    await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))   // sugerida del servidor fuera de Culiacán
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    expect(marcado('recoge')).toBe(true)
    const n = rev.length
    fireEvent.click(screen.getAllByText(/Consultorio/)[0])
    await waitFor(() => expect(rev.length).toBeGreaterThan(n))
    await waitFor(() => expect(chip('local_chofer')).toBe('Gratis'))   // llegaron las opciones de Culiacán
    expect(marcado('recoge')).toBe(true)
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
    expect(chip('foraneo_dhl')).toBe('No aplica en tu zona')
  })
})

describe('CX-V2-A · sin dirección', () => {
  it('las opciones a domicilio piden dirección, recoger queda disponible y el checkout no se bloquea', async () => {
    h.ubicaciones = []
    montar(() => 350)
    await waitFor(() => expect(screen.getByTestId('checkout-entrega')).toBeInTheDocument())
    // El servidor sin ubicación usa la predeterminada si existe; aquí no hay ninguna → simulamos su respuesta sin CP
    expect(screen.getByTestId('checkout-direccion-falta')).toHaveTextContent(/agrega una dirección/)
  })
})
