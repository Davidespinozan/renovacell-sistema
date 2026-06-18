// CHOFER: solo SUS entregas (driver_id = chofer logueado). Marca entregado +
// sube foto de prueba. Al confirmar, envío y pedido pasan a Entregado (cierra el ciclo).
import { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { entregar } from '../../data/ops/entregar'
import { CURRENT_DRIVER_ID, driverName } from '../../data/mock/shipments'
import { clientOf } from '../../data/mock/profiles'

export function MisEntregas() {
  const { data: shipments } = useShipments()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()

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
  const [toast, setToast] = useState<string | null>(null)

  const mine = shipments.filter((s) => s.driver_id === CURRENT_DRIVER_ID && s.status !== 'delivered')

  const onPhoto = (shipmentId: string, file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotos((p) => ({ ...p, [shipmentId]: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  const deliver = (shipmentId: string, orderId: string, folio: string) => {
    entregar(shipmentId, orderId, photos[shipmentId] ?? null)
    setToast(`Entrega confirmada: ${folio}`)
    window.setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Chofer / Seguimiento · {driverName(CURRENT_DRIVER_ID)}</div>

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
                <span className="pill p-blue"><span className="d" /> En reparto</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {s.estimated_delivery_at ? `Estimada ${fmtDate(s.estimated_delivery_at)}` : ''}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, fontSize: 13, marginBottom: 12 }}>
                <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Cliente</div>{client.name} · {client.clinic}</div>
                <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Dirección</div>{client.address}, {client.city}</div>
                <div><div style={{ color: 'var(--ink-3)', fontSize: 11 }}>Productos</div>{items.map((it) => `${prodName[it.product_id ?? ''] ?? 'Producto'} ×${it.qty}`).join(', ')}</div>
              </div>

              <div className="field-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
                  <Icon name="image" /> {photo ? 'Cambiar foto' : 'Subir foto de prueba'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onPhoto(s.id, e.target.files?.[0])} />
                </label>
                {photo && <img src={photo} alt="prueba" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--line)' }} />}
                <button
                  className="btn"
                  type="button"
                  style={{ marginLeft: 'auto', opacity: photo ? 1 : 0.5, cursor: photo ? 'pointer' : 'not-allowed' }}
                  disabled={!photo}
                  onClick={() => deliver(s.id, order.id, order.external_ref ?? order.id)}
                >
                  <Icon name="check" /> Marcar entregado
                </button>
              </div>
              {!photo && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Sube la foto de prueba para confirmar la entrega.</div>}
            </div>
          )
        })
      )}

      {toast && <div className="toast show"><Icon name="check" /> {toast}</div>}
    </div>
  )
}
