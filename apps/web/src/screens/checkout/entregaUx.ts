// CX-V2-A · Textos y regla de selección de la entrega en el checkout del doctor. TODO importe sale de la revisión del
// servidor (`entrega_opciones`: regla, subtotal, flete de cada opción); aquí no hay mínimos, tarifas ni promesas propias.
// Un estado = un texto exacto. La regla de selección conserva la elección válida y nunca cambia en silencio a recoger.
import { money } from '../../lib/format'
import { MOTIVO_ENTREGA, fleteTexto, promesaDe, requiereHorario, type HorarioElegido, type OpcionEntrega, type OpcionesEntrega } from '../../data/ops/entrega'

export interface Faltante { minimo: number; faltante: number }

/** ¿La opción se puede elegir? (permitida por la regla y con la paquetería activa). */
export const puedeElegir = (o: Pick<OpcionEntrega, 'permitido' | 'disponible'>): boolean => o.permitido && o.disponible

/** Mínimo de envío gratis de ESA modalidad y cuánto falta, con los números del servidor. Null si no aplica. */
export function faltantePara(ops: Pick<OpcionesEntrega, 'regla' | 'subtotal'>, o: Pick<OpcionEntrega, 'tipo'>): Faltante | null {
  const minimo = o.tipo === 'local' ? ops.regla.local_gratis_desde : o.tipo === 'foraneo' ? ops.regla.foraneo_gratis_desde : null
  if (minimo == null || !Number.isFinite(minimo) || minimo <= 0) return null
  return { minimo, faltante: Math.max(0, Math.round((minimo - Math.max(0, ops.subtotal)) * 100) / 100) }
}

/** Chip a la derecha del título: flete si se puede elegir; si no, la condición real en dos o tres palabras. */
export function etiquetaOpcion(o: OpcionEntrega, ops: Pick<OpcionesEntrega, 'regla' | 'subtotal'>): string {
  if (!o.disponible) return 'Próximamente'
  if (puedeElegir(o)) return fleteTexto(o.flete, money)
  const f = faltantePara(ops, o)
  switch (o.motivo) {
    case 'MINIMO_LOCAL': return f ? `Gratis desde ${money(f.minimo)}` : 'Mínimo no alcanzado'
    case 'ZONA_LOCAL': return 'No aplica en tu zona'
    case 'ZONA_FORANEA': return 'Fuera de zona'
    case 'REQUIERE_DIRECCION': return 'Falta dirección'
    default: return 'No disponible'
  }
}

export interface ContextoOpcion { hoy: string | null; seleccionada: boolean; horario: HorarioElegido | null }
/** Explicación debajo del título: promesa si se puede elegir; si no, la causa REAL y qué hacer. */
export function descripcionOpcion(o: OpcionEntrega, ops: Pick<OpcionesEntrega, 'regla' | 'subtotal' | 'recoge'>, ctx: ContextoOpcion): string {
  if (!o.disponible) return 'Próximamente. Esta paquetería aún no está activa.'
  if (puedeElegir(o)) {
    const base = requiereHorario(o)
      ? (ctx.seleccionada && ctx.horario ? `Llega ${ctx.horario.fecha === ctx.hoy ? 'hoy' : 'el ' + ctx.horario.fecha.slice(8, 10) + '/' + ctx.horario.fecha.slice(5, 7)} a las ${ctx.horario.inicio}` : 'Eliges un horario de media hora')
      : promesaDe(o, ctx.hoy)
    if (o.tipo === 'recoge') return `${base} · ${ops.recoge.horario}. No usaremos tu dirección de entrega.`
    const f = faltantePara(ops, o)
    if (o.flete > 0 && f && f.faltante > 0) return `${base} · Gratis desde ${money(f.minimo)}: te faltan ${money(f.faltante)}.`
    return base
  }
  const f = faltantePara(ops, o)
  switch (o.motivo) {
    case 'MINIMO_LOCAL':
      return f ? `Gratis desde ${money(f.minimo)}. Llevas ${money(Math.max(0, ops.subtotal))} en productos: te faltan ${money(f.faltante)} para la entrega a tu domicilio.` : 'La entrega local es a partir del mínimo.'
    case 'ZONA_LOCAL': return 'Dentro de Culiacán entregamos con nuestro chofer o puedes recoger en sucursal. La paquetería es para envíos fuera de la ciudad.'
    case 'ZONA_FORANEA': return 'Tu dirección está fuera de la zona de entrega local. Para esa dirección usa el envío por paquetería.'
    case 'REQUIERE_DIRECCION': return 'Agrega una dirección de entrega para ver esta opción.'
    default: return (MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'No aplica para este pedido') + '.'
  }
}

