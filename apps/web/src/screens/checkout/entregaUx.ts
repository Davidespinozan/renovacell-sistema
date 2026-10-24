// CX-V2-A/B · Presentación de la entrega en el checkout del doctor. TODO importe sale de la revisión del servidor
// (`entrega_opciones`: regla, subtotal, flete de cada opción); aquí no hay mínimos, tarifas ni promesas propias.
// CX-V2-B · solo se muestran las alternativas relevantes (lo que no aplica a esa dirección o no está activo no ocupa una
// tarjeta), cada tarjeta dice una cosa y el faltante se explica UNA vez. La regla de selección es la de CX-V2-A.
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

/** Nombre corto de la modalidad (lo que el doctor entiende); el servidor sigue siendo quien la define. */
export function tituloModalidad(o: Pick<OpcionEntrega, 'tipo' | 'paqueteria' | 'texto'>): string {
  if (o.tipo === 'recoge') return 'Recoger en sucursal'
  if (o.tipo === 'local') return 'Entrega con chofer'   // CX-V2-C · dentro de "Enviar a domicilio": el servicio, no la intención
  if (o.tipo === 'foraneo' && o.paqueteria === 'dhl') return 'Envío por DHL'
  if (o.tipo === 'foraneo' && o.paqueteria === 't1') return 'Envío por T1'
  return o.texto
}

export type AccionTarjeta = 'agregar' | 'direccion'
export interface Tarjeta {
  id: string; titulo: string; precio: string; linea: string
  /** Segunda línea opcional (p. ej. cuánto falta para el envío gratis de una opción que ya se puede elegir). */
  nota?: string
  accion?: AccionTarjeta
  /** Se muestra pero aún no se puede elegir (mínimo no alcanzado, falta la dirección). */
  bloqueada: boolean
}
export interface ContextoTarjeta { hoy: string | null; seleccionada: boolean; horario: HorarioElegido | null }

/**
 * La tarjeta de una opción, o null si NO es relevante para esta dirección y este pedido (se oculta):
 * paquetería inactiva (T1), DHL dentro de la zona local, chofer fuera de ella, opciones solo del personal y
 * duplicados de "falta dirección" (basta la tarjeta de entrega a domicilio).
 */
export function tarjetaEntrega(o: OpcionEntrega, ops: Pick<OpcionesEntrega, 'regla' | 'subtotal' | 'recoge'>, ctx: ContextoTarjeta): Tarjeta | null {
  const titulo = tituloModalidad(o)
  if (puedeElegir(o)) {
    if (o.tipo === 'recoge') return { id: o.id, titulo, precio: fleteTexto(o.flete, money), linea: `${promesaDe(o, ctx.hoy)} · ${ops.recoge.horario}`, bloqueada: false }
    if (o.tipo === 'mostrador') return null
    const linea = requiereHorario(o)
      ? (ctx.seleccionada && ctx.horario ? `Llega ${ctx.horario.fecha === ctx.hoy ? 'hoy' : 'el ' + ctx.horario.fecha.slice(8, 10) + '/' + ctx.horario.fecha.slice(5, 7)} a las ${ctx.horario.inicio}` : 'Eliges un horario de media hora')
      : promesaDe(o, ctx.hoy)
    const f = faltantePara(ops, o)
    const conCosto = o.flete > 0 && !!f && f.faltante > 0
    return { id: o.id, titulo, precio: fleteTexto(o.flete, money), linea, bloqueada: false,
      ...(conCosto ? { nota: `Gratis desde ${money(f!.minimo)} · agrega ${money(f!.faltante)}`, accion: 'agregar' as const } : {}) }
  }
  if (!o.disponible) return null
  if (o.tipo === 'local' && o.motivo === 'MINIMO_LOCAL') {
    const f = faltantePara(ops, o)
    if (!f || f.faltante <= 0) return null
    return { id: o.id, titulo, precio: `Gratis desde ${money(f.minimo)}`, linea: `Agrega ${money(f.faltante)} en productos para recibirlo gratis`, accion: 'agregar', bloqueada: true }
  }
  if (o.tipo === 'local' && o.motivo === 'REQUIERE_DIRECCION') {
    return { id: o.id, titulo, precio: '', linea: 'Agrega una dirección para ver si te lo llevamos', accion: 'direccion', bloqueada: true }
  }
  return null
}

/** Tarjetas en el orden del servidor, solo las relevantes. */
export function tarjetasEntrega(ops: OpcionesEntrega, sel: string | null, horario: HorarioElegido | null): Tarjeta[] {
  const hoy = ops.corte.hoy ?? null
  return ops.opciones
    .map((o) => tarjetaEntrega(o, ops, { hoy, seleccionada: o.id === sel, horario }))
    .filter((t): t is Tarjeta => t !== null)
}

/** Opciones que el doctor puede elegir (lo que es solo del personal ni se considera). */
export const opcionesElegibles = (ops: OpcionesEntrega): OpcionEntrega[] => ops.opciones.filter((o) => puedeElegir(o) && o.motivo !== 'SOLO_PERSONAL' && o.tipo !== 'mostrador')

