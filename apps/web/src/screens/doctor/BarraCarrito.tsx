// MC-3 · Barra contextual del carrito en móvil (≤900px), solo en Catálogo: cantidad de unidades, total ESTIMADO y
// «Revisar pedido», que abre el MISMO CheckoutCanonico (no hay otro checkout ni otro carrito). Se apoya sobre la
// navegación inferior, respeta el safe-area y, mientras está visible, sube la burbuja del chat y su vista previa
// (clase en <body> que gestiona este componente). La visibilidad la decide el ESTADO (quien monta: checkout,
// modales, carrito convertido/inaccesible; aquí: viewport y chat abierto); el CSS solo es respaldo.
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'

export const CONSULTA_MOVIL = '(max-width: 900px)'
export const CLASE_BODY_BARRA = 'rc-barra-carrito'

/** Viewport móvil, reactivo (girar el dispositivo o cambiar el tamaño de la ventana). */
export function useEsMovil(): boolean {
  const [movil, setMovil] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(CONSULTA_MOVIL).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(CONSULTA_MOVIL)
    const cambio = () => setMovil(mq.matches)
    cambio()
    mq.addEventListener?.('change', cambio)
    return () => mq.removeEventListener?.('change', cambio)
  }, [])
  return movil
}

/** ¿Está abierto el cajón del chat? ChatFlotante marca <body class="chat-open"> mientras lo está. */
const suscribirChat = (fn: () => void) => {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  const mo = new MutationObserver(fn)
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}
const chatAbierto = () => typeof document !== 'undefined' && document.body.classList.contains('chat-open')
export function useChatAbierto(): boolean { return useSyncExternalStore(suscribirChat, chatAbierto, () => false) }

const textoUnidades = (n: number) => `${n} producto${n === 1 ? '' : 's'}`

export function BarraCarrito({ unidades, totalEstimado, bloqueada, onRevisar }: {
  unidades: number
  totalEstimado: number | null
  /** Quien monta: checkout o modal abierto, carrito convertido/inaccesible. */
  bloqueada: boolean
  onRevisar: () => void
}) {
  const movil = useEsMovil()
  const chat = useChatAbierto()
  const visible = movil && !chat && !bloqueada && unidades > 0

  // La burbuja y la vista previa del chat suben mientras la barra está visible (y bajan al ocultarse/desmontarse).
  useEffect(() => {
    if (!visible) return
    document.body.classList.add(CLASE_BODY_BARRA)
    return () => document.body.classList.remove(CLASE_BODY_BARRA)
  }, [visible])

  if (!visible) return null
  const total = totalEstimado != null ? money(totalEstimado) : null
  const resumen = `${textoUnidades(unidades)}${total ? ` · total estimado ${total}` : ''}`
  return (
    <div className="rc-cart-bar" data-testid="barra-carrito">
      <Icon name="cart" aria-hidden className="rc-cart-bar-ico" />
      {/* Anuncio no invasivo de los cambios del carrito (sin mover el foco). */}
      <div className="rc-cart-bar-txt" role="status" aria-live="polite" data-testid="barra-carrito-resumen">
        <span className="rc-cart-bar-n">{textoUnidades(unidades)}</span>
        {total && <span className="rc-cart-bar-total"><span className="rc-cart-bar-lbl">Total </span>estimado <b>{total}</b></span>}
      </div>
      <button type="button" className="btn rc-cart-bar-btn" onClick={onRevisar} aria-label={`Revisar pedido: ${resumen}`} data-testid="barra-carrito-revisar">Revisar pedido</button>
    </div>
  )
}
