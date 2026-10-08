// CC-5 → UX V2-B · El carrito canónico dentro del chat como un CHIP compacto ("1 producto · $350") que se
// expande solo cuando sirve. Vacío: no hay franja. Dueño: +/−/quitar y revisar/confirmar (CC-6); asesor o
// Dirección: solo lectura. Precio y total solo cuando el servidor los autoriza; el visitante ve "al verificar
// tu cuenta". El carrito sigue siendo del SERVIDOR: aquí no hay autoridad local.
// MC-2 · "Revisar pedido" del dueño abre el MISMO checkout canónico que Catálogo (CheckoutCanonico: dirección
// guardada/nueva/legado sin pasar por Perfil, factura, confirmación idempotente, pago). Se monta sobre el cajón;
// la conversación sigue montada debajo y al cerrar el doctor vuelve al mismo punto del chat.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ShoppingBag } from 'lucide-react'
import { carrito as clientePorDefecto, ETIQUETA_DISPONIBILIDAD, ETIQUETA_PROBLEMA, formatoMXN, type Carrito, type ClienteCarrito, type Preparacion } from '../../data/ops/carrito'
import { CheckoutCanonico, domicilioLegadoDelDoctor } from '../checkout/CheckoutCanonico'
import { payOrder, reloadOrders } from '../../data/store/ordersStore'

interface Props { conversationId?: string | null; cartId?: string | null; soloLectura?: boolean; cliente?: ClienteCarrito; intervaloMs?: number; compacto?: boolean }