export interface Seleccion { opcion: string | null; invalidada: OpcionEntrega | null; unica: boolean }
/**
 * Regla de selección (CX-V2-A, sin cambios) cuando llegan o cambian las opciones:
 *  · la elección vigente se conserva mientras siga siendo elegible;
 *  · si deja de serlo, se informa y se exige elegir de nuevo (nunca se cambia en silencio);
 *  · sin elección previa: si solo hay una elegible se preselecciona; si hay varias, la sugerida del servidor cuando es
 *    elegible; si no, ninguna.
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

// ── CX-V2-C · tres conceptos separados ───────────────────────────────────────────────────────────────────────────────
//   intención del doctor (recoger / enviar a domicilio) · dirección (solo si es domicilio) · modalidad que AUTORIZA el
//   servidor (recoge, local_chofer, foraneo_dhl…). La intención es solo de interfaz: lo que viaja al servidor sigue siendo
//   una modalidad que él reconoce. Nunca se usa `recoge` para tapar una intención de domicilio que no cumple.
export type Intencion = 'recoge' | 'domicilio'
export const esDomicilio = (o: Pick<OpcionEntrega, 'tipo'> | null | undefined): boolean => o?.tipo === 'local' || o?.tipo === 'foraneo'

/** Intención con la que abre el checkout: la de la modalidad que elegiría la regla de CX-V2-A (única elegible o sugerida). */
export function intencionInicial(ops: OpcionesEntrega): Intencion | null {
  const r = elegirOpcion(ops, null)
  const o = r.opcion ? ops.opciones.find((x) => x.id === r.opcion) ?? null : null
  return !o ? null : o.tipo === 'recoge' ? 'recoge' : esDomicilio(o) ? 'domicilio' : null
}

/**
 * Modalidad dentro de la intención:
 *  · recoger → la opción de recoger (siempre se puede);
 *  · domicilio → la elección vigente si sigue siendo una modalidad a domicilio elegible; si dejó de serlo, se informa y se
 *    exige elegir (nunca se cambia sola, ni a recoger ni a otra con otro precio); sin elección: la única elegible o la
 *    sugerida del servidor si es a domicilio; si no, ninguna (el doctor ve por qué).
 */
export function elegirEnIntencion(ops: OpcionesEntrega, intencion: Intencion | null, actual: string | null): { opcion: string | null; invalidada: OpcionEntrega | null } {
  if (!intencion) return { opcion: null, invalidada: null }
  if (intencion === 'recoge') {
    const r = ops.opciones.find((o) => o.tipo === 'recoge' && puedeElegir(o))
    return { opcion: r?.id ?? null, invalidada: null }
  }
  const elegibles = opcionesElegibles(ops).filter(esDomicilio)
  const sel = actual ? ops.opciones.find((o) => o.id === actual) ?? null : null
  if (sel && esDomicilio(sel)) return puedeElegir(sel) ? { opcion: sel.id, invalidada: null } : { opcion: null, invalidada: sel }
  if (elegibles.length === 1) return { opcion: elegibles[0].id, invalidada: null }
  const sugerida = ops.sugerida && elegibles.some((o) => o.id === ops.sugerida) ? ops.sugerida : null
  return { opcion: sugerida, invalidada: null }
}

/** Opciones de envío a domicilio que se muestran DENTRO de "Enviar a domicilio" (la dirección se elige arriba de ellas). */
export function tarjetasDomicilio(ops: OpcionesEntrega, sel: string | null, horario: HorarioElegido | null): Tarjeta[] {
  return tarjetasEntrega(ops, sel, horario).filter((t) => esDomicilio(ops.opciones.find((o) => o.id === t.id)) && t.accion !== 'direccion')
}

/** Aviso breve cuando la modalidad elegida dejó de ser válida (cambió el carrito o la dirección). */
export function avisoInvalidada(o: OpcionEntrega, ops: Pick<OpcionesEntrega, 'regla' | 'subtotal'>): string {
  const f = faltantePara(ops, o)
  const causa = !o.disponible ? 'ya no está disponible'
    : o.motivo === 'MINIMO_LOCAL' && f ? `faltan ${money(f.faltante)} para el mínimo de ${money(f.minimo)}`
    : o.motivo === 'ZONA_LOCAL' || o.motivo === 'ZONA_FORANEA' ? 'no aplica para esta dirección'
    : o.motivo === 'REQUIERE_DIRECCION' ? 'falta la dirección'
    : (MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'ya no aplica')
  return `${tituloModalidad(o)}: ${causa}. Elige otra opción.`
}

/** Identidad de la dirección elegida (para recalcular las opciones cuando cambia). */
export function claveDireccion(c: { address: unknown | null; locationId?: string } | null): string {
  if (!c || (!c.address && !c.locationId)) return 'ninguna'
  return c.locationId ? `loc:${c.locationId}` : `dir:${JSON.stringify(c.address)}`
}

/** Una línea con la dirección elegida: calle, C.P. y ciudad. */
export function resumenDireccion(a: { line1?: string; cp?: string; city?: string } | null | undefined): string {
  if (!a?.line1) return ''
  return [a.line1, [a.cp ? `C.P. ${a.cp}` : '', a.city ?? ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
}