/** Botón para volver al catálogo: solo cuando agregar productos cambia la entrega (mínimo local o foráneo no alcanzado). */
export function llamadaFaltante(ops: OpcionesEntrega): { texto: string; faltante: number; minimo: number } | null {
  const local = ops.opciones.find((o) => o.tipo === 'local' && !o.permitido && o.motivo === 'MINIMO_LOCAL')
  if (local) { const f = faltantePara(ops, local); if (f && f.faltante > 0) return { texto: 'Agregar productos para entrega gratis', ...f } }
  const foraneo = ops.opciones.find((o) => o.tipo === 'foraneo' && puedeElegir(o) && o.flete > 0)
  if (foraneo) { const f = faltantePara(ops, foraneo); if (f && f.faltante > 0) return { texto: 'Agregar productos para envío gratis', ...f } }
  return null
}

/** Opciones que el doctor puede ver (lo que es solo del personal ni se muestra). */
export const opcionesVisibles = (ops: OpcionesEntrega): OpcionEntrega[] => ops.opciones.filter((o) => o.permitido || o.motivo !== 'SOLO_PERSONAL')
export const opcionesElegibles = (ops: OpcionesEntrega): OpcionEntrega[] => opcionesVisibles(ops).filter(puedeElegir)

export interface Seleccion { opcion: string | null; invalidada: OpcionEntrega | null; unica: boolean }
/**
 * Regla de selección cuando llegan (o cambian) las opciones:
 *  · la elección vigente se conserva mientras siga siendo elegible;
 *  · si deja de serlo, se informa y se exige elegir de nuevo (nunca se cambia en silencio);
 *  · sin elección previa: si solo hay una elegible se preselecciona (y se dice que es la única); si hay varias, la sugerida
 *    del servidor cuando es elegible; si no, ninguna.
 */
export function elegirOpcion(ops: OpcionesEntrega, actual: string | null): Seleccion {
  const elegibles = opcionesElegibles(ops)
  const unica = elegibles.length === 1
  const sel = actual ? ops.opciones.find((o) => o.id === actual) ?? null : null
  if (sel && puedeElegir(sel)) return { opcion: sel.id, invalidada: null, unica }
  if (sel) return { opcion: null, invalidada: sel, unica }
  if (unica) return { opcion: elegibles[0].id, invalidada: null, unica }
  const sugerida = ops.sugerida && elegibles.some((o) => o.id === ops.sugerida) ? ops.sugerida : null
  return { opcion: sugerida, invalidada: null, unica }
}

/** Aviso cuando la modalidad elegida dejó de ser válida (cambió el carrito o la dirección). */
export function avisoInvalidada(o: OpcionEntrega, ops: Pick<OpcionesEntrega, 'regla' | 'subtotal'>): string {
  const f = faltantePara(ops, o)
  const causa = !o.disponible ? 'ya no está disponible'
    : o.motivo === 'MINIMO_LOCAL' && f ? `mínimo ${money(f.minimo)}, te faltan ${money(f.faltante)}`
    : o.motivo === 'ZONA_LOCAL' || o.motivo === 'ZONA_FORANEA' ? 'la dirección cambió de zona'
    : o.motivo === 'REQUIERE_DIRECCION' ? 'falta la dirección de entrega'
    : (MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'ya no aplica')
  return `Tu pedido ya no cumple para ${o.texto} (${causa}). Elige otra forma de entrega.`
}

/** Identidad de la dirección elegida (para recalcular las opciones cuando cambia). */
export function claveDireccion(c: { address: unknown | null; locationId?: string } | null): string {
  if (!c || (!c.address && !c.locationId)) return 'ninguna'
  return c.locationId ? `loc:${c.locationId}` : `dir:${JSON.stringify(c.address)}`
}
