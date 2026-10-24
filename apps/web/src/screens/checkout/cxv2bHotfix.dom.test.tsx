// @vitest-environment jsdom
// CX-V2-B hotfix · reproduce la transición vista en producción (119961f): al abrir se veía el selector de dirección completo
// con "Calculando…" y, un segundo después, la sección de dirección desaparecía y quedaba "recoger" sin forma de cambiar la
// dirección. Causa: la sección se ocultaba cuando el selector reportaba null (ubicación predeterminada incompleta o varias
// sin predeterminada) y "recoger" no exige dirección. Ahora: esqueleto estable durante la carga, la dirección siempre se
// puede consultar o cambiar, resultados obsoletos ignorados y sin confirmar con una revisión pendiente o fallida.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { CheckoutCanonico } from './CheckoutCanonico'
import { opsPara } from './entregaUx.fixtures'
import type { RevisionCheckout } from '../../data/ops/carrito'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'D1', supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() } } }))
const h = vi.hoisted(() => ({ ubicaciones: [] as unknown[] }))
vi.mock('../../data/hooks/useDoctorLocations', () => ({ useDoctorLocations: () => ({ data: h.ubicaciones, loading: false, reload: async () => {}, createDoctorLocation: async () => ({ ok: true, id: 'L9' }), setDefaultDoctorLocation: vi.fn(async () => ({ ok: true })) }) }))
vi.mock('../../data/mock/profiles', () => ({ clientOf: () => ({ address: '—', city: '—', phone: '' }) }))
vi.mock('../doctor/PaymentModal', () => ({ PaymentModal: () => <div data-testid="pago" /> }))

const loc = (id: string, name: string, cp: string, city: string, extra: Record<string, unknown> = {}) => ({ id, doctor_id: 'D1', name, line1: `Calle ${name} 100`, postal_code: cp, city, state: 'Sinaloa', contact_phone: '6671234567', is_default: false, active: true, ...extra })
const CP: Record<string, string> = { L1: '80020', L2: '82000', L3: '80100' }
beforeEach(() => { cleanup() })

