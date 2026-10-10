// Barra de venta del Punto de venta en teléfono (≤900 px). En móvil el ticket queda DEBAJO de toda la
// rejilla de productos: con el catálogo real el botón Cobrar estaba a varias pantallas de distancia y el
// vendedor no veía ni cuánto llevaba. La barra muestra unidades y total, y lleva al ticket. Se oculta
// sola cuando el ticket ya está a la vista. Reutiliza el contrato visual y de estado de la barra del
// carrito del doctor (.rc-cart-bar y body.rc-barra-carrito): no hay otro carrito ni otro cobro.
import React, { useEffect, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { CLASE_BODY_BARRA, useChatAbierto, useEsMovil } from '../doctor/BarraCarrito'

export function BarraVenta({ unidades, total, ancla }: {
  unidades: number
  total: number
  /** El ticket: destino del botón y referencia para ocultar la barra cuando ya se ve. */
  ancla: React.RefObject<HTMLElement | null>
}) {
  const movil = useEsMovil()
  const chat = useChatAbierto()
  const [ticketALaVista, setTicketALaVista] = useState(false)

  useEffect(() => {
    const el = ancla.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setTicketALaVista(e.isIntersecting && e.intersectionRatio > 0.15), { threshold: [0, 0.15, 0.5] })
    io.observe(el)
    return () => io.disconnect()
  }, [ancla, movil])

  const visible = movil && !chat && unidades > 0 && !ticketALaVista

  useEffect(() => {
    if (!visible) return
    document.body.classList.add(CLASE_BODY_BARRA)
    return () => document.body.classList.remove(CLASE_BODY_BARRA)
  }, [visible])

  if (!visible) return null
  const texto = `${unidades} producto${unidades === 1 ? '' : 's'}`
  return (
    <div className="rc-cart-bar" data-testid="barra-venta">
      <Icon name="store" aria-hidden className="rc-cart-bar-ico" />
      <div className="rc-cart-bar-txt" role="status" aria-live="polite">
        <span className="rc-cart-bar-n">{texto}</span>
        <span className="rc-cart-bar-total"><span className="rc-cart-bar-lbl">Total </span><b>{money(total)}</b></span>
      </div>
      <button
        type="button"
        className="btn rc-cart-bar-btn"
        aria-label={`Ir a cobrar: ${texto}, total ${money(total)}`}
        onClick={() => ancla.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        data-testid="barra-venta-ir"
      >
        Ir a cobrar
      </button>
    </div>
  )
}
