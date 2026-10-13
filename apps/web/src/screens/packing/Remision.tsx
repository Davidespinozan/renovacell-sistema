// Remisión del paquete: la hoja de contenido que va DENTRO de la caja (qué producto, de qué lote, para quién).
// No es una pantalla: se imprime desde donde se arma el envío (Por enviar) y se reimprime desde Guías.
// Es un documento que ve el cliente: lleva la marca del negocio, nunca el nombre del sistema interno.
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../app/icons'
import { BrandLogo } from '../../app/BrandLogo'
import { fmtDate } from '../../lib/format'
import { useProducts } from '../../data/hooks/useProducts'
import { useLots } from '../../data/hooks/useLots'
import { orderAddress } from '../../data/ops/shippingAddress'
import { driverName } from '../../data/mock/shipments'
import type { OrderWithItems } from '../../data/hooks/useOrders'

export const LEMA_MARCA = 'Tecnologías Antiedad'
type EnvioRemision = { carrier?: string | null; tracking_number?: string | null; driver_id?: string | null; estimated_delivery_at?: string | null }

export function RemisionView({ order, envio }: { order: OrderWithItems; envio?: EnvioRemision | null }) {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const meta = (order.shipping_meta ?? {}) as { customer?: { name?: string } | null }
  const dir = orderAddress(order.shipping_meta, null)
  const destino = [dir?.line1, dir?.colonia, dir?.city, dir?.state, dir?.cp ? `C.P. ${dir.cp}` : ''].filter(Boolean).join(', ')
  const metodo = !envio ? 'Por asignar'
    : envio.driver_id ? `Entrega directa · ${driverName(envio.driver_id)}`
    : `${envio.carrier ?? 'Paquetería'}${envio.tracking_number ? ` · guía ${envio.tracking_number}` : ''}`
  return (
    <div className="recibo">
      <div className="rhead">
        <div className="rbrand">
          <BrandLogo />
          <div><div className="rbn">Renovacell</div><div className="rbs">{LEMA_MARCA}</div></div>
        </div>
        <div className="rdoc"><div className="t">Remisión</div><div className="f">{order.external_ref}</div></div>
      </div>
      <div className="rmeta">
        <div><div className="k">Pedido</div><div className="v mono">{order.external_ref}</div></div>
        <div><div className="k">Fecha</div><div className="v">{fmtDate(order.created_at)}</div></div>
        <div><div className="k">Para</div><div className="v">{meta.customer?.name || '—'}</div></div>
        <div><div className="k">Envío</div><div className="v">{metodo}</div></div>
        {destino && <div style={{ gridColumn: '1 / -1' }}><div className="k">Destino</div><div className="v">{destino}</div></div>}
      </div>
      <div className="rbody">
        <table>
          <thead><tr><th>Producto</th><th>Lote</th><th>Cant.</th></tr></thead>
          <tbody>
            {order.items.filter((it) => it.unit_price != null).map((it) => (
              <tr key={it.id}>
                <td>{products.find((p) => p.id === it.product_id)?.name ?? 'Producto'}</td>
                <td><span className="lc">{it.lot_id ? lots.find((l) => l.id === it.lot_id)?.lot_code ?? '—' : '—'}</span></td>
                <td className="mono">{it.qty} {it.qty === 1 ? 'pza' : 'pzas'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rfoot">
        <div className="note">Producto regulado · trazabilidad por lote (COFEPRIS). Conserva esta remisión.</div>
        <Icon name="shield" style={{ width: 22, height: 22, color: 'var(--green-deep)' }} />
      </div>
    </div>
  )
}

// Botón que imprime SOLO la remisión (impresión aislada, mismo patrón que el recibo de venta y el corte).
export function BotonRemision({ order, envio, className = 'btn ghost sm' }: { order: OrderWithItems; envio?: EnvioRemision | null; className?: string }) {
  const [imprimiendo, setImprimiendo] = useState(false)
  useEffect(() => {
    if (!imprimiendo) return
    const fin = () => { document.body.classList.remove('printing-remision'); window.removeEventListener('afterprint', fin); setImprimiendo(false) }
    document.body.classList.add('printing-remision')
    window.addEventListener('afterprint', fin)
    window.print()
    return () => { document.body.classList.remove('printing-remision'); window.removeEventListener('afterprint', fin) }
  }, [imprimiendo])
  return (
    <>
      <button className={className} type="button" onClick={() => setImprimiendo(true)} data-testid="imprimir-remision"><Icon name="receipt" style={{ width: 13, height: 13 }} /> Imprimir remisión</button>
      {imprimiendo && createPortal(<div className="remision-print-root"><RemisionView order={order} envio={envio} /></div>, document.body)}
    </>
  )
}
