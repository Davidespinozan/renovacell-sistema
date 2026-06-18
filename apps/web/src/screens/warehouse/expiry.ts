// Helpers de caducidad para Almacén.
export type Sev = 'expired' | 'critical' | 'warn' | 'ok'

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
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
  if (days == null) return 'Sin fecha'
  if (days < 0) return `Caducó hace ${-days} d`
  if (days === 0) return 'Caduca hoy'
  return `${days} d`
}