type Pendiente = { resolver: () => void }
/** Servidor simulado. `manual`: cada revisión espera a que la prueba la libere (para cargas y carreras). `falla(n)`: la n-ésima revisión falla. */
function montar(o: { subtotal: number; manual?: boolean; falla?: (n: number, loc: string | null | undefined) => boolean }) {
  const rev: Array<{ loc: string | null | undefined; dir: { cp?: string } | null | undefined; entrega: string | null | undefined }> = []
  const cola: Pendiente[] = []
  const cliente = {
    revisarCheckout: async (_c: string, locId?: string | null, dir?: { cp?: string } | null, entrega?: string | null) => {
      rev.push({ loc: locId, dir, entrega })
      const n = rev.length
      if (o.manual) await new Promise<void>((res) => cola.push({ resolver: res }))
      if (o.falla?.(n, locId)) return { ok: false as const, error: { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
      const us = h.ubicaciones as Array<{ id: string; is_default: boolean }>
      const pred = us.find((u) => u.is_default)?.id ?? null
      const cp = locId ? CP[locId] : dir?.cp ?? (pred ? CP[pred] : null)
      const ops = opsPara(cp ?? null, o.subtotal)
      const x = entrega ? ops.opciones.find((y) => y.id === entrega) : null
      const sin: RevisionCheckout = { listo: false, cart_id: 'K', cart_rev: 1, total: o.subtotal, moneda: 'MXN', lineas: [{ product_id: 'P1', qty: 1, nombre: 'Golden Placenta Mask', precio_unitario: o.subtotal, subtotal: o.subtotal }], problemas: ['REQUIERE_ENTREGA'], entrega: null, entrega_opciones: ops, direccion: (locId ?? (dir ? null : pred)) ? { location_id: (locId ?? pred) as string, address: { line1: 'x', cp: cp ?? undefined } } : null }   // como el servidor: sin elección usa la predeterminada
      if (!x || !x.permitido || !x.disponible) return { ok: true as const, data: sin }
      const ent = { opcion: x.id, tipo: x.tipo, paqueteria: x.paqueteria, texto: x.texto, flete: x.flete, flete_regla: x.flete, local: ops.local, cp: ops.cp, salida: x.salida, antes_de_corte: true, llega_desde: x.llega_desde, llega_hasta: x.llega_hasta }
      return { ok: true as const, data: { ...sin, listo: x.tipo !== 'local', problemas: x.tipo === 'local' ? ['HORARIO_REQUERIDO'] : [], review_id: 'R' + n, expires_at: new Date(Date.now() + 900_000).toISOString(), entrega: ent, envio: x.flete, total_con_envio: o.subtotal + x.flete } }
    },
    confirmarCheckout: vi.fn(async () => ({ ok: true as const, data: { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S1', total: o.subtotal } })),
  }
  render(<CheckoutCanonico base={null} servidor={{ cliente: cliente as never, obtenerCartId: async () => 'K', cargarHorarios: async () => ({ ok: true, data: { zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '14:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60, franjas: [], dias: [] } }) }} onPay={vi.fn()} onClose={vi.fn()} />)
  const liberar = async (i?: number) => { await act(async () => { const p = i == null ? cola.shift() : cola.splice(i, 1)[0]; p?.resolver(); await Promise.resolve() }) }
  return { rev, cola, liberar, confirmar: cliente.confirmarCheckout }
}
const seVe = (id: string) => { let e: HTMLElement | null = screen.queryByTestId(id); while (e) { if (e.style?.display === 'none') return false; e = e.parentElement } return !!screen.queryByTestId(id) }
const marcado = (id: string) => !!(screen.queryByTestId(`entrega-${id}`)?.querySelector('input') as HTMLInputElement | null)?.checked

describe('transición observada en producción (predeterminada incompleta, $350 local)', () => {
  it('durante la carga: esqueleto estable, ni el selector completo ni las opciones; al llegar: opciones y la dirección SIGUE accesible', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true, contact_phone: '' }), loc('L2', 'Casa', '82000', 'Mazatlán')]   // sin teléfono: el selector reporta null
    const s = montar({ subtotal: 350, manual: true })
    await waitFor(() => expect(s.cola.length).toBe(1))
    // estado inicial (primera captura): nada provisional que luego desaparezca
    expect(screen.getByTestId('checkout-cargando')).toBeInTheDocument()
    expect(seVe('checkout-direccion')).toBe(false)
    expect(screen.queryByText(/Enviar a otra dirección/)).toBeTruthy()   // el selector está montado…
    expect(seVe('checkout-direccion-selector')).toBe(false)                // …pero no se muestra mientras carga
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('Calculando…')
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    await s.liberar()
    // estado final (segunda captura): recoger elegido Y la dirección se puede cambiar
    await waitFor(() => expect(screen.queryByTestId('checkout-cargando')).toBeNull())
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(seVe('checkout-direccion')).toBe(true)
    expect(screen.getByTestId('checkout-direccion-pendiente')).toHaveTextContent('Elige a dónde te lo enviaríamos')
    expect(screen.getByTestId('entrega-local_chofer-texto')).toHaveTextContent('Agrega $150 en productos para recibirlo gratis')   // faltante correcto
    fireEvent.click(screen.getByTestId('checkout-direccion-elegir'))
    expect(seVe('checkout-direccion-selector')).toBe(true)
    expect(screen.getByText(/Enviar a otra dirección \(solo este pedido\)/)).toBeInTheDocument()
    expect(marcado('recoge')).toBe(true)   // abrir el selector no cambia la modalidad
  })
  it('varias ubicaciones sin predeterminada: tampoco se pierde el acceso a la dirección', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán'), loc('L2', 'Casa', '82000', 'Mazatlán')]
    montar({ subtotal: 350 })
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    // el servidor no tiene predeterminada → la tarjeta de entrega a domicilio pide la dirección y abre el selector
    expect(screen.getByTestId('entrega-local_chofer-texto')).toHaveTextContent('Agrega una dirección')
    fireEvent.click(screen.getByTestId('checkout-agregar-direccion'))
    expect(seVe('checkout-direccion')).toBe(true)
    expect(seVe('checkout-direccion-selector')).toBe(true)
    expect(screen.getByText(/Tienes varias ubicaciones y ninguna predeterminada/)).toBeInTheDocument()
  })
})

describe('recoger seleccionado con dirección válida', () => {
  it('la dirección queda en una línea con "Cambiar"; cambiar a otra local conserva recoger y recalcula', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true }), loc('L3', 'Norte', '80100', 'Culiacán')]
    const s = montar({ subtotal: 350 })
    await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(screen.getByTestId('checkout-direccion-resumen')).toHaveTextContent('Calle Consultorio 100')
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    const n = s.rev.length
    fireEvent.click(screen.getAllByText(/Norte/)[0])
    await waitFor(() => expect(s.rev.length).toBeGreaterThan(n))
    expect(s.rev[s.rev.length - 1].loc).toBe('L3')
    await waitFor(() => expect(screen.queryByTestId('checkout-actualizando')).toBeNull())
    expect(marcado('recoge')).toBe(true)
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
  })
  it('$500: cambiar a dirección foránea muestra DHL según reglas; la predeterminada del doctor no se toca', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true }), loc('L2', 'Casa', '82000', 'Mazatlán')]
    const s = montar({ subtotal: 500 })
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))   // chofer gratis
    expect(screen.getByTestId('entrega-local_chofer-chip')).toHaveTextContent('Gratis')
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    fireEvent.click(screen.getAllByText(/Casa/)[0])
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl')).toBeInTheDocument())
    expect(screen.getByTestId('entrega-foraneo_dhl-chip')).toHaveTextContent('$600')
    expect(screen.getByTestId('checkout-entrega-aviso')).toHaveTextContent(/no aplica para esta dirección/)
    expect(s.rev.every((r) => r.loc !== undefined || r.dir !== undefined)).toBe(true)
  })
})

