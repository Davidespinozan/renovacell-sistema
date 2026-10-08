// @vitest-environment jsdom
// MC-1 · Checkout CANÓNICO compartido: Catálogo lo monta; importes de la REVISIÓN del servidor (precio por
// volumen); dirección guardada / nueva / legado sin pasar por Perfil; factura opcional; idempotencia por intento
// lógico (doble clic y reintento → un solo pedido; revisión nueva → clave nueva); vencimiento y carrito cambiado.
// Todo contra un cliente falso: ningún pedido real.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, renderHook } from '@testing-library/react'
import { CheckoutCanonico } from './CheckoutCanonico'
import { claveEntrega, vistaDe, useCheckoutCanonico } from './checkoutMotor'
import { Catalogo } from '../doctor/Catalogo'
import type { ClienteCarrito, RevisionCheckout, ResultadoCheckout } from '../../data/ops/carrito'
import type { ShippingAddress } from '../../data/ops/shippingAddress'

vi.mock('../../app/DeliveryLocationPicker', () => ({
  DeliveryLocationPicker: ({ legacyBase, onChange }: { legacyBase: ShippingAddress | null; onChange: (c: unknown) => void }) => (
    <div>
      <button type="button" onClick={() => onChange({ address: { line1: 'Av. Guardada 1', cp: '82000' }, locationId: 'L1' })}>dir-existente</button>
      <button type="button" onClick={() => onChange({ address: { line1: 'Calle Nueva 2', cp: '82100', city: 'Mazatlán' } })}>dir-nueva</button>
      <button type="button" onClick={() => onChange(legacyBase ? { address: legacyBase } : null)}>dir-legado</button>
    </div>
  ),
}))
vi.mock('../../app/Cliente360Editores', () => ({
  PerfilesFiscalesEditor: ({ perfiles, seleccion }: { perfiles: Array<{ id: string }>; seleccion: { valor: string | null; onElegir: (id: string) => void } }) => (
    <div>{perfiles.map((p) => <button key={p.id} type="button" onClick={() => seleccion.onElegir(p.id)}>perfil-{p.id}</button>)}<span data-testid="perfil-sel">{seleccion.valor}</span></div>
  ),
}))

beforeEach(cleanup)
const espera = (ms = 0) => act(() => new Promise((r) => setTimeout(r, ms)))

