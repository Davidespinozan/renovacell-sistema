// Envíos MOCK + choferes propios, con la forma de la tabla `shipments`.
// Los pedidos ya enviados del mock (S3683 entregado, S3559 en camino) tienen
// su envío aquí para alimentar Guías / Recibo / Seguimiento.
import type { Shipment } from '../types'

export interface Driver {
  id: string
  name: string
}

export const MOCK_DRIVERS: Driver[] = [
  { id: 'drv-1', name: 'Chofer local Culiacán' },
  { id: 'drv-2', name: 'Repartidor zona centro' },
]

export const driverName = (id: string | null): string =>
  MOCK_DRIVERS.find((d) => d.id === id)?.name ?? '—'

export const MOCK_SHIPMENTS: Shipment[] = [
  {
    id: 'sh-3683', order_id: 'o-3683', carrier: 'Estafeta', tracking_number: '7790-2291',
    driver_id: null, status: 'delivered', estimated_delivery_at: '2026-05-23T00:00:00Z',
    delivered_at: '2026-05-23T15:10:00Z', proof_image_url: null, created_at: '2026-05-21T10:00:00Z',
  },
  {
    id: 'sh-3559', order_id: 'o-3559', carrier: 'DHL', tracking_number: '4410-1180',
    driver_id: null, status: 'in_transit', estimated_delivery_at: '2026-06-14T00:00:00Z',
    delivered_at: null, proof_image_url: null, created_at: '2026-06-11T09:00:00Z',
  },
]
