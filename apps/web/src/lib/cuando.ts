// Fechas cortas para mensajes y avisos, con el reloj del NEGOCIO (Mazatlán): "Hoy"/"Ayer" según el día de la
// operación, no el del dispositivo. Mismo criterio que los separadores del chat de mensajería.
import { diaNegocio, hoyNegocio, sumarDias, ZONA_NEGOCIO } from '../data/periodo'

export const horaDe = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: ZONA_NEGOCIO }) }
export const diaDe = (iso: string): string => {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''
  const dia = diaNegocio(d); const hoy = hoyNegocio()
  if (dia === hoy) return 'Hoy'
  if (dia === sumarDias(hoy, -1)) return 'Ayer'
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: ZONA_NEGOCIO })
}
// Lista de chats: la hora si es de hoy; si no, "Ayer" o la fecha corta.
export const cuandoLista = (iso: string): string => { const d = diaDe(iso); return d === 'Hoy' ? horaDe(iso) : d }
// Publicaciones: "Hoy, 09:58" / "Ayer, 18:20" / "12 oct".
export const cuandoPublicado = (iso: string): string => { const d = diaDe(iso); return d === 'Hoy' || d === 'Ayer' ? `${d}, ${horaDe(iso)}` : d }
