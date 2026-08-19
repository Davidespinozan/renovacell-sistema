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
}

export const EMPTY_COMPANY: CompanySettings = {
  razon_social: '', rfc: '', regimen_fiscal: '', cp: '', direccion: '', telefono: '', email: '', logo_url: '',
}

// Mock: sin datos capturados (el cliente los llena en Configuración antes del go-live).
const MOCK: CompanySettings[] = [{ ...EMPTY_COMPANY }]

const live = makeLive<CompanySettings>(async () => {
  const { data, error } = await supabase
    .from('company_settings')
    .select('razon_social, rfc, regimen_fiscal, cp, direccion, telefono, email, logo_url')
    .eq('id', 'default')
    .maybeSingle()
  if (error) throw error
  return [{ ...EMPTY_COMPANY, ...(data ?? {}) } as CompanySettings]
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
