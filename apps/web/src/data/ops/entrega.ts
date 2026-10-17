// ENT-0 · Entrega del pedido: lo que el SERVIDOR decide (opciones permitidas, flete por regla, promesa de llegada con el
// corte de las 15:30) y lo que aquí solo se muestra. El cliente nunca manda el flete: manda el id de la opción elegida.
import { hasSupabase, supabase } from '../../lib/supabase'

export type TipoEntrega = 'mostrador' | 'recoge' | 'local' | 'foraneo'
export type Paqueteria = 'chofer' | 'dhl' | 't1'
export interface OpcionEntrega {
  id: string; tipo: TipoEntrega; paqueteria: Paqueteria | null; flete: number; permitido: boolean; motivo: string | null; disponible: boolean
  salida: string; antes_de_corte: boolean; llega_desde: string; llega_hasta: string; texto: string
}
export interface OpcionesEntrega {
  actor: 'doctor' | 'staff'; subtotal: number; cp: string | null; local: boolean
  corte: { hora: string; zona: string; antes_de_corte: boolean; hoy: string }
  regla: { foraneo_gratis_desde: number; foraneo_flete: number; local_gratis_desde: number }
  recoge: { lugar: string; horario: string }
  sugerida: string | null; opciones: OpcionEntrega[]
}
/** La entrega ya normalizada por el servidor (en la revisión del checkout y en shipping_meta.entrega del pedido). */
export interface EntregaPedido {
  opcion: string; tipo: TipoEntrega; paqueteria?: Paqueteria | null; texto: string; flete: number; flete_regla: number; ajuste_motivo?: string
  local: boolean; cp?: string | null; salida: string; antes_de_corte: boolean; llega_desde: string; llega_hasta: string
  recoge?: { lugar: string; horario: string }
}
/** Lo que manda quien pide: la opción y, SOLO el personal, un flete distinto con su motivo. */
export interface EleccionEntregaServidor { opcion: string; flete?: number; motivo?: string }

export const MOTIVO_ENTREGA: Record<string, string> = {
  SOLO_PERSONAL: 'solo en punto de venta',
  REQUIERE_DIRECCION: 'necesita una dirección de entrega',
  ZONA_FORANEA: 'fuera de Culiacán',
  ZONA_LOCAL: 'en Culiacán la entrega es por chofer',
  MINIMO_LOCAL: 'la entrega local es a partir del mínimo',
}
export const ETIQUETA_TIPO: Record<TipoEntrega, string> = { mostrador: 'En mostrador', recoge: 'Recoger en sucursal', local: 'Entrega local', foraneo: 'Envío a domicilio' }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** "lunes 20 oct" a partir de una fecha ISO (YYYY-MM-DD) sin pasar por la zona del navegador. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DIAS[dow]} ${d} ${MESES[m - 1]}`
}
/** Promesa de llegada en una línea: la frase que SIEMPRE ve el cliente. `hoy` (YYYY-MM-DD, hora local del negocio) afina "hoy". */
export function promesaDe(e: Pick<EntregaPedido, 'tipo' | 'salida' | 'llega_desde' | 'llega_hasta' | 'recoge'> | Pick<OpcionEntrega, 'tipo' | 'salida' | 'llega_desde' | 'llega_hasta'>, hoy?: string | null): string {
  const esHoy = (d: string) => !!hoy && d === hoy
  const dia = (d: string) => (esHoy(d) ? 'hoy' : fechaCorta(d))
  if (e.tipo === 'mostrador') return 'Te lo llevas ahora'
  if (e.tipo === 'recoge') {
    const lugar = 'recoge' in e && e.recoge ? ` en ${e.recoge.lugar}` : ''
    return `Listo para recoger ${esHoy(e.llega_desde) ? 'hoy' : 'el ' + fechaCorta(e.llega_desde)}${lugar}`
  }
  const sale = `Sale ${dia(e.salida)}`
  if (e.llega_desde === e.llega_hasta) return `${sale} · llega ${esHoy(e.llega_desde) ? 'hoy mismo' : 'el ' + fechaCorta(e.llega_desde)}`
  return `${sale} · llega entre el ${fechaCorta(e.llega_desde)} y el ${fechaCorta(e.llega_hasta)}`
}
/** Título de la opción con su paquetería. */
export function tituloOpcion(o: Pick<OpcionEntrega, 'texto'>): string { return o.texto }
/** Flete en texto: "Gratis" o el importe. */
export function fleteTexto(flete: number | null | undefined, money: (n: number) => string): string { return !flete ? 'Gratis' : money(flete) }
/** ¿Esa opción necesita dirección de entrega? (recoger y mostrador, no). */
export function requiereDireccion(tipo: TipoEntrega | null | undefined): boolean { return tipo === 'local' || tipo === 'foraneo' }
export function opcionDe(ops: OpcionesEntrega | null | undefined, id: string | null | undefined): OpcionEntrega | null {
  return ops?.opciones.find((o) => o.id === id) ?? null
}

/** Opciones para el PERSONAL (punto de venta): importe de productos y CP del domicilio elegido. */
export async function opcionesEntrega(actor: 'doctor' | 'staff', subtotal: number, cp: string | null): Promise<{ ok: true; data: OpcionesEntrega } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('entrega_opciones', { p_actor: actor, p_subtotal: subtotal, p_cp: cp as string })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as unknown as OpcionesEntrega }
}
