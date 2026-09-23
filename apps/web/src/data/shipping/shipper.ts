// Remitente operativo (shipper) para paquetería, derivado de company_settings.
// Reutilizable por DHL y T1. No hardcodea valores: si algo falta, lo reporta para
// que David lo capture en Configuración → no se cotiza/crea guía con datos falsos.
import type { CompanySettings } from '../store/companyStore'
import type { ShipperConfig } from './model'
import { validateShipper } from './validate'

export function shipperFromCompany(c: CompanySettings): { config: ShipperConfig; missing: string[] } {
  const config: ShipperConfig = {
    name: c.razon_social,
    addressLine1: c.direccion,
    cp: c.cp,
    city: c.ciudad,
    state: c.estado,
    country: c.pais || 'MX',
    phone: c.telefono,
    email: c.email,
  }
  return { config, missing: validateShipper(config) }
}
