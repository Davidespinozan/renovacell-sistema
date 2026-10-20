// Configuración de empresa (emisor CFDI + identidad). Singleton: una sola fila 'default'.
// Con backend lee/escribe company_settings (RLS: staff lee, admin escribe). Sin backend,
// opera sobre un mock local. Alimenta el timbrado CFDI y los encabezados de recibos.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import { confirmar, type Escritura } from './escritura'

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
  // ORIGEN ESTRUCTURADO (183): calle, número exterior, interior/local, colonia y referencias. T1 los exige; DHL usa la línea
  // `shipping_address`, que el servidor arma a partir de ellos cuando existen (una sola verdad).
  shipping_street: string
  shipping_ext_number: string
  shipping_int_number: string
  shipping_colonia: string
  shipping_references: string
}

export const EMPTY_COMPANY: CompanySettings = {
  razon_social: '', rfc: '', regimen_fiscal: '', cp: '', direccion: '', telefono: '', email: '', logo_url: '',
  banco: '', clabe: '', cuenta: '', titular: '',
  shipping_name: '', shipping_address: '', shipping_cp: '', shipping_city: '',
  shipping_state: '', shipping_country: 'MX', shipping_phone: '', shipping_email: '',
  shipping_street: '', shipping_ext_number: '', shipping_int_number: '', shipping_colonia: '', shipping_references: '',
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
    shipping_street: r.shipping_street ?? '',
    shipping_ext_number: r.shipping_ext_number ?? '',
    shipping_int_number: r.shipping_int_number ?? '',
    shipping_colonia: r.shipping_colonia ?? '',
    shipping_references: r.shipping_references ?? '',
  }
}

const live = makeLive<CompanySettings>(async () => {
  const { data, error } = await supabase
    .from('company_settings')
    .select('razon_social, rfc, regimen_fiscal, cp, direccion, telefono, email, logo_url, banco, clabe, cuenta, titular, shipping_name, shipping_address, shipping_cp, shipping_city, shipping_state, shipping_country, shipping_phone, shipping_email, shipping_street, shipping_ext_number, shipping_int_number, shipping_colonia, shipping_references')
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

// W4: estos son los datos del emisor que viajan en cada factura. "Guardado" solo se
// dice cuando el servidor los tiene.
export async function saveCompany(patch: Partial<CompanySettings>): Promise<Escritura> {
  const next = { ...currentCompany(), ...patch }
  if (hasSupabase) {
    const r = await confirmar('guardar los datos de la empresa',
      supabase.from('company_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 'default'))
    if (!r.ok) return r
  }
  live.setLocal([next])
  logAudit({ actor: 'Administración', action: 'Datos de empresa actualizados', resource: next.razon_social || 'empresa' })
  return { ok: true }
}
