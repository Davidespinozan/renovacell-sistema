// Envíos MOCK + choferes propios, con la forma de la tabla `shipments`.
// Los helpers de chofer (driverName / driverIdByEmail / getDrivers) son
// CONSCIENTES DEL BACKEND: con Supabase resuelven contra los perfiles reales
// (role_id='driver'); sin backend usan MOCK_DRIVERS. Así las pantallas no cambian.
import type { Shipment } from '../types'
import { hasSupabase, supabase } from '../../lib/supabase'

export interface Driver {
  id: string
  name: string
  email: string | null // cuenta con la que entra (mapea login → chofer)
}

export const MOCK_DRIVERS: Driver[] = [
  { id: 'drv-1', name: 'Beto · Chofer', email: 'chofer@renovacell.mx' },
  { id: 'drv-2', name: 'Marta · Chofer', email: 'chofer2@renovacell.mx' },
]

// Cache síncrono de los choferes reales (perfiles role_id='driver'), hidratado
// desde Supabase. Los helpers lo consultan de forma síncrona en render. La carga
// la ORQUESTA shipmentsStore: espera a loadDrivers() ANTES de emitir los envíos,
// para que el re-render encuentre ya resueltos los nombres/ids de chofer (evita
// "Mi ruta · —" y la columna Chofer en blanco por una carrera de hidratación).
let dbDrivers: Driver[] = []
export async function loadDrivers(): Promise<void> {
  if (!hasSupabase) return
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, email, meta')
    .eq('role_id', 'driver')
  if (error) { console.warn('[drivers] load', error.message); return }
  dbDrivers = (data ?? []).map((d) => ({
    id: d.id,
    name: ((d.meta as { name?: string } | null)?.name) ?? d.full_name ?? d.email ?? 'Chofer',
    email: d.email,
  }))
}

// Lista de choferes para el selector (Empaque asigna).
export const getDrivers = (): Driver[] => (hasSupabase ? dbDrivers : MOCK_DRIVERS)

// Resuelve el chofer logueado por su correo -> id (uuid real con backend).
export const driverIdByEmail = (email?: string | null): string | null => {
  const list = getDrivers()
  return list.find((d) => d.email && d.email.toLowerCase() === (email ?? '').trim().toLowerCase())?.id ?? null
}

export const driverName = (id: string | null): string =>
  getDrivers().find((d) => d.id === id)?.name
  ?? MOCK_DRIVERS.find((d) => d.id === id)?.name
  ?? '—'

export const MOCK_SHIPMENTS: Shipment[] = [
  {
    id: 'sh-3683', order_id: 'o-3683', carrier: 'Estafeta', tracking_number: '7790-2291',
    label_url: null, driver_id: null, status: 'delivered', estimated_delivery_at: '2026-05-23T00:00:00Z',
    delivered_at: '2026-05-23T15:10:00Z', proof_image_url: null, received_by: null, incident: null, created_at: '2026-05-21T10:00:00Z',
  },
  {
    id: 'sh-3559', order_id: 'o-3559', carrier: null, tracking_number: null,
    label_url: null, driver_id: 'drv-2', status: 'out_for_delivery', estimated_delivery_at: '2026-06-14T00:00:00Z',
    delivered_at: null, proof_image_url: null, received_by: null, incident: null, created_at: '2026-06-11T09:00:00Z',
  },
  {
    id: 'sh-3640', order_id: 'o-3640', carrier: null, tracking_number: null,
    label_url: null, driver_id: 'drv-1', status: 'out_for_delivery', estimated_delivery_at: '2026-06-16T00:00:00Z',
    delivered_at: null, proof_image_url: null, received_by: null, incident: null, created_at: '2026-06-15T10:00:00Z',
  },
]
