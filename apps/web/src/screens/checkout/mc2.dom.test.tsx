// @vitest-environment jsdom
// MC-2 · El Chat abre el MISMO checkout canónico que Catálogo: sobre el cajón (que sigue montado), sin bloqueo por
// dirección en Perfil, con dirección guardada/nueva, factura, importes del servidor e idempotencia del motor
// compartido. Escape/fondo/X cierran SOLO el checkout; el foco vuelve a "Revisar pedido"; el scroll se restaura.
// Navegar al checkout no muta el carrito (sin handoff), no abre/cierra el chat ni toca la conversación.
// Clientes falsos y datos sintéticos: ningún pedido real.
import React, { useEffect } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { RoleProvider, useRole } from '../../auth/RoleContext'
import type { RoleKey } from '../../app/roles'
import { ChatFlotante } from '../../app/ChatFlotante'
import { ClienteChat } from '../../data/ops/chat'
import { chatUi } from '../../data/store/chatUiStore'
import { ClienteCarrito, type Carrito } from '../../data/ops/carrito'
import type { ShippingAddress } from '../../data/ops/shippingAddress'
import panelSrc from '../chat/CarritoPanel.tsx?raw'
import catalogoSrc from '../doctor/Catalogo.tsx?raw'

const h = vi.hoisted(() => ({ carrito: null as unknown }))
vi.mock('../../data/ops/carrito', async (orig) => {
  const m = await orig<typeof import('../../data/ops/carrito')>()
  return { ...m, get carrito() { return h.carrito } }
})
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
vi.mock('../../data/ops/customer360', async (orig) => {
  const m = await orig<typeof import('../../data/ops/customer360')>()
  return { ...m, cliente360: { perfilesFiscales: async () => ({ ok: true, data: { perfiles: [{ id: 'PF1', es_predeterminado: true }] } }) } }
})

afterEach(() => { cleanup(); chatUi.reset(); sessionStorage.clear(); document.body.classList.remove('chat-open'); document.body.style.overflow = '' })

function Como({ rol, pantalla, children }: { rol: RoleKey; pantalla: string; children: React.ReactNode }) {
  const { setRole, setScreen, role, screen: s } = useRole()
  useEffect(() => { setRole(rol) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (role === rol && s !== pantalla) setScreen(pantalla) }, [role, s, rol, pantalla, setScreen])
  return role === rol && s === pantalla ? <>{children}</> : null
}

