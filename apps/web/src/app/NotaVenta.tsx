// NOTA DE VENTA (27 nov 2026, dueño: «¿ya generamos recibos profesionales?» — no: solo había un ticket en Punto de venta y
// la remisión sin precios; los pedidos de los vendedores no le daban nada al cliente). Un comprobante para TODA venta:
// marca, datos del negocio, cliente, productos con precio, total, forma de pago y el QR para pedir la factura.
// Es un documento que ve el cliente: lleva la marca del negocio, nunca el nombre del sistema interno. No es fiscal.
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { BrandLogo } from './BrandLogo'
import { CodigoQR } from './CodigoQR'
import { money, fmtDate } from '../lib/format'
import { montoEnLetras } from '../lib/enLetras'
import { capitalizarNombre } from '../lib/nombres'
import { cantidadVista, precioVista } from '../lib/cajas'
import { useProducts } from '../data/hooks/useProducts'
import { currentCompany } from '../data/store/companyStore'
import { textoMetodoPago } from '../data/ops/money'
import { useEnlaceFactura, type EnlaceFactura } from '../data/ops/autofactura'
import { fechaLarga } from '../../../../supabase/functions/_shared/autofactura'
import type { OrderWithItems } from '../data/hooks/useOrders'

export const LEMA_MARCA = 'Tecnologías Antiedad'

/** El bloque del QR para pedir la factura. Va igual en la nota de venta, en la remisión y en el ticket. */
export function QRFactura({ enlace, compacto = false }: { enlace: EnlaceFactura | null; compacto?: boolean }) {
  if (!enlace) return null
  return (
    <div className={'qr-factura' + (compacto ? ' qr-factura--compacto' : '')} data-testid="qr-factura">
      <CodigoQR texto={enlace.url} lado={compacto ? 96 : 112} etiqueta="Código para pedir tu factura" />
      <div className="qr-factura-tx">
        <b>¿Necesitas factura?</b>
        <span>Escanea este código con la cámara de tu celular y captura tus datos fiscales.</span>
        <span data-testid="qr-factura-limite">Tienes hasta el <b>{fechaLarga(enlace.limite)}</b>. Después, tu compra entra en la factura global del mes.</span>
      </div>
    </div>
  )
}

