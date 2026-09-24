// Configuración de empresa (emisor CFDI + identidad). Singleton: una sola fila 'default'.
// Con backend lee/escribe company_settings (RLS: staff lee, admin escribe). Sin backend,
// opera sobre un mock local. Alimenta el timbrado CFDI y los encabezados de recibos.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

export interface CompanySettings {
  razon_social: string
  rfc: string
  regimen_fiscal: string
  cp: string
  direccion: string
  telefono: string
  email: string
  logo_url: string
  // Datos bancarios para el pago por transferencia (R-58).
  banco: string
  clabe: string
  cuenta: string
  titular: string
  // ORIGEN DE ENVÍOS (remitente de paquetería), NEUTRAL al proveedor (DHL/T1).
  // Independiente del domicilio FISCAL: el shipping usa EXCLUSIVAMENTE estos campos,
  // sin fallback al fiscal. Vacío hasta que Dirección capture el domicilio operativo.
  shipping_name: string
  shipping_address: string
  shipping_cp: string
  shipping_city: string
  shipping_state: string
  shipping_country: string
  shipping_phone: string
  shipping_email: string
}

export const EMPTY_COMPANY: CompanySettings = {
  razon_social: '', rfc: '', regimen_fiscal: '', cp: '', direccion: '', telefono: '', email: '', logo_url: '',
  banco: '', clabe: '', cuenta: '', titular: '',
  shipping_name: '', shipping_address: '', shipping_cp: '', shipping_city: '',
  shipping_state: '', shipping_country: 'MX', shipping_phone: '', shipping_email: '',
}

// Mock: sin datos capturados (el cliente los llena en Configuración antes del go-live).
const MOCK: CompanySettings[] = [{ ...EMPTY_COMPANY }]

// El backend devuelve las columnas como NULL cuando están vacías; hay que colapsarlas a ''
// (un spread directo dejaría null y rompería cualquier .trim() en la UI — bug real que el
// smoke de backend cazó en Configuración). Función pura para poder testearla.
export function normalizeCompany(row: Partial<Record<keyof CompanySettings, string | null>> | null): CompanySettings {
  const r = row ?? {}
  return {
    razon_social: r.razon_social ?? '',
    rfc: r.rfc ?? '',
    regimen_fiscal: r.regimen_fiscal ?? '',
    cp: r.cp ?? '',
    direccion: r.direccion ?? '',
    telefono: r.telefono ?? '',
    email: r.email ?? '',
    logo_url: r.logo_url ?? '',
    banco: r.banco ?? '',
    clabe: r.clabe ?? '',
    cuenta: r.cuenta ?? '',
    titular: r.titular ?? '',
    shipping_name: r.shipping_name ?? '',
    shipping_address: r.shipping_address ?? '',
    shipping_cp: r.shipping_cp ?? '',
    shipping_city: r.shipping_city ?? '',
    shipping_state: r.shipping_state ?? '',
    shipping_country: r.shipping_country ?? '', // default 'MX' lo aplica shipperFromCompany
    shipping_phone: r.shipping_phone ?? '',
    shipping_email: r.shipping_email ?? '',
  }
}

const live = makeLive<CompanySettings>(async () => {
  const { data, error } = await supabase
    .from('company_settings')
    .select('razon_social, rfc, regimen_fiscal, cp, direccion, telefono, email, logo_url, banco, clabe, cuenta, titular, shipping_name, shipping_address, shipping_cp, shipping_city, shipping_state, shipping_country, shipping_phone, shipping_email')
    .eq('id', 'default')
    .maybeSingle()
  if (error) throw error
  return [normalizeCompany(data as Partial<Record<keyof CompanySettings, string | null>> | null)]
}, MOCK)

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

export function currentCompany(): CompanySettings {
  return live.current()[0] ?? EMPTY_COMPANY
}

export function saveCompany(patch: Partial<CompanySettings>): void {
  const next = { ...currentCompany(), ...patch }
  live.setLocal([next])
  logAudit({ actor: 'Administración', action: 'Datos de empresa actualizados', resource: next.razon_social || 'empresa' })
  if (hasSupabase) {
    supabase.from('company_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 'default')
      .then(({ error }) => { if (error) console.warn('[company] update', error.message); live.reload() })
  }
}
