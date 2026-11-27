// Recibo de venta COMPARTIDO entre Caja (mostrador) y Eventos (stand). Un solo lugar
// para el ticket imprimible, el envío por WhatsApp y el disparo de impresión — antes
// vivía dentro de Caja y la venta de evento se quedaba sin comprobante.
import React from 'react'
import { createPortal } from 'react-dom'
import { money, fmtDate } from '../../lib/format'
import { montoEnLetras } from '../../lib/enLetras'
import type { OrderWithItems } from '../../data/hooks/useOrders'
import { cantidadVista, type ConUnidad } from '../../lib/cajas'
import { textoMetodoPago } from '../../data/ops/money'
import { QRFactura } from '../../app/NotaVenta'
import type { EnlaceFactura } from '../../data/ops/autofactura'
import { fechaLarga } from '../../../../../supabase/functions/_shared/autofactura'

// CAJAS-MEDIOS: `unidades` (opcional) da la unidad de cada producto para mostrar la media caja en cajas
// («×1½ cajas»); sin él, o para el resto de productos, la cantidad sale igual que antes.
export type UnidadesPorProducto = Record<string, ConUnidad | undefined>

export interface Pago { recibido: number; cambio: number }

// Recibo en TEXTO para enviar por WhatsApp (wa.me abre el chat con el mensaje listo).
// No adjunta PDF —eso necesita la API de WhatsApp— pero manda el comprobante legible.
function reciboTexto(order: OrderWithItems, productName: Record<string, string>, pago: Pago | null, unidades?: UnidadesPorProducto, enlace?: EnlaceFactura | null): string {
  const L: string[] = ['*RENOVACELL* · Comprobante de venta', `Folio: ${order.external_ref}`, fmtDate(order.created_at), '']
  order.items.filter((it) => it.unit_price != null).forEach((it) => {
    L.push(`${productName[it.product_id ?? ''] ?? 'Producto'} ×${cantidadVista(unidades?.[it.product_id ?? ''], it.qty)} — ${money((it.unit_price ?? 0) * it.qty)}`)
  })
  L.push('', `*Total: ${money(order.total)}*`, `Son: ${montoEnLetras(order.total ?? 0)}`, `Pago: ${textoMetodoPago(order.payment_method) || 'Efectivo'}`)
  if (pago) L.push(`Recibí: ${money(pago.recibido)} · Cambio: ${money(pago.cambio)}`)
  if (enlace) L.push('', `¿Necesitas factura? Pídela aquí hasta el ${fechaLarga(enlace.limite)}:`, enlace.url)
  L.push('', 'No es un comprobante fiscal (CFDI).')
  return L.join('\n')
}

// Abre WhatsApp con el recibo. Con teléfono del cliente va directo; sin él, se elige contacto.
export function enviarReciboWhatsApp(order: OrderWithItems, productName: Record<string, string>, pago: Pago | null, phone?: string, unidades?: UnidadesPorProducto, enlace?: EnlaceFactura | null) {
  const digits = (phone ?? '').replace(/\D/g, '')
  const to = digits.length >= 10 ? (digits.length === 10 ? '52' + digits : digits) : ''
  const url = `https://wa.me/${to}?text=${encodeURIComponent(reciboTexto(order, productName, pago, unidades, enlace))}`
  window.open(url, '_blank')
}

// Imprime SOLO el recibo (marca el body, imprime, limpia la clase en afterprint).
export function imprimirVenta() {
  document.body.classList.add('printing-venta')
  const cleanup = () => { document.body.classList.remove('printing-venta'); window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

// Recibo de venta para el cliente (comprobante interno, NO es CFDI).
function VentaTicketView({ order, productName, clientName, pago, unidades, enlace }: { order: OrderWithItems; productName: Record<string, string>; clientName: string; pago?: Pago | null; unidades?: UnidadesPorProducto; enlace?: EnlaceFactura | null }) {
  const items = order.items.filter((it) => it.unit_price != null)
  return (
    <div className="corte-ticket">
      <div className="ct-head">
        <div className="ct-brand">RENOVACELL</div>
        <div className="ct-sub">Comprobante de venta</div>
      </div>
      <div className="ct-row"><span className="k">Folio</span><span className="v">{order.external_ref}</span></div>
      <div className="ct-row"><span className="k">Fecha</span><span className="v">{fmtDate(order.created_at)}</span></div>
      <div className="ct-row"><span className="k">Cliente</span><span className="v">{clientName}</span></div>
      <div className="ct-sep" />
      {items.map((it) => (
        <div key={it.id} className="ct-item">
          <span className="n">{productName[it.product_id ?? ''] ?? 'Producto'} <small>× {cantidadVista(unidades?.[it.product_id ?? ''], it.qty)}</small></span>
          <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
        </div>
      ))}
      <div className="ct-sep" />
      <div className="ct-dif"><span>Total</span><span>{money(order.total)}</span></div>
      <div className="ct-letra">Son: {montoEnLetras(order.total ?? 0)}</div>
      <div className="ct-row" style={{ marginTop: 6 }}><span className="k">Pago</span><span className="v" data-testid="ticket-pago">{textoMetodoPago(order.payment_method) || 'Efectivo'}</span></div>
      {pago && (<>
        <div className="ct-row"><span className="k">Recibí</span><span className="v">{money(pago.recibido)}</span></div>
        <div className="ct-row"><span className="k">Cambio</span><span className="v">{money(pago.cambio)}</span></div>
      </>)}
      <QRFactura enlace={enlace ?? null} compacto />
      <div className="ct-foot">No es un comprobante fiscal (CFDI){order.invoice_requested ? ' · CFDI solicitado aparte' : ''}</div>
    </div>
  )
}

export function VentaTicketPrint(props: { order: OrderWithItems; productName: Record<string, string>; clientName: string; pago?: Pago | null; unidades?: UnidadesPorProducto; enlace?: EnlaceFactura | null }) {
  return createPortal(<div className="venta-print-root"><VentaTicketView {...props} /></div>, document.body)
}
