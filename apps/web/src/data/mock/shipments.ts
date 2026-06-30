// Envíos MOCK + choferes propios, con la forma de la tabla `shipments`.
// Los pedidos ya enviados del mock (S3683 entregado, S3559 en camino) tienen
// su envío aquí para alimentar Guías / Recibo / Seguimiento.
import type { Shipment } from '../types'

export interface Driver {
  id: string
  name: string
  email: string | null // cuenta con la que entra (mapea login → chofer)
}

export const MOCK_DRIVERS: Driver[] = [
  { id: 'drv-1', name: 'Beto · Chofer', email: 'chofer@renovacell.mx' },
  { id: 'drv-2', name: 'Marta · Chofer', email: 'chofer2@renovacell.mx' },
]

// Resuelve el chofer logueado por su correo (en Supabase = profiles.id = auth.uid).
export const driverIdByEmail = (email?: string | null): string | null =>
  MOCK_DRIVERS.find((d) => d.email && d.email.toLowerCase() === (email ?? '').trim().toLowerCase())?.id ?? null

export const driverName = (id: string | null): string =>
  MOCK_DRIVERS.find((d) => d.id === id)?.name ?? '—'

export const MOCK_SHIPMENTS: Shipment[] = [
  {
    id: 'sh-3683', order_id: 'o-3683', carrier: 'Estafeta', tracking_number: '7790-2291',
    label_url: null, driver_id: null, status: 'delivered', estimated_delivery_at: '2026-05-23T00:00:00Z',
    delivered_at: '2026-05-23T15:10:00Z', proof_image_url: null, received_by: null, incident: null, created_at: '2026-05-21T10:00:00Z',
  },
  // Entrega local con chofer propio (drv-2 · Marta), pendiente de entregar.
  {
    id: 'sh-3559', order_id: 'o-3559', carrier: null, tracking_number: null,
    label_url: null, driver_id: 'drv-2', status: 'out_for_delivery', estimated_delivery_at: '2026-06-14T00:00:00Z',
    delivered_at: null, proof_image_url: null, received_by: null, incident: null, created_at: '2026-06-11T09:00:00Z',
  },
  // Entrega local con chofer propio (drv-1), pendiente de entregar.
  {
    id: 'sh-3640', order_id: 'o-3640', carrier: null, tracking_number: null,
    label_url: null, driver_id: 'drv-1', status: 'out_for_delivery', estimated_delivery_at: '2026-06-16T00:00:00Z',
    delivered_at: null, proof_image_url: null, received_by: null, incident: null, created_at: '2026-06-15T10:00:00Z',
  },
]
