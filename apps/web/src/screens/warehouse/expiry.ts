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

// Solo presentación (pantallas de Almacén): a más de 60 días "Caduca en 400 días" no se lee de un vistazo;
// basta mes y año. sevLabel no cambia (lo usan la exportación y otras vistas): lo cercano sigue en días.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function etiquetaCaducidad(days: number | null, iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null
  if (days != null && days > 60 && m) return `Caduca ${MESES[Number(m[2]) - 1]} ${m[1]}`
  return sevLabel(days)
}
