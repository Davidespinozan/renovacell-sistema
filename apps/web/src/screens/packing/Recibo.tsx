// Recibo de entrega: resumen imprimible del envío de un pedido (etiqueta/recibo
// con marca). Incluye lote por renglón (traza COFEPRIS).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useLots } from '../../data/hooks/useLots'
import { PageHead } from '../../app/PageHead'
import { driverName } from '../../data/mock/shipments'

export function Recibo() {
  const { data: shipments } = useShipments()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { data: lots } = useLots()

  const [selected, setSelected] = useState<string>('')
  const shipment = shipments.find((s) => s.id === selected) ?? shipments[0]
  const selectedId = shipment?.id ?? '' // refleja el envío realmente mostrado (evita desync del select)
  const order = orders.find((o) => o.id === shipment?.order_id)

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])
  const lotCode = useMemo(() => {
    const m: Record<string, string> = {}
    lots.forEach((l) => (m[l.id] = l.lot_code))
    return m
  }, [lots])

  if (!shipment || !order) {
    return (
      <div className="grid" style={{ gap: 16 }}>
        <div className="eyebrow">Empaque · Recibo de entrega</div>
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No hay envíos para generar recibo. Asigna un envío en la cola de empaque.
        </div>
      </div>
    )
  }

  const metodo = shipment.driver_id
    ? `Chofer propio · ${driverName(shipment.driver_id)}`
    : `${shipment.carrier}${shipment.tracking_number ? ` · guía ${shipment.tracking_number}` : ''}`

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Recibo de entrega">
        El comprobante imprimible que acompaña al paquete: qué producto va, de qué <b>lote</b> (traza),
        y a qué cliente. Elige el envío y dale <b>Imprimir</b>; quien recibe lo firma como prueba de entrega.
      </PageHead>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Selecciona el envío</div>
        <select
          style={{ marginLeft: 'auto', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13 }}
          value={selectedId}
          onChange={(e) => setSelected(e.target.value)}
        >
          {shipments.map((s) => {
            const o = orders.find((x) => x.id === s.order_id)
            return <option key={s.id} value={s.id}>{o?.external_ref ?? s.order_id}</option>
          })}
        </select>
        <button className="btn ghost sm" type="button" onClick={() => window.print()}>
          <Icon name="download" /> Imprimir
        </button>
      </div>

      <div className="recibo">
        <div className="rhead">
          <div className="rbrand">
            <img src="/brand/logo.png" alt="Renovacell" />
            <div>
              <div className="rbn">Renovacell</div>
              <div className="rbs">Sistema operativo</div>
            </div>
          </div>
          <div className="rdoc">
            <div className="t">Recibo de entrega</div>
            <div className="f">{order.external_ref}</div>
          </div>
        </div>

        <div className="rmeta">
          <div><div className="k">Pedido</div><div className="v mono">{order.external_ref}</div></div>
          <div><div className="k">Fecha</div><div className="v">{fmtDate(order.created_at)}</div></div>
          <div><div className="k">Envío</div><div className="v">{metodo}</div></div>
          <div><div className="k">Entrega estimada</div><div className="v">{shipment.estimated_delivery_at ? fmtDate(shipment.estimated_delivery_at) : '—'}</div></div>
        </div>

        <div className="rbody">
          <table className="tbl-cards">
            <thead>
              <tr><th>Producto</th><th>Lote</th><th>Cant.</th></tr>
            </thead>
            <tbody>
              {order.items.filter((it) => it.unit_price != null).map((it) => (
                <tr key={it.id}>
                  <td data-label="Producto">{prodName[it.product_id ?? ''] ?? 'Producto'}</td>
                  <td data-label="Lote"><span className="lc">{it.lot_id ? lotCode[it.lot_id] ?? it.lot_id : '—'}</span></td>
                  <td data-label="Cant." className="mono">{it.qty} {it.qty === 1 ? 'pza' : 'pzas'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rfoot">
          <div className="note">Producto regulado · trazabilidad por lote (COFEPRIS). Conserva este recibo.</div>
          <Icon name="shield" style={{ width: 22, height: 22, color: 'var(--green-deep)' }} />
        </div>
      </div>
    </div>
  )
}