export function NotaVentaView({ order, enlace }: { order: OrderWithItems; enlace: EnlaceFactura | null }) {
  const { data: products } = useProducts()
  const meta = (order.shipping_meta ?? {}) as { customer?: { name?: string } | null; placed_by?: string | null }
  const cliente = capitalizarNombre(meta.customer?.name) || 'Cliente'
  const empresa = currentCompany()
  const pie = [empresa.direccion?.trim(), empresa.telefono?.trim() ? `Tel. ${empresa.telefono.trim()}` : ''].filter(Boolean).join(' · ')
  const items = order.items.filter((it) => it.unit_price != null)
  const envio = Number((order as { shipping_cost?: number | null }).shipping_cost ?? 0)
  const pagado = order.payment_status === 'paid'
  const cancelado = order.status === 'cancelled'
  return (
    <div className="recibo nota-venta" data-testid="nota-venta">
      <div className="rhead">
        <div className="rbrand">
          <BrandLogo />
          <div><div className="rbn">Renovacell</div><div className="rbs">{LEMA_MARCA}</div></div>
        </div>
        <div className="rdoc"><div className="t">Nota de venta</div><div className="f">{order.external_ref}</div></div>
      </div>
      <div className="rmeta">
        <div><div className="k">Cliente</div><div className="v">{cliente}</div></div>
        <div><div className="k">Fecha</div><div className="v">{fmtDate(order.created_at)}</div></div>
        <div><div className="k">Forma de pago</div><div className="v" data-testid="nota-pago">{textoMetodoPago(order.payment_method)}</div></div>
        <div><div className="k">Estado</div><div className="v" data-testid="nota-estado">{cancelado ? 'Cancelado' : pagado ? 'Pagado' : 'Por cobrar'}</div></div>
      </div>
      <div className="rbody">
        <table>
          <thead><tr><th>Producto</th><th>Cant.</th><th className="nv-num">Precio</th><th className="nv-num">Importe</th></tr></thead>
          <tbody>
            {items.map((it) => {
              const p = products.find((x) => x.id === it.product_id)
              return (
                <tr key={it.id}>
                  <td>{p?.name ?? 'Producto'}</td>
                  <td className="mono">{cantidadVista(p, it.qty)}</td>{/* CAJAS-MEDIOS: la media caja se lee en cajas, con su precio por caja */}
                  <td className="mono nv-num">{money(precioVista(p, it.unit_price ?? 0))}</td>
                  <td className="mono nv-num">{money((it.unit_price ?? 0) * it.qty)}</td>
                </tr>
              )
            })}
            {envio > 0 && <tr data-testid="nota-envio"><td colSpan={3}>Envío</td><td className="mono nv-num">{money(envio)}</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>Total</td><td className="mono nv-num nv-total" data-testid="nota-total">{money(order.total ?? 0)}</td></tr></tfoot>
        </table>
        <div className="nv-letras">Son: {montoEnLetras(order.total ?? 0)}</div>
      </div>
      {!cancelado && <QRFactura enlace={enlace} />}
      <div className="rfoot">
        <div className="note">{pie ? <>Renovacell · {pie}<br /></> : null}Este documento no es un comprobante fiscal.</div>
        <Icon name="shield" style={{ width: 22, height: 22, color: 'var(--green-deep)' }} />
      </div>
    </div>
  )
}

/** Texto para WhatsApp: el comprobante legible y el enlace para pedir la factura. */
export function textoNotaVenta(order: OrderWithItems, renglon: (it: OrderWithItems['items'][number]) => string, enlace: EnlaceFactura | null): string {
  const L: string[] = ['*RENOVACELL* · Nota de venta', `Folio: ${order.external_ref ?? ''}`, fmtDate(order.created_at), '']
  order.items.filter((it) => it.unit_price != null).forEach((it) => L.push(`${renglon(it)} — ${money((it.unit_price ?? 0) * it.qty)}`))
  const envio = Number((order as { shipping_cost?: number | null }).shipping_cost ?? 0)
  if (envio > 0) L.push(`Envío — ${money(envio)}`)
  L.push('', `*Total: ${money(order.total ?? 0)}*`, `Pago: ${textoMetodoPago(order.payment_method)} · ${order.payment_status === 'paid' ? 'Pagado' : 'Por cobrar'}`)
  if (enlace) L.push('', `¿Necesitas factura? Pídela aquí hasta el ${fechaLarga(enlace.limite)}:`, enlace.url)
  L.push('', 'Este mensaje no es un comprobante fiscal.')
  return L.join('\n')
}

// Botón que abre la nota de venta para verla, imprimirla (o guardarla en PDF) y mandarla por WhatsApp.
export function BotonNotaVenta({ order, className = 'btn ghost sm', telefono }: { order: OrderWithItems; className?: string; telefono?: string | null }) {
  const [abierta, setAbierta] = useState(false)
  const [imprimiendo, setImprimiendo] = useState(false)
  const enlace = useEnlaceFactura(abierta ? order.id : null)
  const { data: products } = useProducts()
  useEffect(() => {
    if (!imprimiendo) return
    // El título de la pestaña es el nombre del PDF al guardarlo: «Nota de venta S…», nunca el del sistema.
    const tituloPrevio = document.title
    const fin = () => { document.title = tituloPrevio; document.body.classList.remove('printing-remision'); window.removeEventListener('afterprint', fin); setImprimiendo(false) }
    const cuadro = requestAnimationFrame(() => requestAnimationFrame(() => {
      document.title = `Nota de venta ${order.external_ref ?? ''}`.trim()
      document.body.classList.add('printing-remision')
      window.addEventListener('afterprint', fin)
      window.print()
    }))
    return () => { cancelAnimationFrame(cuadro); document.title = tituloPrevio; document.body.classList.remove('printing-remision'); window.removeEventListener('afterprint', fin) }
  }, [imprimiendo, order.external_ref])
  const whatsapp = () => {
    const meta = (order.shipping_meta ?? {}) as { customer?: { phone?: string } | null }
    const d = (telefono ?? meta.customer?.phone ?? '').replace(/\D/g, '')
    const numero = d.length === 10 ? `52${d}` : d.length === 12 && d.startsWith('52') ? d : ''
    const texto = textoNotaVenta(order, (it) => { const p = products.find((x) => x.id === it.product_id); return `${p?.name ?? 'Producto'} ×${cantidadVista(p, it.qty)}` }, enlace)
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, '_blank')
  }
  return (
    <>
      <button className={className} type="button" onClick={() => setAbierta(true)} data-testid="nota-venta-abrir"><Icon name="receipt" style={{ width: 13, height: 13 }} /> Nota de venta</button>
      {abierta && createPortal(
        <div className="overlay nv-overlay" onClick={() => setAbierta(false)} data-testid="nota-venta-ventana">
          <div className="nv-ventana" onClick={(e) => e.stopPropagation()}>
            <NotaVentaView order={order} enlace={enlace} />
            <div className="nv-acciones">
              <button type="button" className="btn ghost" onClick={() => setAbierta(false)}>Cerrar</button>
              <button type="button" className="btn ghost" onClick={whatsapp} data-testid="nota-venta-whatsapp"><Icon name="chat" /> Enviar por WhatsApp</button>
              <button type="button" className="btn" disabled={imprimiendo} onClick={() => setImprimiendo(true)} data-testid="nota-venta-imprimir"><Icon name="download" /> Imprimir o guardar PDF</button>
            </div>
          </div>
        </div>, document.body)}
      {imprimiendo && createPortal(<div className="remision-print-root"><NotaVentaView order={order} enlace={enlace} /></div>, document.body)}
    </>
  )
}
