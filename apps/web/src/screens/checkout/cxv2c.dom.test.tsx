// @vitest-environment jsdom
// CX-V2-C · flujo definitivo de entrega del doctor: primero la intención (recoger / enviar a domicilio); la dirección y las
// opciones de envío viven SOLO dentro de "Enviar a domicilio"; la modalidad la autoriza el servidor. Conserva las garantías
// del hotfix (carga estable, respuestas tardías ignoradas, sin confirmar con revisión pendiente o fallida). 16 escenarios.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { CheckoutCanonico, olvidarEleccionCheckout } from './CheckoutCanonico'
import { opsPara } from './entregaUx.fixtures'
import type { RevisionCheckout } from '../../data/ops/carrito'

vi.mock('../../lib/supabase', () => ({ hasSupabase: true, currentUserId: () => 'D1', supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() } } }))
const h = vi.hoisted(() => ({ ubicaciones: [] as unknown[], predeterminar: [] as string[] }))
vi.mock('../../data/hooks/useDoctorLocations', () => ({ useDoctorLocations: () => ({ data: h.ubicaciones, loading: false, reload: async () => {}, createDoctorLocation: async () => ({ ok: true, id: 'L9' }), setDefaultDoctorLocation: async (id: string) => { h.predeterminar.push(id); return { ok: true } } }) }))
vi.mock('../../data/mock/profiles', () => ({ clientOf: () => ({ address: '—', city: '—', phone: '' }) }))
vi.mock('../doctor/PaymentModal', () => ({ PaymentModal: () => <div data-testid="pago" /> }))

const loc = (id: string, name: string, cp: string, city: string, extra: Record<string, unknown> = {}) => ({ id, doctor_id: 'D1', name, line1: `Calle ${name} 100`, postal_code: cp, city, state: 'Sinaloa', contact_phone: '6671234567', is_default: false, active: true, ...extra })
const L1 = loc('L1', 'Consultorio', '80020', 'Culiacán', { is_default: true })
const L2 = loc('L2', 'Casa', '82000', 'Mazatlán')
const L3 = loc('L3', 'Norte', '80100', 'Culiacán')
const CP: Record<string, string> = { L1: '80020', L2: '82000', L3: '80100' }
beforeEach(() => { cleanup(); olvidarEleccionCheckout(); h.predeterminar = []; h.ubicaciones = [L1, L2, L3] })

