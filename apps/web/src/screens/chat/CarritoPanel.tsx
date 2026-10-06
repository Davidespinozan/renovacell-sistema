// CC-5 → UX V2-B · El carrito canónico dentro del chat como un CHIP compacto ("1 producto · $350") que se
// expande solo cuando sirve. Vacío: no hay franja. Dueño: +/−/quitar y revisar/confirmar (CC-6); asesor o
// Dirección: solo lectura. Precio y total solo cuando el servidor los autoriza; el visitante ve "al verificar
// tu cuenta". El carrito sigue siendo del SERVIDOR: aquí no hay autoridad local.
import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ShoppingBag } from 'lucide-react'
import { carrito as clientePorDefecto, ETIQUETA_DISPONIBILIDAD, ETIQUETA_PROBLEMA, ETIQUETA_MOTIVO, formatoMXN, nuevaOperacion, type Carrito, type ClienteCarrito, type Preparacion, type RevisionCheckout, type ResultadoCheckout } from '../../data/ops/carrito'
import { startStripeCheckout } from '../../lib/stripe'

interface Props { conversationId?: string | null; cartId?: string | null; soloLectura?: boolean; cliente?: ClienteCarrito; intervaloMs?: number; compacto?: boolean }

export function CarritoPanel({ conversationId, cartId, soloLectura = false, cliente = clientePorDefecto, intervaloMs = 6000, compacto = true }: Props) {
  const [cart, setCart] = useState<Carrito | null>(null)
  const [abierto, setAbierto] = useState(!compacto)
  const [error, setError] = useState<string | null>(null)
  const [prep, setPrep] = useState<Preparacion | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // CC-6 · revisión (evidencia de lo que el usuario vio) → confirmación explícita → pedido W1
  const [revision, setRevision] = useState<RevisionCheckout | null>(null)
  const [pedido, setPedido] = useState<ResultadoCheckout | null>(null)
  const [opConfirmar, setOpConfirmar] = useState<string>(() => nuevaOperacion())

  const cargar = useCallback(async () => {
    const r = cartId ? await cliente.ver(cartId) : await cliente.abrir(conversationId ?? null)
    if (!r.ok) { if (r.error.codigo !== 'sin_backend') setError(r.error.mensaje); return }
    setError(null); setCart(r.data)
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
    // Dueño autenticado → revisión de checkout (CC-6); visitante → solo preparación (CC-5) con lo que falta.
    if (cart.dueno === 'profile') {
      const r = await cliente.revisarCheckout(cart.cart_id)
      if (!r.ok) { setError(r.error.mensaje); return }
      setPrep(null); setRevision(r.data); setPedido(null); setOpConfirmar(nuevaOperacion())
      return
    }
    const r = await cliente.prepararCheckout(cart.cart_id)
    if (!r.ok) { setError(r.error.mensaje); return }
    setPrep(r.data)
  }
  const confirmar = async () => {
    if (!revision?.review_id || revision.cart_rev == null || ocupado) return
    setOcupado(true); setError(null)
    // El MISMO operation_id en cada reintento: una respuesta perdida nunca crea un segundo pedido.
    const r = await cliente.confirmarCheckout(revision.review_id, revision.cart_rev, opConfirmar)
    setOcupado(false)
    if (!r.ok) { setError(r.error.mensaje); return }
    if (r.data.confirmado) { setPedido(r.data); setRevision(null); await cargar(); return }
    // Rechazo con motivo: el carrito/precio/stock cambió o la revisión venció → volver a revisar.
    setRevision(null); setPedido(r.data); await cargar()
  }

  if (!cart) return null
  const puedeMutar = !soloLectura && cart.rol !== 'asesor' && cart.rol !== 'supervisor' && cart.estado === 'active'
  // Vacío y sin un pedido recién creado: ninguna franja permanente.
  if (cart.n_items === 0 && !pedido && !revision) return null
  const n = cart.cantidad_total
  const titulo = cart.n_items === 0 ? 'Carrito vacío' : `${n} producto${n === 1 ? '' : 's'}`
  const monto = cart.total.estado === 'completo' && cart.total.monto != null ? formatoMXN(cart.total.monto) : cart.total.estado === 'requiere_verificacion' && cart.n_items > 0 ? 'Precio al verificar tu cuenta' : cart.total.estado === 'parcial' ? 'Total parcial' : ''

  return (
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
                <button type="button" className="btn sm" disabled={ocupado} onClick={preparar} data-testid="carrito-revisar">{cart.dueno === 'profile' ? 'Revisar y confirmar pedido' : 'Revisar para pedir'}</button>
              </div>}
            </div>
          )}
          {revision && (
            <div className="rc-note" data-testid="checkout-revision">
              {revision.listo ? (
                <>
                  <div className="rc-note-title">Revisa tu pedido</div>
                  <ul className="rc-note-list">{(revision.lineas ?? []).map((l) => <li key={l.product_id}>{l.nombre} × {l.qty} · {formatoMXN(l.precio_unitario)} c/u = {formatoMXN(l.subtotal)}</li>)}</ul>
                  <div>Entrega: {revision.direccion?.address.line1}{revision.direccion?.address.cp ? `, C.P. ${revision.direccion.address.cp}` : ''}{revision.direccion?.address.city ? `, ${revision.direccion.address.city}` : ''}</div>
                  <div style={{ marginTop: 4 }}>Total actual <b>{formatoMXN(revision.total ?? 0)}</b> · el precio se vuelve a verificar al confirmar · esta revisión vence en 15 min</div>
                  <div className="rc-cart-actions" style={{ marginTop: 8 }}>
                    <button type="button" className="btn sm" disabled={ocupado} onClick={confirmar} data-testid="checkout-confirmar">Confirmar pedido</button>
                    <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => setRevision(null)}>Cancelar</button>
                  </div>
                </>
              ) : (
                <div className="rc-warn" data-testid="checkout-no-listo">Antes de confirmar: {revision.problemas.map((x) => typeof x === 'string' ? ETIQUETA_PROBLEMA[x] ?? x : `${cart.items.find((i) => i.product_id === x.product_id)?.nombre ?? 'producto'}: ${ETIQUETA_PROBLEMA[x.problema] ?? x.problema}`).join(' · ')}</div>
              )}
            </div>
          )}
          {pedido && (
            <div className={`rc-note ${pedido.confirmado ? 'rc-note--ok' : 'rc-note--warn'}`} data-testid="checkout-resultado">
              {pedido.confirmado ? (
                <>
                  <div className="rc-note-title">Pedido {pedido.folio} creado · {formatoMXN(pedido.total ?? 0)}</div>
                  <div>Pago pendiente. Elige cómo pagar:</div>
                  <div className="rc-cart-actions" style={{ marginTop: 6 }}>
                    {pedido.acciones_pago?.includes('tarjeta') && pedido.order_id && <button type="button" className="btn sm" onClick={() => void startStripeCheckout(pedido.order_id!)} data-testid="checkout-pagar-tarjeta">Pagar con tarjeta</button>}
                    {pedido.acciones_pago?.includes('transferencia') && <span style={{ alignSelf: 'center' }}>o reporta tu transferencia desde <b>Mis pedidos</b> en el portal.</span>}
                  </div>
                </>
              ) : (
                <div>{ETIQUETA_MOTIVO[pedido.motivo ?? ''] ?? 'No se pudo confirmar.'}{pedido.motivo === 'PRECIO_CAMBIO' && pedido.total_actual != null ? ` Total actual: ${formatoMXN(pedido.total_actual)}.` : ''} Vuelve a revisar tu pedido.</div>
              )}
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
  )
}
