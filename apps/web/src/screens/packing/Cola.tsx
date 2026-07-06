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
import { getDrivers } from '../../data/mock/shipments'
import { clientOf } from '../../data/mock/profiles'
import { ORIGIN, quoteRates, generateLabel, type ShipAddress, type RateQuote, type LabelResult } from '../../data/shipping/provider'
import type { ProductSafe } from '../../data/types'

// Destino a partir del perfil del doctor del pedido. Con Supabase: dirección de
// envío del pedido. El CP es placeholder mientras no se modele por doctor.
function destinationOf(order: OrderWithItems): ShipAddress {
  const c = clientOf(order.doctor_id)
  const [city, state] = (c.city || 'Culiacán, Sin.').split(',').map((s) => s.trim())
  return { name: c.clinic || c.name, street: c.address, city: city || 'Culiacán', state: state || 'Sin.', zip: '80000', phone: c.phone }
}

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
                <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
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
  const [driverId, setDriverId] = useState('')

  // Paquetería: paquete → cotizar → elegir tarifa → generar guía.
  const dest = useMemo(() => destinationOf(order), [order])
  const [parcel, setParcel] = useState({ weightKg: '0.5', lengthCm: '20', widthCm: '15', heightCm: '10' })
  const [rates, setRates] = useState<RateQuote[] | null>(null)
  const [rateId, setRateId] = useState('')
  const [busy, setBusy] = useState<false | 'quote' | 'label'>(false)
  const [result, setResult] = useState<LabelResult | null>(null)
  const [doneChofer, setDoneChofer] = useState(false)

  const req = () => ({
    origin: ORIGIN,
    destination: dest,
    parcel: {
      weightKg: Number(parcel.weightKg) || 0.5, lengthCm: Number(parcel.lengthCm) || 1,
      widthCm: Number(parcel.widthCm) || 1, heightCm: Number(parcel.heightCm) || 1,
    },
    orderRef: order.external_ref ?? order.id,
  })

  const cotizar = async () => {
    setBusy('quote'); setRates(null); setRateId('')
    const r = await quoteRates(req())
    setRates(r); setRateId(r[0]?.id ?? ''); setBusy(false)
  }

  const generarGuia = async () => {
    const rate = rates?.find((r) => r.id === rateId)
    if (!rate) return
    setBusy('label')
    const label = await generateLabel(rate, req())
    createShipment({
      order_id: order.id, carrier: label.carrier, tracking_number: label.tracking,
      label_url: label.labelUrl, driver_id: null, estimated_delivery_at: label.estimatedDeliveryAt, status: 'in_transit',
    })
    markShipped(order.id, { method: 'paqueteria', carrier: label.carrier, tracking: label.tracking, label_url: label.labelUrl })
    setResult(label); setBusy(false)
  }

  const asignarChofer = () => {
    if (!driverId) return
    const drv = getDrivers().find((d) => d.id === driverId)
    createShipment({
      order_id: order.id, carrier: null, tracking_number: null, driver_id: driverId,
      estimated_delivery_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'por_despachar',
    })
    markShipped(order.id, { method: 'chofer', driver: drv?.name ?? '', driver_id: driverId })
    setDoneChofer(true)
  }

  const f2: React.CSSProperties = { ...inputStyle }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Guía generada</h3>
              <p>
                <b>{order.external_ref}</b> va por <b>{result.carrier} · {result.service}</b>.
                Guía <b className="mono">{result.tracking}</b> · entrega estimada {fmtDate(result.estimatedDeliveryAt)}.
                El doctor ya la ve en su seguimiento.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
                <a className="btn" href={result.labelUrl} target="_blank" rel="noreferrer"><Icon name="download" /> Imprimir etiqueta</a>
                <button className="btn ghost" type="button" onClick={onClose}>Listo</button>
              </div>
            </div>
          </div>
        ) : doneChofer ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Envío asignado</h3>
              <p><b>{order.external_ref}</b> pasó a <b>En camino</b> con chofer propio. Ya aparece en la ruta del chofer.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Asignar envío · {order.external_ref}</h3>
                <div className="ms">Genera la guía con la paquetería o asígnalo a un chofer propio.</div>
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
                  {/* Destino: del perfil del doctor */}
                  <div className="sysnote" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
                    <Icon name="truck" />
                    <span>
                      <b>Destino:</b> {dest.name} · {dest.street}, {dest.city}, {dest.state}.<br />
                      <b>Origen:</b> {ORIGIN.city}, {ORIGIN.state}.
                    </span>
                  </div>

                  <label style={labelStyle}>Paquete</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                    <input style={f2} type="number" min="0.1" step="0.1" value={parcel.weightKg} onChange={(e) => { setParcel({ ...parcel, weightKg: e.target.value }); setRates(null) }} placeholder="kg" />
                    <input style={f2} type="number" min="1" value={parcel.lengthCm} onChange={(e) => { setParcel({ ...parcel, lengthCm: e.target.value }); setRates(null) }} placeholder="largo" />
                    <input style={f2} type="number" min="1" value={parcel.widthCm} onChange={(e) => { setParcel({ ...parcel, widthCm: e.target.value }); setRates(null) }} placeholder="ancho" />
                    <input style={f2} type="number" min="1" value={parcel.heightCm} onChange={(e) => { setParcel({ ...parcel, heightCm: e.target.value }); setRates(null) }} placeholder="alto" />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>Peso (kg) y medidas en cm (largo × ancho × alto).</div>

                  {!rates ? (
                    <button className="btn" type="button" style={{ width: '100%', marginTop: 16 }} onClick={cotizar} disabled={busy === 'quote'}>
                      {busy === 'quote' ? 'Cotizando…' : <><Icon name="truck" /> Cotizar envío</>}
                    </button>
                  ) : (
                    <>
                      <label style={{ ...labelStyle, marginTop: 16 }}>Tarifas disponibles</label>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {rates.map((r) => (
                          <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', border: '1px solid ' + (rateId === r.id ? 'var(--green)' : 'var(--line)'), borderRadius: 11, cursor: 'pointer', background: rateId === r.id ? 'var(--ok-bg)' : '#fff' }}>
                            <input type="radio" name="rate" checked={rateId === r.id} onChange={() => setRateId(r.id)} />
                            <span style={{ flex: 1 }}>
                              <b>{r.carrier}</b> · {r.service}
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>Entrega en {r.etaDays} día(s)</span>
                            </span>
                            <b className="mono">{money(r.amount)}</b>
                          </label>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                        <button className="btn ghost" type="button" onClick={() => setRates(null)}>Recotizar</button>
                        <button className="btn" type="button" onClick={generarGuia} disabled={busy === 'label' || !rateId} style={busy === 'label' ? { opacity: .6 } : undefined}>
                          {busy === 'label' ? 'Generando guía…' : <><Icon name="check" /> Generar guía</>}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <label style={labelStyle}>Chofer</label>
                  <select style={inputStyle} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {getDrivers().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                    <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                    <button className="btn" type="button" onClick={asignarChofer} disabled={!driverId} style={!driverId ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                      <Icon name="check" /> Asignar a chofer
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