describe('nueva dirección solo para este pedido', () => {
  it('capturarla recalcula con su C.P. (snapshot, sin guardarla como ubicación)', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true })]
    const s = montar({ subtotal: 1050 })
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    fireEvent.click(screen.getByText(/Enviar a otra dirección \(solo este pedido\)/))
    fireEvent.change(screen.getByPlaceholderText('Calle y número'), { target: { value: 'Av. del Mar 1020' } })
    fireEvent.change(screen.getByLabelText('Código postal'), { target: { value: '82000' } })
    fireEvent.change(screen.getByPlaceholderText('Ciudad'), { target: { value: 'Mazatlán' } })
    fireEvent.change(screen.getByLabelText('Teléfono de quien recibe'), { target: { value: '6691234567' } })
    await waitFor(() => expect(s.rev.some((r) => r.dir?.cp === '82000' && !r.loc)).toBe(true))
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl')).toBeInTheDocument())
    expect(screen.getByTestId('entrega-foraneo_dhl-chip')).toHaveTextContent('$600')
  })
})

describe('revisión pendiente o fallida', () => {
  it('cambio de dirección con una revisión pendiente: una respuesta tardía de la dirección anterior no se muestra', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true }), loc('L2', 'Casa', '82000', 'Mazatlán'), loc('L3', 'Norte', '80100', 'Culiacán')]
    const s = montar({ subtotal: 500, manual: true })
    await waitFor(() => expect(s.cola.length).toBe(1)); await s.liberar()   // apertura
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    fireEvent.click(screen.getAllByText(/Casa/)[0])      // → Mazatlán (pendiente)
    await waitFor(() => expect(s.cola.length).toBe(1))
    expect(screen.getByTestId('checkout-actualizando')).toBeInTheDocument()
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()   // no se confirma con datos de la dirección anterior
    fireEvent.click(screen.getAllByText(/Norte/)[0])     // → otra de Culiacán (pendiente)
    await waitFor(() => expect(s.cola.length).toBe(2))
    await s.liberar(1)                                    // llega primero la de Norte (la vigente)
    await s.liberar(0)                                    // y después, tarde, la de Mazatlán: se ignora
    while (s.cola.length) await s.liberar()               // (revisiones posteriores, si las hubiera)
    await waitFor(() => expect(screen.queryByTestId('checkout-actualizando')).toBeNull())
    expect(screen.queryByTestId('entrega-foraneo_dhl')).toBeNull()   // nada de la respuesta obsoleta
    expect(screen.getByTestId('entrega-local_chofer')).toBeInTheDocument()
  })
  it('error al revisar tras cambiar de dirección: opciones atenuadas, sin confirmar, y "Reintentar" recupera', async () => {
    h.ubicaciones = [loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true }), loc('L2', 'Casa', '82000', 'Mazatlán')]
    let fallar = true
    const s = montar({ subtotal: 1050, falla: (_n, l) => l === 'L2' && fallar })
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    fireEvent.click(screen.getAllByText(/Casa/)[0])
    await waitFor(() => expect(screen.getByTestId('checkout-error-revision')).toHaveTextContent('No hay conexión'))
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(s.confirmar).not.toHaveBeenCalled()
    fallar = false
    fireEvent.click(screen.getByTestId('checkout-reintentar'))
    await waitFor(() => expect(screen.queryByTestId('checkout-error-revision')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl')).toBeInTheDocument())
    expect(s.rev[s.rev.length - 1].loc).toBe('L2')
  })
})