/** Servidor simulado (como cc_checkout_revisar): opciones por el C.P. de la dirección revisada (o la predeterminada). */
function montar(o: { subtotal: number; manual?: boolean; falla?: (loc: string | null | undefined) => boolean; onClose?: () => void }) {
  const rev: Array<{ loc: string | null | undefined; dir: { cp?: string } | null | undefined; entrega: string | null | undefined }> = []
  const cola: Array<() => void> = []
  const cliente = {
    revisarCheckout: async (_c: string, locId?: string | null, dir?: { cp?: string } | null, entrega?: string | null, horario?: unknown) => {
      rev.push({ loc: locId, dir, entrega })
      if (o.manual) await new Promise<void>((res) => cola.push(res))
      if (o.falla?.(locId)) return { ok: false as const, error: { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
      const us = h.ubicaciones as Array<{ id: string; is_default: boolean }>
      const pred = us.find((u) => u.is_default)?.id ?? null
      const locEf = locId ?? (dir ? null : pred)
      const cp = locEf ? CP[locEf] : dir?.cp ?? null
      const ops = opsPara(cp, o.subtotal)
      const x = entrega ? ops.opciones.find((y) => y.id === entrega) : null
      const sin: RevisionCheckout = { listo: false, cart_id: 'K', cart_rev: 1, total: o.subtotal, moneda: 'MXN', lineas: [{ product_id: 'P1', qty: 1, nombre: 'Golden Placenta Mask', precio_unitario: o.subtotal, subtotal: o.subtotal }], problemas: ['REQUIERE_ENTREGA'], entrega: null, entrega_opciones: ops, direccion: locEf ? { location_id: locEf, address: { line1: 'x', cp: cp ?? undefined } } : null }
      if (!x || !x.permitido || !x.disponible) return { ok: true as const, data: sin }
      if (x.tipo === 'local' && !horario) return { ok: true as const, data: { ...sin, problemas: ['HORARIO_REQUERIDO'] } }
      const ent = { opcion: x.id, tipo: x.tipo, paqueteria: x.paqueteria, texto: x.texto, flete: x.flete, flete_regla: x.flete, local: ops.local, cp: ops.cp, salida: x.salida, antes_de_corte: true, llega_desde: x.llega_desde, llega_hasta: x.llega_hasta }
      return { ok: true as const, data: { ...sin, listo: true, review_id: 'R' + rev.length, expires_at: new Date(Date.now() + 900_000).toISOString(), problemas: [], entrega: ent, envio: x.flete, total_con_envio: o.subtotal + x.flete } }
    },
    confirmarCheckout: vi.fn(async () => ({ ok: true as const, data: { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S1', total: o.subtotal } })),
  }
  const onClose = o.onClose ?? vi.fn()
  render(<CheckoutCanonico base={null} servidor={{ cliente: cliente as never, obtenerCartId: async () => 'K', cargarHorarios: async () => ({ ok: true, data: { zona: 'America/Mazatlan', hoy: '2026-10-21', ahora: '14:00', salida: '2026-10-21', antes_de_corte: true, corte: '15:30', cupo: 1, intervalo_min: 30, margen_min: 60, franjas: [], dias: [] } }) }} onPay={vi.fn()} onClose={onClose} />)
  const liberar = async (i = 0) => { await act(async () => { cola.splice(i, 1)[0]?.(); await Promise.resolve() }) }
  return { rev, cola, liberar, confirmar: cliente.confirmarCheckout, onClose }
}
const seVe = (id: string) => { let e: HTMLElement | null = screen.queryByTestId(id); if (!e) return false; while (e) { if (e.style?.display === 'none') return false; e = e.parentElement } return true }
const marcado = (id: string) => !!(screen.queryByTestId(`entrega-${id}`)?.querySelector('input') as HTMLInputElement | null)?.checked
const chip = (id: string) => screen.getByTestId(`entrega-${id}-chip`).textContent ?? ''
const listo = () => waitFor(() => expect(screen.queryByTestId('checkout-cargando')).toBeNull())
const elegirUbicacion = (nombre: RegExp) => { fireEvent.click(screen.getByTestId('checkout-direccion-cambiar')); fireEvent.click(screen.getAllByText(nombre)[0]) }

describe('carga estable', () => {
  it('mientras llega la revisión: esqueleto, sin selector de dirección ni opciones; "Crear pedido" bloqueado', async () => {
    const s = montar({ subtotal: 350, manual: true })
    await waitFor(() => expect(s.cola.length).toBe(1))
    expect(screen.getByTestId('checkout-cargando')).toBeInTheDocument()
    expect(seVe('checkout-direccion-selector')).toBe(false)
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('Calculando…')
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    await s.liberar()
    await listo()
    expect(marcado('recoge')).toBe(true)
  })
})

describe('recoger en sucursal', () => {
  it('1 · sin dirección registrada: recoger elegido, sin selector de dirección, sin envío; se puede confirmar', async () => {
    h.ubicaciones = []
    montar({ subtotal: 350 })
    await listo(); await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(screen.getByTestId('intencion-recoge-extra')).toHaveTextContent('Sucursal Renovacell, Culiacán')
    expect(screen.getByTestId('intencion-recoge-texto')).toHaveTextContent('Lunes a sábado de 10:00 a 18:00')
    expect(screen.queryByTestId('checkout-direccion')).toBeNull()
    expect(seVe('checkout-direccion-selector')).toBe(false)
    expect(screen.queryByTestId('checkout-envio')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$350')
    expect(screen.getByTestId('checkout-crear')).not.toBeDisabled()
    expect(screen.getByTestId('entrega-domicilio')).toHaveTextContent('Elige la dirección y te mostramos costo y tiempo.')
  })
  it('$350 local con dirección guardada: recoger elegido y la dirección NO se muestra (no es un envío)', async () => {
    montar({ subtotal: 350 })
    await listo(); await waitFor(() => expect(marcado('recoge')).toBe(true))
    expect(screen.queryByTestId('checkout-direccion')).toBeNull()
    expect(seVe('checkout-direccion-selector')).toBe(false)
    expect(screen.queryByTestId('entrega-local_chofer')).toBeNull()   // los servicios a domicilio no aparecen desde el inicio
  })
})

describe('enviar a domicilio', () => {
  it('2/4 · recoger → domicilio con $350 local: dirección predeterminada, chofer "Gratis desde $500", faltan $150, sin confirmar; NO vuelve a recoger solo', async () => {
    montar({ subtotal: 350 })
    await listo()
    fireEvent.click(screen.getByTestId('entrega-domicilio'))
    expect(marcado('domicilio')).toBe(true); expect(marcado('recoge')).toBe(false)
    expect(screen.getByTestId('checkout-direccion-resumen')).toHaveTextContent('Calle Consultorio 100')   // 8 · predeterminada
    expect(chip('local_chofer')).toBe('Gratis desde $500')
    expect(screen.getByTestId('entrega-local_chofer-texto')).toHaveTextContent('Agrega $150 en productos para recibirlo gratis')
    expect(screen.getAllByTestId('checkout-agregar')).toHaveLength(1)
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    expect(screen.getByTestId('checkout-pie')).toHaveTextContent('envío por definir')
    expect(screen.queryByTestId('entrega-foraneo_dhl')).toBeNull()   // DHL no se ofrece en dirección local
    await new Promise((r) => setTimeout(r, 20))
    expect(marcado('domicilio')).toBe(true)
  })
  it('3 · domicilio → recoger: el bloque de envío y la dirección desaparecen, total sin flete, se puede confirmar', async () => {
    montar({ subtotal: 350 })
    await listo()
    fireEvent.click(screen.getByTestId('entrega-domicilio'))
    fireEvent.click(screen.getByTestId('entrega-recoge'))
    expect(marcado('recoge')).toBe(true)
    expect(screen.queryByTestId('checkout-domicilio')).toBeNull()
    expect(screen.queryByTestId('checkout-direccion')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$350')
    expect(screen.getByTestId('checkout-crear')).not.toBeDisabled()
  })
  it('5 · $500 local: abre en domicilio con chofer gratis (regla del servidor)', async () => {
    montar({ subtotal: 500 })
    await listo(); await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    expect(marcado('domicilio')).toBe(true)
    expect(chip('local_chofer')).toBe('Gratis')
    expect(screen.queryByTestId('checkout-agregar')).toBeNull()
  })
  it('6/16 · foráneo $350: DHL $600 con el faltante una vez; desglose y total $950 del servidor', async () => {
    h.ubicaciones = [{ ...L2, is_default: true }, { ...L1, is_default: false }]
    montar({ subtotal: 350 })
    await listo(); await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))
    expect(chip('foraneo_dhl')).toBe('$600')
    expect(screen.getByTestId('entrega-foraneo_dhl-nota')).toHaveTextContent('Gratis desde $5,000 · agrega $4,650')
    expect(screen.queryByTestId('entrega-local_chofer')).toBeNull()
    expect(screen.queryByTestId('entrega-foraneo_t1')).toBeNull()   // T1 desactivado
    expect(screen.getByTestId('checkout-productos')).toHaveTextContent('$350')
    expect(screen.getByTestId('checkout-envio')).toHaveTextContent('$600')
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$950')
    expect(screen.getByTestId('checkout-pie').textContent?.match(/\$600/g)).toHaveLength(1)   // el flete no se repite en el pie
  })
  it('7 · foráneo $5,000: DHL gratis, sin desglose; total $5,000', async () => {
    h.ubicaciones = [{ ...L2, is_default: true }]
    montar({ subtotal: 5000 })
    await listo(); await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))
    expect(chip('foraneo_dhl')).toBe('Gratis')
    expect(screen.queryByTestId('entrega-foraneo_dhl-nota')).toBeNull()
    expect(screen.queryByTestId('checkout-desglose')).toBeNull()
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$5,000')
  })
})

describe('dirección dentro del envío', () => {
  it('9 · otra dirección guardada (local): se revisa con ella y se conserva el chofer elegido', async () => {
    const s = montar({ subtotal: 500 })
    await listo(); await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    elegirUbicacion(/Norte/)
    await waitFor(() => expect(s.rev[s.rev.length - 1].loc).toBe('L3'))
    await waitFor(() => expect(screen.queryByTestId('checkout-actualizando')).toBeNull())
    expect(marcado('local_chofer')).toBe(true)
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
    expect(h.predeterminar).toEqual([])   // la predeterminada del doctor no se toca
  })
  it('10 · nueva dirección solo para este pedido: se revisa con su C.P. y aparece DHL', async () => {
    const s = montar({ subtotal: 1050 })
    await listo(); await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    fireEvent.click(screen.getByTestId('checkout-direccion-cambiar'))
    fireEvent.click(screen.getByText(/Enviar a otra dirección \(solo este pedido\)/))
    fireEvent.change(screen.getByPlaceholderText('Calle y número'), { target: { value: 'Av. del Mar 1020' } })
    fireEvent.change(screen.getByLabelText('Código postal'), { target: { value: '82000' } })
    fireEvent.change(screen.getByPlaceholderText('Ciudad'), { target: { value: 'Mazatlán' } })
    fireEvent.change(screen.getByLabelText('Teléfono de quien recibe'), { target: { value: '6691234567' } })
    await waitFor(() => expect(s.rev.some((r) => r.dir?.cp === '82000' && !r.loc)).toBe(true))
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl')).toBeInTheDocument())
    expect(chip('foraneo_dhl')).toBe('$600')
    expect(h.predeterminar).toEqual([])
  })
  it('11/15 · local → foránea: el chofer deja de valer → aviso, sin selección y sin confirmar; sigue en domicilio (no pasa a recoger)', async () => {
    const s = montar({ subtotal: 500 })
    await listo(); await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    elegirUbicacion(/Casa/)
    await waitFor(() => expect(screen.getByTestId('checkout-entrega-aviso')).toHaveTextContent('Entrega con chofer: no aplica para esta dirección. Elige otra opción.'))
    expect(marcado('domicilio')).toBe(true); expect(marcado('recoge')).toBe(false)
    expect(marcado('foraneo_dhl')).toBe(false)
    expect(chip('foraneo_dhl')).toBe('$600')
    const n = s.rev.length
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(s.rev.length).toBe(n); expect(s.confirmar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('entrega-foraneo_dhl'))
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('$1,100')
    await waitFor(() => expect(screen.getByTestId('checkout-crear')).not.toBeDisabled())
  })
  it('12 · foránea → local: DHL deja de valer → aviso; el doctor elige el chofer; sigue en domicilio', async () => {
    h.ubicaciones = [{ ...L2, is_default: true }, { ...L1, is_default: false }]
    montar({ subtotal: 500 })
    await listo(); await waitFor(() => expect(marcado('foraneo_dhl')).toBe(true))
    elegirUbicacion(/Consultorio/)
    await waitFor(() => expect(screen.getByTestId('checkout-entrega-aviso')).toHaveTextContent('Envío por DHL: no aplica para esta dirección.'))
    expect(marcado('domicilio')).toBe(true)
    expect(screen.queryByTestId('entrega-foraneo_dhl')).toBeNull()
    fireEvent.click(screen.getByTestId('entrega-local_chofer'))
    expect(marcado('local_chofer')).toBe(true)
    expect(screen.queryByTestId('checkout-entrega-aviso')).toBeNull()
  })
})

describe('agregar productos', () => {
  it('13 · regresa al catálogo y, al volver, reabre en domicilio con la dirección que eligió (carrito en el servidor)', async () => {
    const onClose = vi.fn()
    montar({ subtotal: 350, onClose })
    await listo()
    fireEvent.click(screen.getByTestId('entrega-domicilio'))
    elegirUbicacion(/Norte/)
    await waitFor(() => expect(screen.getByTestId('entrega-local_chofer')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('checkout-agregar'))
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()   // el catálogo cierra el checkout; el doctor agrega productos y vuelve
    const s2 = montar({ subtotal: 500 })
    await listo()
    expect(marcado('domicilio')).toBe(true)
    await waitFor(() => expect(screen.getByTestId('checkout-direccion-resumen')).toHaveTextContent('Calle Norte 100'))
    await waitFor(() => expect(s2.rev.some((r) => r.loc === 'L3')).toBe(true))
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    expect(chip('local_chofer')).toBe('Gratis')
    expect(h.predeterminar).toEqual([])
  })
})

describe('14 · revisión pendiente o fallida', () => {
  it('cambio de dirección con revisión pendiente: bloqueado y una respuesta tardía de la anterior no se muestra', async () => {
    const s = montar({ subtotal: 500, manual: true })
    await waitFor(() => expect(s.cola.length).toBe(1)); await s.liberar()
    await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    elegirUbicacion(/Casa/)
    await waitFor(() => expect(s.cola.length).toBe(1))
    expect(screen.getByTestId('checkout-actualizando')).toBeInTheDocument()
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    fireEvent.click(screen.getAllByText(/Norte/)[0])
    await waitFor(() => expect(s.cola.length).toBe(2))
    await s.liberar(1); await s.liberar(0)
    while (s.cola.length) await s.liberar()
    await waitFor(() => expect(screen.queryByTestId('checkout-actualizando')).toBeNull())
    expect(screen.queryByTestId('entrega-foraneo_dhl')).toBeNull()
    expect(screen.getByTestId('entrega-local_chofer')).toBeInTheDocument()
  })
  it('error al revisar: sin confirmar con los datos anteriores y "Reintentar" recupera', async () => {
    let fallar = true
    const s = montar({ subtotal: 1050, falla: (l) => l === 'L2' && fallar })
    await listo(); await waitFor(() => expect(marcado('local_chofer')).toBe(true))
    elegirUbicacion(/Casa/)
    await waitFor(() => expect(screen.getByTestId('checkout-error-revision')).toHaveTextContent('No hay conexión'))
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(s.confirmar).not.toHaveBeenCalled()
    fallar = false
    fireEvent.click(screen.getByTestId('checkout-reintentar'))
    await waitFor(() => expect(screen.queryByTestId('checkout-error-revision')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('entrega-foraneo_dhl')).toBeInTheDocument())
  })
})
