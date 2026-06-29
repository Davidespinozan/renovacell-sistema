// CHOFER: solo SUS entregas (driver_id = chofer logueado). Marca entregado +
// sube foto de prueba. Al confirmar, envío y pedido pasan a Entregado (cierra el ciclo).
import { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { entregar } from '../../data/ops/entregar'
import { driverIdByEmail, driverName } from '../../data/mock/shipments'
import { clientOf } from '../../data/mock/profiles'
import { useRole } from '../../auth/RoleContext'

const INCIDENT_TYPES = ['Cliente ausente', 'Dirección incorrecta', 'Pedido rechazado', 'No se pudo contactar', 'Otro']

export function MisEntregas() {
  const { data: shipments, reportIncident } = useShipments()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { user } = useRole()
  const driverId = driverIdByEmail(user?.email)

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])
  const orderById = useMemo(() => {
    const m: Record<string, (typeof orders)[number] | undefined> = {}
    orders.forEach((o) => (m[o.id] = o))
    return m
  }, [orders])

  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [received, setReceived] = useState<Record<string, string>>({})
  const [incType, setIncType] = useState<Record<string, string>>({})
  const [incNote, setIncNote] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)

  const reportInc = (shipmentId: string, folio: string) => {
    reportIncident(shipmentId, incType[shipmentId] ?? INCIDENT_TYPES[0], incNote[shipmentId]?.trim() || null, folio)
    setToast(`Incidencia reportada: ${folio}`)
    window.setTimeout(() => setToast(null), 2600)
  }

  const mine = shipments.filter((s) => s.driver_id === driverId && s.status !== 'delivered')

  const onPhoto = (shipmentId: string, file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotos((p) => ({ ...p, [shipmentId]: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  const deliver = (shipmentId: string, orderId: string, folio: string) => {
    entregar(shipmentId, orderId, photos[shipmentId] ?? null, received[shipmentId]?.trim() || null)
    setToast(`Entrega confirmada: ${folio}`)
    window.setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Chofer / Seguimiento · {driverName(driverId)}</div>

      {mine.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No tienes entregas asignadas pendientes.
        </div>
      ) : (
        mine.map((s) => {
          const order = orderById[s.order_id]
          if (!order) return null
          const client = clientOf(order.doctor_id)
          const items = order.items.filter((it) => it.unit_price != null)
          const photo = photos[s.id]
          return (
            <div key={s.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
                {s.incident && !s.incident.resolved
                  ? <span className="pill p-dang">Incidencia: {s.incident.type}</span>
                  : <span className="pill p-blue"><span className="d" /> En reparto</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {s.estimated_delivery_at ? `Estimada ${fmtDate(s.estimated_delivery_at)}` : ''}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, fontSize: 13, marginBottom: 12 }}>
                <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Cliente</div>{client.name} · {client.clinic}</div>
                <div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Teléfono</div>
                  <a href={`tel:+52${client.phone.replace(/\s/g, '')}`} style={{ color: 'var(--green-deep)', fontWeight: 600, textDecoration: 'none' }}>
                    {client.phone} · Llamar
                  </a>
                </div>
                <div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Dirección</div>
                  {client.address}, {client.city}{' '}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${client.address}, ${client.city}`)}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green-deep)', fontWeight: 600, whiteSpace: 'nowrap' }}>· Ver en mapa</a>
                </div>
                <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Productos</div>{items.map((it) => `${prodName[it.product_id ?? ''] ?? 'Producto'} ×${it.qty}`).join(', ')}</div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>Recibió (nombre de quien recibe)</label>
                <input
                  value={received[s.id] ?? ''}
                  onChange={(e) => setReceived((r) => ({ ...r, [s.id]: e.target.value }))}
                  placeholder="Ej. Recepción / nombre de quien recibe"
                  style={{ width: '100%', maxWidth: 320, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff' }}
                />
              </div>

              <div className="field-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
                  <Icon name="image" /> {photo ? 'Cambiar foto' : 'Subir foto de prueba'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onPhoto(s.id, e.target.files?.[0])} />
                </label>
                {photo && <img src={photo} alt="prueba" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--line)' }} />}
                {(() => {
                  const ready = Boolean(photo) && Boolean(received[s.id]?.trim())
                  return (
                    <button
                      className="btn"
                      type="button"
                      style={{ marginLeft: 'auto', opacity: ready ? 1 : 0.5, cursor: ready ? 'pointer' : 'not-allowed' }}
                      disabled={!ready}
                      onClick={() => deliver(s.id, order.id, order.external_ref ?? order.id)}
                    >
                      <Icon name="check" /> Marcar entregado
                    </button>
                  )
                })()}
              </div>
              {!(Boolean(photo) && Boolean(received[s.id]?.trim())) && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Captura quién recibe y la foto de prueba para confirmar la entrega.</div>
              )}

              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--ink-3)' }}>¿Problema con la entrega? Reportar incidencia</summary>
                <div className="field-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <select
                    value={incType[s.id] ?? INCIDENT_TYPES[0]}
                    onChange={(e) => setIncType((m) => ({ ...m, [s.id]: e.target.value }))}
                    style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, background: '#fff' }}
                  >
                    {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    value={incNote[s.id] ?? ''}
                    onChange={(e) => setIncNote((m) => ({ ...m, [s.id]: e.target.value }))}
                    placeholder="Nota (opcional)"
                    style={{ flex: 1, minWidth: 160, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff' }}
                  />
                  <button className="btn ghost sm" type="button" onClick={() => reportInc(s.id, order.external_ref ?? order.id)}>Enviar incidencia</button>
                </div>
              </details>
            </div>
          )
        })
      )}

      {toast && <div className="toast show"><Icon name="check" /> {toast}</div>}
    </div>
  )
}
