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
  // Origen operativo (remitente de paquetería), reutilizable por DHL/T1. Estas
  // columnas existen tras la migración 20260926120000; este archivo debe
  // desplegarse junto con esa migración.
  ciudad: string
  estado: string
  pais: string
}

export const EMPTY_COMPANY: CompanySettings = {
  razon_social: '', rfc: '', regimen_fiscal: '', cp: '', direccion: '', telefono: '', email: '', logo_url: '',
  banco: '', clabe: '', cuenta: '', titular: '',
  ciudad: '', estado: '', pais: 'MX',
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
    ciudad: r.ciudad ?? '',
    estado: r.estado ?? '',
    pais: r.pais ?? '', // el default operativo 'MX' lo aplica shipperFromCompany, no aquí
  }
}

const live = makeLive<CompanySettings>(async () => {
  const { data, error } = await supabase
    .from('company_settings')
    .select('razon_social, rfc, regimen_fiscal, cp, direccion, telefono, email, logo_url, banco, clabe, cuenta, titular, ciudad, estado, pais')
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
