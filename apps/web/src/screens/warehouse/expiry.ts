// Helpers de caducidad para Almacén.
import { diaNegocio, diasEntre, hoyNegocio } from '../../data/periodo'
export type Sev = 'expired' | 'critical' | 'warn' | 'ok'

// Días de CALENDARIO del negocio hasta la caducidad (0 = caduca hoy; negativo = caducó).
// Mismo "hoy" que el servidor (`hoy_local()`): un lote está vigente hasta su día de
// caducidad inclusive, visto desde donde se vea.
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const dia = diaNegocio(iso)
  return dia ? diasEntre(hoyNegocio(), dia) : null
}

export function severity(days: number | null): Sev {
  if (days == null) return 'ok'
  if (days < 0) return 'expired'
  if (days <= 60) return 'critical'
  if (days <= 120) return 'warn'
  return 'ok'
}

export function sevPill(s: Sev): 'p-dang' | 'p-warn' | 'p-ok' {
  return s === 'expired' || s === 'critical' ? 'p-dang' : s === 'warn' ? 'p-warn' : 'p-ok'
}

export function sevLabel(days: number | null): string {
  if (days == null) return 'Sin caducidad'
  if (days < 0) return `Caducó hace ${-days} día${-days === 1 ? '' : 's'}`
  if (days === 0) return 'Caduca hoy'
  if (days === 1) return 'Caduca mañana'
  return `Caduca en ${days} días`
}