const ITEM = { product_id: 'P1', nombre: 'Golden Placenta Mask', presentacion: null, imagen_url: null, cantidad: 3, vendible: true, visible: true, disponibilidad: 'disponible', precio: { estado: 'autorizado' as const, unitario: 350, subtotal: 1050, por_volumen: true } }
const carro = (x: Partial<Carrito> = {}): Carrito => ({ cart_id: 'K', estado: 'active', dueno: 'profile', rol: 'dueno', rev: 33, conversation_id: 'C1', items: [ITEM], n_items: 1, cantidad_total: 3, total: { estado: 'completo', monto: 1050, moneda: 'MXN' }, ...x } as unknown as Carrito)
let nRev = 0
const lista = () => ({ listo: true, cart_id: 'K', cart_rev: 33, review_id: `R${++nRev}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), total: 1050, moneda: 'MXN', lineas: [{ product_id: 'P1', qty: 3, nombre: 'Golden Placenta Mask', precio_unitario: 350, subtotal: 1050 }], problemas: [] })
const sinDireccion = () => ({ listo: false, cart_id: 'K', cart_rev: 33, total: 1050, problemas: ['REQUIERE_DIRECCION'], proyeccion: carro() })

/** Carrito falso por acción de la Edge `cart`; registra todo. `revisiones` se consumen en orden (la última se repite). */
function carritoFalso(cart: Carrito, revisiones: Array<() => unknown>, confirmar: () => unknown = () => ({ confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S100002', total: 1050 }), latencia = 0) {
  const llamadas: Array<{ action: string; body: Record<string, unknown> }> = []
  let nr = 0
  const c = new ClienteCarrito(async (_fn, { body }) => {
    const action = body.action as string; llamadas.push({ action, body })
    if (action === 'abrir' || action === 'ver') return { data: cart, error: null }
    if (action === 'revisar_checkout') { const f = revisiones[Math.min(nr++, revisiones.length - 1)]; return { data: f(), error: null } }
    if (action === 'confirmar_checkout') { if (latencia) await new Promise((r) => setTimeout(r, latencia)); return { data: confirmar(), error: null } }
    return { data: null, error: { message: 'accion ' + action } }
  }, () => null)
  return { c, llamadas, de: (a: string) => llamadas.filter((l) => l.action === a) }
}
function chatFalso() {
  const acciones: string[] = []
  const c = new ClienteChat(async (_fn, { body }) => {
    const a = body.action as string; acciones.push(a)
    if (a === 'abrir') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', nuevo: false }, error: null }
    if (a === 'leer') return { data: { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'dueno', ultimo_seq: 15, leido_hasta: 15, asesor_nombre: 'Lucía', handoff: { origen: 'carrito', cart_id: 'K', fuera_horario: true, asignado: true, puede_rechazar: false }, mensajes: [{ id: 'm15', seq: 15, actor: 'system', content: 'Lucía se unió a la conversación.', created_at: 'T', propio: false }] }, error: null }
    if (a === 'leido') return { data: { ok: true }, error: null }
    return { data: null, error: { message: 'accion ' + a } }
  }, () => null)
  return { c, acciones }
}

/** Abre el cajón a mano, expande el carrito y pulsa "Revisar pedido". */
async function abrirCheckout(cart: ReturnType<typeof carritoFalso>) {
  h.carrito = cart.c
  const chat = chatFalso()
  render(<RoleProvider><Como rol="doctor" pantalla="catalogo"><ChatFlotante cliente={chat.c} intervaloMs={600_000} /></Como></RoleProvider>)
  fireEvent.click(await screen.findByTestId('chat-fab'))
  fireEvent.click(await screen.findByTestId('carrito-toggle'))
  const revisar = await screen.findByTestId('carrito-revisar')
  expect(revisar).toHaveTextContent('Revisar pedido')
  revisar.focus(); fireEvent.click(revisar)
  await screen.findByTestId('checkout-canonico')
  await waitFor(() => expect(cart.de('revisar_checkout').length).toBe(1))
  return { chat, revisar }
}

describe('MC-2 · un solo checkout', () => {
  it('Catálogo y Chat montan el MISMO CheckoutCanonico (el panel ya no tiene motor propio)', async () => {
    expect(catalogoSrc).toMatch(/<CheckoutCanonico/); expect(panelSrc).toMatch(/<CheckoutCanonico/)
    expect(panelSrc).not.toMatch(/confirmarCheckout|revisarCheckout|Revisar y confirmar pedido|en tu perfil/)
    await abrirCheckout(carritoFalso(carro(), [lista]))
    expect(screen.getAllByTestId('checkout-canonico')).toHaveLength(1)
  })
})

describe('MC-2 · dirección sin pasar por Perfil', () => {
  it('sin domicilio guardado el checkout abre; dirección nueva → snapshot validado por el servidor → UN pedido', async () => {
    const cart = carritoFalso(carro(), [sinDireccion, lista])
    await abrirCheckout(cart)
    expect(screen.queryByText(/registra una dirección|en tu perfil/i)).toBeNull()
    expect(screen.queryByTestId('checkout-aviso')).toBeNull()
    fireEvent.click(screen.getByText('dir-nueva'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-exito')).toHaveTextContent('S100002')
    expect(cart.de('revisar_checkout')[1].body).toMatchObject({ location_id: null, direccion: { line1: 'Calle Nueva 2', cp: '82100', city: 'Mazatlán' } })
    expect(cart.de('confirmar_checkout')).toHaveLength(1)
  })
  it('dirección guardada → se revisa por id de ubicación', async () => {
    const cart = carritoFalso(carro(), [sinDireccion, lista])
    await abrirCheckout(cart)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(cart.de('revisar_checkout')[1].body).toMatchObject({ location_id: 'L1', direccion: null })
  })
})

describe('MC-2 · importes, factura e idempotencia (motor compartido)', () => {
  it('precios por volumen del servidor; factura con el perfil elegido', async () => {
    const cart = carritoFalso(carro(), [lista])
    await abrirCheckout(cart)
    await waitFor(() => expect(screen.getByTestId('checkout-total')).toHaveTextContent(/1,050/))
    expect(screen.getByTestId('checkout-linea')).toHaveTextContent(/350.*c\/u/)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-factura'))
    await waitFor(() => expect(screen.getByTestId('perfil-sel')).toHaveTextContent('PF1'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    await screen.findByTestId('checkout-exito')
    expect(cart.de('confirmar_checkout')[0].body).toMatchObject({ factura: true, perfil_fiscal_id: 'PF1' })
  })
  it('doble clic → una sola confirmación; el reintento conserva la clave', async () => {
    let n = 0
    const cart = carritoFalso(carro(), [lista], () => (++n === 1 ? { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S100002', total: 1050 } : null), 40)
    await abrirCheckout(cart)
    fireEvent.click(screen.getByText('dir-existente'))
    const b = screen.getByTestId('checkout-crear')
    fireEvent.click(b); fireEvent.click(b)
    await screen.findByTestId('checkout-exito')
    expect(cart.de('confirmar_checkout')).toHaveLength(1)
  })
})

describe('MC-2 · carrito convertido', () => {
  it('tras crear el pedido la franja del carrito desaparece (carrito vacío) pero el resultado sigue visible hasta cerrarlo', async () => {
    let convertido = false
    const cart = carritoFalso(carro(), [lista], () => { convertido = true; return { confirmado: true, cart_id: 'K', order_id: 'O1', folio: 'S100002', total: 1050 } })
    const abrir = cart.c.abrir.bind(cart.c)
    ;(cart.c as unknown as { abrir: unknown }).abrir = async (...a: unknown[]) => (convertido ? { ok: true, data: carro({ items: [], n_items: 0, cantidad_total: 0, total: { estado: 'vacio' } } as Partial<Carrito>) } : (abrir as (...x: unknown[]) => unknown)(...a))
    await abrirCheckout(cart)
    fireEvent.click(screen.getByText('dir-existente'))
    fireEvent.click(screen.getByTestId('checkout-crear'))
    expect(await screen.findByTestId('checkout-exito')).toHaveTextContent('S100002')
    await waitFor(() => expect(screen.queryByTestId('carrito-panel')).toBeNull())
    expect(screen.getByTestId('checkout-exito')).toBeInTheDocument()
  })
  it('el servidor dice YA_CONVERTIDO: se informa el pedido existente y NO se ofrece confirmar', async () => {
    const cart = carritoFalso(carro(), [() => ({ listo: false, cart_id: 'K', problemas: ['YA_CONVERTIDO'], order_id: 'O-EXISTENTE' })])
    await abrirCheckout(cart)
    expect(await screen.findByTestId('checkout-ya-pedido')).toHaveTextContent('Este carrito ya es un pedido')
    expect(screen.queryByTestId('checkout-crear')).toBeNull()
    expect(cart.de('confirmar_checkout')).toHaveLength(0)
  })
  it('un carrito ya convertido en el chat no ofrece "Revisar pedido" (sin revisión innecesaria)', async () => {
    const cart = carritoFalso(carro({ estado: 'converted' } as Partial<Carrito>), [lista])
    h.carrito = cart.c
    render(<RoleProvider><Como rol="doctor" pantalla="catalogo"><ChatFlotante cliente={chatFalso().c} intervaloMs={600_000} /></Como></RoleProvider>)
    fireEvent.click(await screen.findByTestId('chat-fab'))
    fireEvent.click(await screen.findByTestId('carrito-toggle'))
    await screen.findByTestId('carrito-item')
    expect(screen.queryByTestId('carrito-revisar')).toBeNull()
    expect(cart.de('revisar_checkout')).toHaveLength(0)
  })
})

describe('MC-2 · la conversación se preserva', () => {
  it('el checkout va en un portal sobre <body>, encima del cajón; el cajón y la conversación siguen montados', async () => {
    await abrirCheckout(carritoFalso(carro(), [lista]))
    const capa = screen.getByTestId('checkout-capa')
    expect(capa.parentElement).toBe(document.body)
    expect(screen.getByTestId('chat-drawer').contains(capa)).toBe(false)
    expect(screen.getByTestId('chat-drawer')).toBeInTheDocument(); expect(screen.getByTestId('chat-canonico')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden'); expect(document.body.classList.contains('chat-open')).toBe(true)
  })
  it('Escape cierra SOLO el checkout: el cajón sigue abierto, el foco vuelve a "Revisar pedido" y el scroll se restaura', async () => {
    const { revisar } = await abrirCheckout(carritoFalso(carro(), [lista]))
    // El botón que abrió NO se deshabilita: un navegador real le quita el foco a un elemento deshabilitado y el
    // checkout ya no sabría a quién devolverlo (jsdom no lo hace; por eso se fija aquí).
    expect(revisar).not.toBeDisabled()
    expect(document.activeElement && screen.getByTestId('checkout-canonico').parentElement!.contains(document.activeElement)).toBe(true)   // foco dentro del diálogo
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByTestId('checkout-canonico')).toBeNull())
    expect(screen.getByTestId('chat-drawer')).toBeInTheDocument()
    expect(document.activeElement).toBe(revisar)
    expect(document.body.style.overflow).toBe(''); expect(document.body.classList.contains('chat-open')).toBe(true)
  })
  it('clic en el fondo del checkout cierra solo el checkout (no el cajón)', async () => {
    await abrirCheckout(carritoFalso(carro(), [lista]))
    fireEvent.click(screen.getByTestId('checkout-capa'))
    await waitFor(() => expect(screen.queryByTestId('checkout-canonico')).toBeNull())
    expect(screen.getByTestId('chat-drawer')).toBeInTheDocument()
  })
  it('Tab no escapa del diálogo (trampa de foco)', async () => {
    await abrirCheckout(carritoFalso(carro(), [lista]))
    const dialogo = screen.getByTestId('checkout-canonico')
    const enfocables = dialogo.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    const primero = enfocables[0], ultimo = enfocables[enfocables.length - 1]
    ultimo.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(primero)   // del último vuelve al primero
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(ultimo)    // y con Shift+Tab, al revés
  })
  it('abrir y cerrar el checkout: sin mutaciones del carrito (sin handoff), sin acciones de chat nuevas y sin confirmaciones', async () => {
    const cart = carritoFalso(carro(), [lista])
    const { chat } = await abrirCheckout(cart)
    const antes = [...chat.acciones]
    fireEvent.click(screen.getByLabelText('Cerrar', { selector: '.mclose' }))
    await waitFor(() => expect(screen.queryByTestId('checkout-canonico')).toBeNull())
    expect(cart.llamadas.some((l) => ['agregar', 'actualizar', 'quitar', 'vaciar', 'confirmar_checkout'].includes(l.action))).toBe(false)
    expect(cart.de('revisar_checkout')).toHaveLength(1)   // la del abrir; cerrar no revisa
    expect(chat.acciones.slice(antes.length).filter((a) => !['leer', 'leido'].includes(a))).toEqual([])
    expect(chat.acciones.slice(antes.length)).not.toContain('abrir')   // (el `abrir` inicial es del cajón, antes del checkout)
  })
})