export function CarritoPanel({ conversationId, cartId, soloLectura = false, cliente = clientePorDefecto, intervaloMs = 6000, compacto = true }: Props) {
  const [cart, setCart] = useState<Carrito | null>(null)
  const [abierto, setAbierto] = useState(!compacto)
  const [error, setError] = useState<string | null>(null)
  const [prep, setPrep] = useState<Preparacion | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // MC-2 · checkout canónico compartido (el mismo de Catálogo)
  const [checkout, setCheckout] = useState(false)
  const cartIdRef = useRef<string | null>(null)

  const cargar = useCallback(async () => {
    const r = cartId ? await cliente.ver(cartId) : await cliente.abrir(conversationId ?? null)
    if (!r.ok) { if (r.error.codigo !== 'sin_backend') setError(r.error.mensaje); return }
    setError(null); setCart(r.data); cartIdRef.current = r.data.cart_id
  }, [cliente, cartId, conversationId])

  useEffect(() => {
    void cargar()
    const tick = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void cargar() }
    const t = setInterval(tick, intervaloMs)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [cargar, intervaloMs])

  const mutar = async (fn: () => Promise<{ ok: boolean; error?: { mensaje: string } }>) => {
    if (ocupado || !cart) return
    setOcupado(true); setError(null)
    const r = await fn()
    if (!r.ok && r.error) setError(r.error.mensaje)
    await cargar(); setOcupado(false)
  }
  const preparar = async () => {
    if (!cart) return
    // Dueño autenticado → checkout canónico compartido (MC-2); visitante → solo preparación (CC-5) con lo que falta.
    if (cart.dueno === 'profile') { setPrep(null); setError(null); setCheckout(true); return }
    const r = await cliente.prepararCheckout(cart.cart_id)
    if (!r.ok) { setError(r.error.mensaje); return }
    setPrep(r.data)
  }

  // El checkout vive FUERA de la franja: aunque el carrito se convierta (y la franja desaparezca), el doctor ve el
  // resultado hasta cerrarlo.
  const capa = checkout && cart ? (
    <CheckoutCanonico
      base={domicilioLegadoDelDoctor()}
      servidor={{
        cliente,
        obtenerCartId: async () => cartIdRef.current,
        nombreDe: (id: string) => cart.items.find((i) => i.product_id === id)?.nombre ?? 'producto',
        onPedido: () => { void cargar(); reloadOrders() },
      }}
      previas={cart.items.map((i) => ({ product_id: i.product_id, nombre: i.nombre, qty: i.cantidad }))}
      onPay={(orderId, r) => payOrder(orderId, { method: r.method, ref: r.id, actor: 'Chat' })}
      onClose={() => { setCheckout(false); void cargar() }}
    />
  ) : null

  if (!cart) return capa
  const puedeMutar = !soloLectura && cart.rol !== 'asesor' && cart.rol !== 'supervisor' && cart.estado === 'active'
  // Vacío: ninguna franja permanente.
  if (cart.n_items === 0) return capa
  const n = cart.cantidad_total
  const titulo = cart.n_items === 0 ? 'Carrito vacío' : `${n} producto${n === 1 ? '' : 's'}`
  const monto = cart.total.estado === 'completo' && cart.total.monto != null ? formatoMXN(cart.total.monto) : cart.total.estado === 'requiere_verificacion' && cart.n_items > 0 ? 'Precio al verificar tu cuenta' : cart.total.estado === 'parcial' ? 'Total parcial' : ''

  return (
    <>
    {capa}
    <section className={`rc-cart${abierto ? ' rc-cart--abierto' : ''}`} data-testid="carrito-panel" aria-label="Carrito">
      <button type="button" className="rc-chip" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} data-testid="carrito-toggle">
        <ShoppingBag size={15} aria-hidden />
        <span className="rc-chip-txt">{titulo}{monto ? <> · <b>{monto}</b></> : null}</span>
        <ChevronDown size={15} className="rc-chip-chev" aria-hidden />
      </button>
      {abierto && (
        <div className="rc-cart-body">
          {error && <div role="alert" className="rc-error rc-error--inline">{error}</div>}
          <ul className="rc-cart-list">
            {cart.items.map((it) => (
              <li key={it.product_id} className="rc-cart-item" data-testid="carrito-item">
                <div className="rc-cart-info">
                  <div className="rc-cart-name">{it.nombre}</div>
                  <div className="rc-cart-sub">
                    {it.presentacion ? `${it.presentacion} · ` : ''}{ETIQUETA_DISPONIBILIDAD[it.disponibilidad] ?? it.disponibilidad}
                    {it.precio.estado === 'autorizado' && it.precio.unitario != null ? ` · ${formatoMXN(it.precio.unitario)} c/u${it.precio.por_volumen ? ' (volumen)' : ''}` : it.precio.estado === 'requiere_verificacion' ? ' · precio al verificar' : it.precio.estado === 'sin_precio' ? ' · precio a consultar' : ''}
                  </div>
                </div>
                <div className="rc-cart-ctl">
                  {puedeMutar && <button type="button" className="rc-mini" disabled={ocupado} aria-label="Quitar uno" onClick={() => mutar(() => it.cantidad <= 1 ? cliente.quitar(cart.cart_id, it.product_id) : cliente.actualizar(cart.cart_id, it.product_id, it.cantidad - 1))}>−</button>}
                  <span className="rc-cart-qty" data-testid="carrito-qty">{it.cantidad}</span>
                  {puedeMutar && <button type="button" className="rc-mini" disabled={ocupado || it.cantidad >= 999} aria-label="Agregar uno" onClick={() => mutar(() => cliente.actualizar(cart.cart_id, it.product_id, it.cantidad + 1))}>+</button>}
                  {puedeMutar && <button type="button" className="rc-mini rc-mini--x" disabled={ocupado} aria-label="Quitar del carrito" onClick={() => mutar(() => cliente.quitar(cart.cart_id, it.product_id))}>×</button>}
                </div>
              </li>
            ))}
          </ul>
          {cart.n_items > 0 && (
            <div className="rc-cart-foot">
              <span className="rc-cart-total">
                {cart.total.estado === 'completo' && cart.total.monto != null ? <>Total <b>{formatoMXN(cart.total.monto)}</b> <span className="rc-muted">· se recalcula al pedir</span></>
                  : cart.total.estado === 'requiere_verificacion' ? 'Guarda tu carrito y consulta precios verificando tu cuenta.' : 'Algunos precios se confirman al pedir.'}
              </span>
              {puedeMutar && <div className="rc-cart-actions">
                <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => mutar(() => cliente.vaciar(cart.cart_id))} data-testid="carrito-vaciar">Vaciar</button>
                <button type="button" className="btn sm" disabled={ocupado} onClick={preparar} data-testid="carrito-revisar">{cart.dueno === 'profile' ? 'Revisar pedido' : 'Revisar para pedir'}</button>
              </div>}
            </div>
          )}
          {prep && (
            <div className={`rc-note ${prep.listo ? 'rc-note--ok' : 'rc-note--warn'}`} data-testid="carrito-preparacion">
              {prep.listo ? 'Todo listo para convertirlo en pedido. Un asesor o el portal completarán la compra.' : `Antes de pedir: ${prep.problemas.map((x) => typeof x === 'string' ? ETIQUETA_PROBLEMA[x] ?? x : `${cart.items.find((i) => i.product_id === x.product_id)?.nombre ?? 'producto'}: ${ETIQUETA_PROBLEMA[x.problema] ?? x.problema}`).join(' · ')}`}
            </div>
          )}
        </div>
      )}
    </section>
    </>
  )
}