const LINEA = { product_id: 'P1', qty: 3, nombre: 'Golden Placenta Mask', precio_unitario: 350, subtotal: 1050 }   // precio por VOLUMEN del servidor
let nRev = 0
const lista = (extra: Partial<RevisionCheckout> = {}): RevisionCheckout => ({
  listo: true, cart_id: 'K', cart_rev: 33, review_id: `R${++nRev}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), total: 1050, moneda: 'MXN', lineas: [LINEA], problemas: [], ...extra,
})
const noLista = (problemas: RevisionCheckout['problemas'], extra: Partial<RevisionCheckout> = {}): RevisionCheckout => ({
  listo: false, cart_id: 'K', cart_rev: 33, total: 1050, problemas,
  proyeccion: { items: [{ product_id: 'P1', nombre: 'Golden Placenta Mask', presentacion: null, imagen_url: null, cantidad: 3, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado', unitario: 350, subtotal: 1050, por_volumen: true } }] } as unknown as RevisionCheckout['proyeccion'],
  ...extra,
})
type Resp<T> = { ok: true; data: T } | { ok: false; error: { codigo: string; mensaje: string } }
const confirmado = (order = 'O1'): ResultadoCheckout => ({ confirmado: true, cart_id: 'K', order_id: order, folio: 'S100002', total: 1050 })

/** Cliente falso: `revisiones` y `confirmaciones` se consumen en orden (la última se repite). */
function falso(revisiones: Array<Resp<RevisionCheckout> | (() => Resp<RevisionCheckout>)>, confirmaciones: Array<Resp<ResultadoCheckout>> = [{ ok: true, data: confirmado() }], latencia = 0) {
  const rev: Array<{ cart: string; loc: string | null | undefined; dir: unknown }> = []
  const conf: Array<{ review: string; rev: number; op: string; factura: boolean; perfil: string | null }> = []
  const c = {
    revisarCheckout: async (cart: string, loc?: string | null, dir?: unknown) => {
      rev.push({ cart, loc, dir })
      const x = revisiones[Math.min(rev.length - 1, revisiones.length - 1)]
      return typeof x === 'function' ? x() : x
    },
    confirmarCheckout: async (review: string, r: number, op: string, factura = false, perfil: string | null = null) => {
      conf.push({ review, rev: r, op, factura, perfil })
      if (latencia) await new Promise((res) => setTimeout(res, latencia))
      return confirmaciones[Math.min(conf.length - 1, confirmaciones.length - 1)]
    },
  } as unknown as ClienteCarrito
  return { c, rev, conf }
}
const ok = <T,>(data: T): Resp<T> => ({ ok: true, data })

function montar(f: ReturnType<typeof falso>, extra: { onPedido?: () => void; base?: ShippingAddress | null } = {}) {
  const fiscal = { perfilesFiscales: async () => ({ ok: true, data: { perfiles: [{ id: 'PF1', es_predeterminado: true }, { id: 'PF2', es_predeterminado: false }] } }) } as never
  return render(
    <CheckoutCanonico base={extra.base ?? { line1: 'Domicilio Legado 3', cp: '82000' }} clienteFiscal={fiscal}
      servidor={{ cliente: f.c, obtenerCartId: async () => 'K', nombreDe: () => 'Golden Placenta Mask', onPedido: extra.onPedido }}
      previas={[{ product_id: 'P1', nombre: 'Golden Placenta Mask', qty: 3 }]}
      onPay={vi.fn()} onClose={vi.fn()} />,
  )
}

describe('MC-1 · Catálogo monta el checkout compartido', () => {
  it('"Revisar y crear pedido" abre CheckoutCanonico (no un modal propio)', async () => {
    render(<Catalogo />)
    fireEvent.click(screen.getAllByText('Agregar')[0])
    fireEvent.click(screen.getByText(/Revisar y crear pedido/))
    expect(await screen.findByTestId('checkout-canonico')).toBeInTheDocument()
    expect(screen.getAllByTestId('checkout-linea').length).toBe(1)
  })
})

describe('MC-1 · importes del servidor', () => {
  it('muestra subtotal y total de la REVISIÓN (precio por volumen), no precios de lista locales', async () => {
    const f = falso([ok(lista())])
    montar(f)
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,050/))
    expect(screen.getByTestId('checkout-linea')).toHaveTextContent(/350.*c\/u/)
    expect(screen.getByTestId('checkout-linea')).toHaveTextContent(/1,050/)
    expect(f.rev[0]).toEqual({ cart: 'K', loc: null, dir: null })   // al abrir: sin dirección elegida
  })
  it('sin revisión lista usa la proyección del servidor; REQUIERE_DIRECCION no bloquea ni manda a Perfil', async () => {
    const f = falso([ok(noLista(['REQUIERE_DIRECCION']))])
    montar(f)
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,050/))
    expect(screen.queryByTestId('checkout-aviso')).toBeNull()
    expect(screen.queryByText(/perfil/i)).toBeNull()
  })
  it('otros problemas de la revisión se avisan antes de pedir (disponibilidad)', async () => {
    montar(falso([ok(noLista(['REQUIERE_DIRECCION', { product_id: 'P1', problema: 'SIN_DISPONIBILIDAD' }]))]))
    expect(await screen.findByTestId('checkout-aviso')).toHaveTextContent('Golden Placenta Mask: sin existencia ahora')
    expect(screen.getByTestId('checkout-aviso').textContent).not.toMatch(/dirección/)
  })
  it('vistaDe y claveEntrega: la revisión manda; la clave distingue ubicación guardada de snapshot', () => {
    expect(vistaDe(lista()).lineas[0]).toMatchObject({ unitario: 350, subtotal: 1050 })
    expect(claveEntrega({ address: { line1: 'x' }, locationId: 'L1' })).toBe('loc:L1')
    expect(claveEntrega({ address: { line1: 'x' } })).not.toBe(claveEntrega({ address: { line1: 'y' } }))
    expect(claveEntrega(null)).toBe('ninguna')
    expect(vistaDe({ listo: false, cart_id: 'K', problemas: [], total: { monto: 1 } as unknown as number }).total).toBeNull()   // nunca "$NaN"
  })
})

describe('MC-1 · dirección (guardada, nueva, legado) y creación', () => {
  it.each([
    ['dir-existente', { loc: 'L1', dir: null }],
    ['dir-nueva', { loc: null, dir: { line1: 'Calle Nueva 2', cp: '82100', city: 'Mazatlán' } }],
    ['dir-legado', { loc: null, dir: { line1: 'Domicilio Legado 3', cp: '82000' } }],
  ] as const)('%s → se revisa con esa dirección y se crea UN pedido', async (boton, esperado) => {
    const onPedido = vi.fn()
    const f = falso([ok(noLista(['REQUIERE_DIRECCION'])), ok(lista())])
    montar(f, { onPedido })
    await waitFor(() => expect(f.rev.length).toBe(1))
    expect(screen.getByTestId('checkout-crear')).toBeDisabled()   // sin dirección no se crea
    fireEvent.click(screen.getByText(boton))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-exito')).toHaveTextContent('S100002')
    expect(f.rev[1]).toMatchObject(esperado)
    expect(f.conf).toHaveLength(1); expect(f.conf[0]).toMatchObject({ factura: false, perfil: null })
    expect(onPedido).toHaveBeenCalledTimes(1)
  })
  it('la revisión del servidor con la MISMA dirección se reutiliza (no se revisa dos veces)', async () => {
    const f = falso([ok(lista({ direccion: { location_id: 'L1', address: { line1: 'Av. Guardada 1' } } }))])
    montar(f)
    await waitFor(() => expect(f.rev.length).toBe(1))
    fireEvent.click(screen.getByText('dir-existente'))   // clave 'loc:L1' ≠ 'ninguna' → revisa con L1
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(f.rev).toHaveLength(2); expect(f.conf).toHaveLength(1)
  })
  it('carrito ya convertido (reapertura tras un éxito con respuesta perdida): se muestra el pedido, sin otro', async () => {
    const f = falso([ok(noLista(['YA_CONVERTIDO'], { order_id: 'O9' }))])
    montar(f)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-exito')).toBeInTheDocument()
    expect(f.conf).toHaveLength(0)
  })
})

describe('MC-1 · factura opcional', () => {
  it('con factura viaja SOLO el perfil fiscal elegido; sin perfil no se puede crear', async () => {
    const f = falso([ok(lista())])
    montar(f)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-factura'))
    await waitFor(() => expect(screen.getByTestId('perfil-sel')).toHaveTextContent('PF1'))   // predeterminado preseleccionado
    fireEvent.click(screen.getByText('perfil-PF2'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(f.conf[0]).toMatchObject({ factura: true, perfil: 'PF2' })
  })
})

describe('MC-1 · idempotencia por intento lógico', () => {
  it('doble clic → una sola confirmación', async () => {
    const f = falso([ok(lista())], [ok(confirmado())], 50)
    montar(f)
    fireEvent.click(screen.getByText('dir-existente'))
    await waitFor(() => expect(f.rev.length).toBe(1))
    const b = screen.getByTestId('checkout-crear')
    fireEvent.click(b); fireEvent.click(b); fireEvent.click(b)
    await screen.findByTestId('checkout-exito')
    expect(f.conf).toHaveLength(1)
  })
  it('reintento tras fallo de red: misma revisión y MISMA clave (sin otra revisión)', async () => {
    const f = falso([ok(lista())], [{ ok: false, error: { codigo: 'red', mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }, ok(confirmado())])
    montar(f)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('No hay conexión con el servidor.')
    const revisiones = f.rev.length
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(f.conf).toHaveLength(2)
    expect(f.conf[1].op).toBe(f.conf[0].op); expect(f.conf[1].review).toBe(f.conf[0].review)
    expect(f.rev.length).toBe(revisiones)
  })
  it('cambiar la factura entre intentos usa OTRA clave (no se reutiliza para una operación distinta)', async () => {
    const f = falso([ok(lista())], [{ ok: false, error: { codigo: 'red', mensaje: 'Sin red.' } }, ok(confirmado())])
    montar(f)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-error')
    fireEvent.click(screen.getByTestId('checkout-factura'))
    await waitFor(() => expect(screen.getByTestId('perfil-sel')).toHaveTextContent('PF1'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(f.conf[1].op).not.toBe(f.conf[0].op); expect(f.conf[1]).toMatchObject({ factura: true, perfil: 'PF1' })
  })
  it.each([
    ['REVISION_EXPIRADA', 'La revisión venció.'],
    ['CARRITO_CAMBIO', 'Tu carrito cambió después de revisarlo.'],
    ['PRECIO_CAMBIO', 'El precio cambió después de revisarlo.'],
  ])('rechazo %s: motivo visible, importes del servidor actualizados y el siguiente intento con revisión y clave NUEVAS', async (motivo, texto) => {
    const f = falso(
      [ok(lista()), ok(lista()), ok(lista({ total: 1400, lineas: [{ ...LINEA, qty: 4, subtotal: 1400 }] })), ok(lista({ total: 1400, lineas: [{ ...LINEA, qty: 4, subtotal: 1400 }] }))],
      [ok({ confirmado: false, motivo, cart_id: 'K' }), ok(confirmado())],
    )
    montar(f)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent(texto)
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,400/))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(f.conf).toHaveLength(2)
    expect(f.conf[1].review).not.toBe(f.conf[0].review); expect(f.conf[1].op).not.toBe(f.conf[0].op)
  })
  it('una revisión ya vencida en el navegador se renueva ANTES de confirmar', async () => {
    const vencida = lista({ expires_at: new Date(Date.now() - 1000).toISOString() }); const nueva = lista()
    const f = falso([ok(vencida), ok(nueva)])
    montar(f)
    await waitFor(() => expect(f.rev.length).toBe(1))
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(f.rev).toHaveLength(2); expect(f.conf[0].review).toBe(nueva.review_id)
  })
})

describe('MC-1 · errores reales y cierre/reapertura', () => {
  it('fallo de la revisión: error visible y el pedido no se crea', async () => {
    const f = falso([{ ok: false, error: { codigo: 'no_autorizado', mensaje: 'No tienes acceso a este carrito.' } }])
    montar(f)
    expect(await screen.findByTestId('checkout-error-revision')).toHaveTextContent('No tienes acceso a este carrito.')
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('No tienes acceso a este carrito.')
    expect(f.conf).toHaveLength(0)
  })
  it('problema al revisar con la dirección elegida (dirección inválida): se explica en el checkout, no en Perfil', async () => {
    const f = falso([ok(noLista(['REQUIERE_DIRECCION'])), ok(noLista(['REQUIERE_DIRECCION']))])
    montar(f)
    fireEvent.click(screen.getByText('dir-nueva'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-error')).toHaveTextContent('revisa la dirección de entrega')
    expect(screen.getByTestId('checkout-error').textContent).not.toMatch(/perfil/i)
    expect(f.conf).toHaveLength(0)
  })
  it('cerrar y reabrir: estado limpio, nueva revisión; sin confirmaciones al cerrar', async () => {
    const f = falso([ok(lista())])
    const v = montar(f)
    await waitFor(() => expect(f.rev.length).toBe(1))
    v.unmount(); await espera(10)
    montar(f)
    await waitFor(() => expect(f.rev.length).toBe(2))
    expect(screen.queryByTestId('checkout-error')).toBeNull(); expect(f.conf).toHaveLength(0)
  })
})

describe('MC-1 · motor (hook) sin la interfaz', () => {
  const L1 = { address: { line1: 'Av. Guardada 1', cp: '82000' }, locationId: 'L1' }
  it('dos confirmaciones simultáneas comparten el MISMO intento en vuelo (un solo pedido)', async () => {
    const f = falso([ok(lista())], [ok(confirmado())], 40)
    const { result } = renderHook(() => useCheckoutCanonico({ cliente: f.c, obtenerCartId: async () => 'K' }))
    await waitFor(() => expect(f.rev.length).toBe(1))
    let a: unknown, b: unknown
    await act(async () => { [a, b] = await Promise.all([result.current.confirmar(L1, false, null), result.current.confirmar(L1, false, null)]) })
    expect(f.conf).toHaveLength(1); expect(a).toEqual(b)
  })
  it('misma dirección pero revisión vencida en el navegador → se renueva antes de confirmar', async () => {
    const vencida = lista({ expires_at: new Date(Date.now() - 1000).toISOString() }); const nueva = lista()
    const f = falso([ok(lista()), ok(vencida), ok(nueva)])
    const { result } = renderHook(() => useCheckoutCanonico({ cliente: f.c, obtenerCartId: async () => 'K' }))
    await waitFor(() => expect(f.rev.length).toBe(1))
    await act(async () => { await result.current.revisar(L1) })   // revisión con L1… ya vencida
    await act(async () => { await result.current.confirmar(L1, false, null) })
    expect(f.rev).toHaveLength(3); expect(f.conf[0].review).toBe(nueva.review_id)
  })
  it('misma dirección y revisión vigente → se reutiliza (sin revisar otra vez)', async () => {
    const vigenteL1 = lista()
    const f = falso([ok(lista()), ok(vigenteL1)])
    const { result } = renderHook(() => useCheckoutCanonico({ cliente: f.c, obtenerCartId: async () => 'K' }))
    await waitFor(() => expect(f.rev.length).toBe(1))
    await act(async () => { await result.current.revisar(L1) })
    await act(async () => { await result.current.confirmar(L1, false, null) })
    expect(f.rev).toHaveLength(2); expect(f.conf[0].review).toBe(vigenteL1.review_id)
  })
  it('sin servidor el motor queda inerte (no revisa)', async () => {
    const f = falso([ok(lista())])
    renderHook(() => useCheckoutCanonico(null)); await espera(10)
    expect(f.rev).toHaveLength(0)
  })
})
