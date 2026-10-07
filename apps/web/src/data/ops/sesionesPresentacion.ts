// Chat V2-C3 · Presentación de SESIONES (solo texto; sin lógica de ciclo de vida: eso es C1/C2 en el servidor).
// Fechas con el reloj del NEGOCIO (data/periodo.ts · Mazatlán), nunca con el calendario del dispositivo.
import { diaNegocio, hoyNegocio, sumarDias, ZONA_NEGOCIO } from '../periodo'
import { capitalizarNombre, nombrePersona } from '../../lib/nombres'
import type { Mensaje } from './chat'

/** Quién mira: el dueño de la conversación (doctor/visitante) o el personal (asesor/Dirección). */
export type Visor = 'cliente' | 'personal'

const valida = (iso: string | null | undefined): Date | null => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d }
export const horaNegocio = (iso: string | null | undefined): string => { const d = valida(iso); return d ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: ZONA_NEGOCIO }) : '' }
/** Hora de 24 h para los rangos de la lista ("10:32–11:05"). */
const hora24 = (iso: string | null | undefined): string => { const d = valida(iso); return d ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA_NEGOCIO }) : '' }

/** "Hoy", "Ayer" o "6 oct" según el día de Mazatlán. */
export function diaEtiqueta(iso: string | null | undefined): string {
  const d = valida(iso); if (!d) return ''
  const dia = diaNegocio(d); const hoy = hoyNegocio()
  if (dia === hoy) return 'Hoy'
  if (dia === sumarDias(hoy, -1)) return 'Ayer'
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: ZONA_NEGOCIO }).replace('.', '')
}

/** "Hoy · 10:32–11:05", "6 oct · 21:46 – 7 oct · 18:55" o "Hoy · desde 10:32" (sesión abierta). */
export function rangoSesion(s: { opened_at: string; closed_at: string | null; last_activity_at?: string | null }): string {
  const ini = valida(s.opened_at)
  if (!ini) return ''
  const fin = valida(s.closed_at)
  if (!fin) return `${diaEtiqueta(s.opened_at)} · desde ${hora24(s.opened_at)}`
  if (diaNegocio(ini) === diaNegocio(fin)) return `${diaEtiqueta(s.opened_at)} · ${hora24(s.opened_at)}–${hora24(s.closed_at)}`
  return `${diaEtiqueta(s.opened_at)} · ${hora24(s.opened_at)} – ${diaEtiqueta(s.closed_at)} · ${hora24(s.closed_at)}`
}

/** "Atendida por Lucía" o "Asistente" (nunca se inventa un asesor). */
export function quienAtendio(asesorNombre: string | null | undefined): string {
  const n = nombrePersona(asesorNombre)
  return n ? `Atendida por ${n}` : 'Asistente'
}

export const cantidadMensajes = (n: number | null | undefined): string => `${n ?? 0} mensaje${n === 1 ? '' : 's'}`

/** close_reason del servidor → texto humano (sin valores técnicos crudos). */
export function motivoCierre(motivo: string | null | undefined, visor: Visor, asesorNombre?: string | null): string | null {
  switch (motivo) {
    case null: case undefined: return null
    case 'asesor_finalizo': { const n = nombrePersona(asesorNombre); return visor === 'personal' && n ? `Finalizada por ${n}` : 'Finalizada por tu asesora' }
    case 'direccion_finalizo': return 'Finalizada por Renovacell'
    case 'inactividad': return 'Cerrada por inactividad'
    case 'solicitud_expirada': return visor === 'personal' ? 'Solicitud expirada' : 'Sin asesor disponible'
    case 'conversacion_cerrada': return 'Conversación cerrada'
    case 'consolidada': return 'Unida a tu cuenta'
    default: return 'Finalizada'
  }
}

/**
 * Etiqueta del autor de un mensaje según QUIÉN MIRA (C3 corrige el "Tú" en la vista del personal).
 *   · Propio: sin etiqueta (burbuja propia).
 *   · Cliente que mira: doctor/visitante ajeno (p. ej. mensajes previos como visitante) = "Tú".
 *   · Personal que mira: doctor = nombre del cliente si la superficie lo trae del servidor, si no "Doctor";
 *     visitante = "Visitante". Nunca "Tú".
 */
export function etiquetaActor(m: Pick<Mensaje, 'actor' | 'propio'>, visor: Visor, ctx: { nombreCliente?: string | null; nombreAsesor?: string | null; etiquetaAsesor: string }): string | null {
  if (m.propio) return null
  switch (m.actor) {
    case 'doctor': return visor === 'cliente' ? 'Tú' : (ctx.nombreCliente ? capitalizarNombre(ctx.nombreCliente) : 'Doctor')
    case 'visitor': return visor === 'cliente' ? 'Tú' : 'Visitante'
    case 'seller': return `${nombrePersona(ctx.nombreAsesor) ?? 'Asesor'} · ${ctx.etiquetaAsesor}`
    case 'admin': return 'Renovacell'
    case 'ai': return 'Asistente'
    case 'system': return null
  }
}
