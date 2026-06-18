// Cola de empaque: pedidos en estado "Empacado" (surtidos por Almacén), listos
// para enviar. Asignar envío por paquetería (carrier+guía) o chofer propio.
// Al asignar se crea el shipment y el pedido pasa a "En camino".
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate, money } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useShipments } from '../../data/hooks/useShipments'
import { markShipped } from '../../data/store/ordersStore'
import { MOCK_DRIVERS } from '../../data/mock/shipments'
import type { ProductSafe } from '../../data/types'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
  borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px',
}

export function Cola() {
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const [active, setActive] = useState<OrderWithItems | null>(null)

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const queue = orders.filter((o) => o.status === 'packed')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Empaque · Por empacar</div>

      {queue.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No hay pedidos empacados pendientes de envío. (Surte un pedido en Almacén para que llegue aquí.)
        </div>
      ) : (
        queue.map((o) => (
          <div key={o.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
              <span className="pill p-blue"><span className="d" /> Empacado</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(o.created_at)}</span>
            </div>
            {o.items.map((it) => (
              <div key={it.id} className="coitem">
                <span>{byId[it.product_id ?? '']?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{it.qty}</span></span>
                <span className="mono">{it.unit_price == null ? 'cotización' : money((it.unit_price ?? 0) * it.qty)}</span>
              </div>
            ))}
            <button className="btn" type="button" style={{ marginTop: 12 }} onClick={() => setActive(o)}>
              <Icon name="truck" /> Asignar envío
            </button>
          </div>
        ))
      )}

      {active && <AsignarModal order={active} onClose={() => setActive(null)} />}
    </div>
  )
}

type Method = 'paqueteria' | 'chofer'

function AsignarModal({ order, onClose }: { order: OrderWithItems; onClose: () => void }) {
  const { createShipment } = useShipments()
  const [method, setMethod] = useState<Method>('paqueteria')
  const [carrier, setCarrier] = useState('Estafeta')
  const [tracking, setTracking] = useState('')
  const [eta, setEta] = useState('')
  const [driverId, setDriverId] = useState('')
  const [done, setDone] = useState(false)

  const valid = method === 'paqueteria' ? Boolean(tracking.trim()) : Boolean(driverId)

  const confirm = () => {
    if (!valid) return
    if (method === 'paqueteria') {
      createShipment({
        order_id: order.id, carrier, tracking_number: tracking.trim(), driver_id: null,
        estimated_delivery_at: eta ? new Date(eta).toISOString() : null, status: 'in_transit',
      })
      markShipped(order.id, { method: 'paqueteria', carrier, tracking: tracking.trim() })
    } else {
      const drv = MOCK_DRIVERS.find((d) => d.id === driverId)
      createShipment({
        order_id: order.id, carrier: null, tracking_number: null, driver_id: driverId,
        estimated_delivery_at: null, status: 'assigned',
      })
      markShipped(order.id, { method: 'chofer', driver: drv?.name ?? '', driver_id: driverId })
    }
    setDone(true)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Envío asignado</h3>
              <p>
                <b>{order.external_ref}</b> pasó a <b>En camino</b> por{' '}
                {method === 'paqueteria' ? `${carrier} (guía ${tracking.trim()})` : 'chofer propio'}.
                El doctor ya lo ve en su seguimiento.
              </p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Asignar envío · {order.external_ref}</h3>
                <div className="ms">Elige el método. La paquetería se sugiere según el destino.</div>
              </div>
              <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
            </div>
            <div className="mbody">
              <div className="seg" style={{ marginBottom: 16 }}>
                <button type="button" className={method === 'paqueteria' ? 'active' : undefined} onClick={() => setMethod('paqueteria')}>
                  <Icon name="truck" /> Paquetería
                </button>
                <button type="button" className={method === 'chofer' ? 'active' : undefined} onClick={() => setMethod('chofer')}>
                  <Icon name="usercheck" /> Chofer propio
                </button>
              </div>

              {method === 'paqueteria' ? (
                <>
                  <label style={labelStyle}>Paquetería</label>
                  <select style={inputStyle} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                    <option>Estafeta</option>
                    <option>DHL</option>
                  </select>
                  <div className="form-grid-2" style={{ marginTop: 14 }}>
                    <div>
                      <label style={labelStyle}>Guía (tracking)</label>
                      <input style={inputStyle} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ej. 7790-2291" />
                    </div>
                    <div>
                      <label style={labelStyle}>Entrega estimada</label>
                      <input style={inputStyle} type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label style={labelStyle}>Chofer</label>
                  <select style={inputStyle} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {MOCK_DRIVERS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <div className="sysnote" style={{ marginTop: 14 }}>
                    <Icon name="usercheck" />
                    <span>Entrega local con chofer propio (sin guía de paquetería). Alimenta el módulo de Seguimiento.</span>
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" onClick={confirm} disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                  <Icon name="check" /> Generar envío
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
