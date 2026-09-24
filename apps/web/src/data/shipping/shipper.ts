// Remitente operativo (shipper) para paquetería, derivado de company_settings.
// Reutilizable por DHL y T1. No hardcodea valores: si algo falta, lo reporta para
// que David lo capture en Configuración → no se cotiza/crea guía con datos falsos.
import type { CompanySettings } from '../store/companyStore'
import type { ShipperConfig } from './model'
import { validateShipper } from './validate'

export function shipperFromCompany(c: CompanySettings): { config: ShipperConfig; missing: string[] } {
  // EXCLUSIVAMENTE del bloque ORIGEN DE ENVÍOS. Sin fallback al domicilio fiscal:
  // el domicilio fiscal y el origen de despacho pueden diferir (p.ej. remodelación).
  const config: ShipperConfig = {
    name: c.shipping_name,
    addressLine1: c.shipping_address,
    cp: c.shipping_cp,
    city: c.shipping_city,
    state: c.shipping_state,
    country: c.shipping_country || 'MX',
    phone: c.shipping_phone,
    email: c.shipping_email,
  }
  return { config, missing: validateShipper(config) }
}
