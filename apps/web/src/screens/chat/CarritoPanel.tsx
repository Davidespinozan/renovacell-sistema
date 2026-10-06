// CC-5 · Panel compacto del carrito canónico dentro del chat (dueño: +/−/quitar; asesor o
// Dirección: solo lectura). Precio y total solo cuando el servidor los autoriza; el visitante ve
// "al verificar tu cuenta". Sin checkout todavía: "Revisar para pedir" solo valida (lectura).
import React, { useCallback, useEffect, useState } from 'react'
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
    const t = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void cargar() }, intervaloMs)
    return () => clearInterval(t)
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
  const titulo = `Carrito · ${cart.n_items === 0 ? 'vacío' : `${cart.cantidad_total} pza${cart.cantidad_total === 1 ? '' : 's'}`}`

  return (
    <section style={estilos.panel} data-testid="carrito-panel" aria-label="Carrito">
      <button type="button" onClick={() => setAbierto((a) => !a)} style={estilos.cabecera} aria-expanded={abierto} data-testid="carrito-toggle">
        <span style={{ fontWeight: 600 }}>{titulo}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3, #667)' }}>
          {cart.total.estado === 'completo' && cart.total.monto != null ? formatoMXN(cart.total.monto) : cart.total.estado === 'requiere_verificacion' && cart.n_items > 0 ? 'Precio al verificar tu cuenta' : cart.total.estado === 'parcial' ? 'Total parcial' : ''}
          {' '}{abierto ? '▴' : '▾'}
        </span>
      </button>
      {abierto && (
        <div style={{ padding: '0 12px 10px' }}>
          {error && <div role="alert" style={estilos.error}>{error}</div>}
          {cart.n_items === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3, #667)' }}>Aún no agregas productos. Pídeselo al asistente o búscalos en el catálogo.</div>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cart.items.map((it) => (
              <li key={it.product_id} style={estilos.fila} data-testid="carrito-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nombre}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3, #667)' }}>
                    {it.presentacion ? `${it.presentacion} · ` : ''}{ETIQUETA_DISPONIBILIDAD[it.disponibilidad] ?? it.disponibilidad}
                    {it.precio.estado === 'autorizado' && it.precio.unitario != null ? ` · ${formatoMXN(it.precio.unitario)} c/u${it.precio.por_volumen ? ' (volumen)' : ''}` : it.precio.estado === 'requiere_verificacion' ? ' · precio al verificar' : it.precio.estado === 'sin_precio' ? ' · precio a consultar' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {puedeMutar && <button type="button" className="btn" style={estilos.mini} disabled={ocupado} aria-label="Quitar uno" onClick={() => mutar(() => it.cantidad <= 1 ? cliente.quitar(cart.cart_id, it.product_id) : cliente.actualizar(cart.cart_id, it.product_id, it.cantidad - 1))}>−</button>}
                  <span style={{ minWidth: 22, textAlign: 'center', fontSize: 14 }} data-testid="carrito-qty">{it.cantidad}</span>
                  {puedeMutar && <button type="button" className="btn" style={estilos.mini} disabled={ocupado || it.cantidad >= 999} aria-label="Agregar uno" onClick={() => mutar(() => cliente.actualizar(cart.cart_id, it.product_id, it.cantidad + 1))}>+</button>}
                  {puedeMutar && <button type="button" className="btn" style={estilos.mini} disabled={ocupado} aria-label="Quitar del carrito" onClick={() => mutar(() => cliente.quitar(cart.cart_id, it.product_id))}>×</button>}
                </div>
              </li>
            ))}
          </ul>
          {cart.n_items > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>
                {cart.total.estado === 'completo' && cart.total.monto != null ? <>Total <b>{formatoMXN(cart.total.monto)}</b> <span style={{ color: 'var(--ink-3, #667)' }}>(se recalcula al pedir)</span></>
                  : cart.total.estado === 'requiere_verificacion' ? 'Guarda tu carrito y consulta precios verificando tu cuenta.' : 'Algunos precios se confirman al pedir.'}
              </span>
              {puedeMutar && <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn" disabled={ocupado} onClick={() => mutar(() => cliente.vaciar(cart.cart_id))} data-testid="carrito-vaciar">Vaciar</button>
                <button type="button" className="btn btn-primary" disabled={ocupado} onClick={preparar} data-testid="carrito-revisar">{cart.dueno === 'profile' ? 'Revisar y confirmar pedido' : 'Revisar para pedir'}</button>
              </div>}
            </div>
          )}
          {revision && (
            <div style={{ marginTop: 8, fontSize: 13, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line, #e5e7eb)', background: 'var(--card, #fff)' }} data-testid="checkout-revision">
              {revision.listo ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Revisa tu pedido</div>
                  <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>{(revision.lineas ?? []).map((l) => <li key={l.product_id}>{l.nombre} × {l.qty} · {formatoMXN(l.precio_unitario)} c/u = {formatoMXN(l.subtotal)}</li>)}</ul>
                  <div>Entrega: {revision.direccion?.address.line1}{revision.direccion?.address.cp ? `, C.P. ${revision.direccion.address.cp}` : ''}{revision.direccion?.address.city ? `, ${revision.direccion.address.city}` : ''}</div>
                  <div style={{ marginTop: 4 }}>Total actual <b>{formatoMXN(revision.total ?? 0)}</b> · el precio se vuelve a verificar al confirmar · esta revisión vence en 15 min</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button type="button" className="btn btn-primary" disabled={ocupado} onClick={confirmar} data-testid="checkout-confirmar">Confirmar pedido</button>
                    <button type="button" className="btn" disabled={ocupado} onClick={() => setRevision(null)}>Cancelar</button>
                  </div>
                </>
              ) : (
                <div style={{ color: '#92400e' }} data-testid="checkout-no-listo">Antes de confirmar: {revision.problemas.map((x) => typeof x === 'string' ? ETIQUETA_PROBLEMA[x] ?? x : `${cart.items.find((i) => i.product_id === x.product_id)?.nombre ?? 'producto'}: ${ETIQUETA_PROBLEMA[x.problema] ?? x.problema}`).join(' · ')}</div>
              )}
            </div>
          )}
          {pedido && (
            <div style={{ marginTop: 8, fontSize: 13, padding: '10px 12px', borderRadius: 8, background: pedido.confirmado ? '#f0fdf4' : '#fffbeb', color: pedido.confirmado ? '#166534' : '#92400e' }} data-testid="checkout-resultado">
              {pedido.confirmado ? (
                <>
                  <div style={{ fontWeight: 600 }}>Pedido {pedido.folio} creado · {formatoMXN(pedido.total ?? 0)}</div>
                  <div>Pago pendiente. Elige cómo pagar:</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {pedido.acciones_pago?.includes('tarjeta') && pedido.order_id && <button type="button" className="btn btn-primary" onClick={() => void startStripeCheckout(pedido.order_id!)} data-testid="checkout-pagar-tarjeta">Pagar con tarjeta</button>}
                    {pedido.acciones_pago?.includes('transferencia') && <span style={{ alignSelf: 'center' }}>o reporta tu transferencia desde <b>Mis pedidos</b> en el portal.</span>}
                  </div>
                </>
              ) : (
                <div>{ETIQUETA_MOTIVO[pedido.motivo ?? ''] ?? 'No se pudo confirmar.'}{pedido.motivo === 'PRECIO_CAMBIO' && pedido.total_actual != null ? ` Total actual: ${formatoMXN(pedido.total_actual)}.` : ''} Vuelve a revisar tu pedido.</div>
              )}
            </div>
          )}
          {prep && (
            <div style={{ marginTop: 8, fontSize: 13, padding: '8px 10px', borderRadius: 8, background: prep.listo ? '#f0fdf4' : '#fffbeb', color: prep.listo ? '#166534' : '#92400e' }} data-testid="carrito-preparacion">
              {prep.listo ? 'Todo listo para convertirlo en pedido. Un asesor o el portal completarán la compra.' : `Antes de pedir: ${prep.problemas.map((x) => typeof x === 'string' ? ETIQUETA_PROBLEMA[x] ?? x : `${cart.items.find((i) => i.product_id === x.product_id)?.nombre ?? 'producto'}: ${ETIQUETA_PROBLEMA[x.problema] ?? x.problema}`).join(' · ')}`}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
const estilos: Record<string, React.CSSProperties> = {
  panel: { borderBottom: '1px solid var(--line, #e5e7eb)', background: 'var(--bg-2, #fafafa)' },
  cabecera: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: 'inherit', textAlign: 'left' },
  fila: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, background: 'var(--card, #fff)' },
  mini: { padding: '2px 8px', fontSize: 13, lineHeight: 1.4 },
  error: { margin: '0 0 8px', padding: '6px 10px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 },
}
