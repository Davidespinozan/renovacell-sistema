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
/** ENT-H · Horario de entrega local elegido (fecha YYYY-MM-DD, inicio HH:MM). El servidor valida, completa `fin` y reserva. */
export interface HorarioElegido { fecha: string; inicio: string }
export interface HorarioEntrega extends HorarioElegido { fin: string; etiqueta?: string }
/** La entrega ya normalizada por el servidor (en la revisión del checkout y en shipping_meta.entrega del pedido). */
export interface EntregaPedido {
  opcion: string; tipo: TipoEntrega; paqueteria?: Paqueteria | null; texto: string; flete: number; flete_regla: number; ajuste_motivo?: string
  local: boolean; cp?: string | null; salida: string; antes_de_corte: boolean; llega_desde: string; llega_hasta: string
  recoge?: { lugar: string; horario: string }
  /** ENT-H · solo la entrega local por chofer: el horario reservado en la agenda. */
  horario?: HorarioEntrega | null
  reprogramado?: { anterior?: HorarioEntrega | null; motivo: string; at: string } | null
}
/** Lo que manda quien pide: la opción, el horario (entrega local) y, SOLO el personal, un flete distinto con su motivo. */
export interface EleccionEntregaServidor { opcion: string; flete?: number; motivo?: string; horario?: HorarioElegido | null }

/** ENT-H · Lo que el servidor ofrece para elegir horario: días desde la salida del chofer y, por día, cada horario con su estado. */
export interface SlotHorario { inicio: string; fin: string; ocupados: number; cupo: number; disponible: boolean; motivo?: 'OCUPADO' | 'PASADO' | null }
export interface DiaHorarios { fecha: string; dia_semana: number; slots: SlotHorario[]; disponibles: number }
export interface HorariosDisponibles {
  zona: string; hoy: string; ahora: string; salida: string; antes_de_corte: boolean; corte: string
  cupo: number; intervalo_min: number; margen_min: number; franjas: Array<{ desde: string; hasta: string }>; dias: DiaHorarios[]
}
/** ENT-H · La agenda que ven Dirección, Almacén y Chofer. */
export interface PedidoAgendado {
  order_id: string; folio: string | null; estado_pedido: string | null; pagado: boolean; cliente: string; telefono: string | null
  direccion: { line1?: string; colonia?: string; cp?: string; city?: string; refs?: string; phone?: string } | null
  flete: number; total: number | null; envio_estado: string | null; chofer: string | null; reservado_at: string
}
export interface SlotAgenda { inicio: string; fin: string; cupo: number; pedidos: PedidoAgendado[] }
export interface DiaAgenda { fecha: string; dia_semana: number; hoy: boolean; slots: SlotAgenda[]; entregas: number }
export interface AgendaEntregas { desde: string; hasta: string; hoy: string; zona: string; cupo: number; dias: DiaAgenda[] }

export const MOTIVO_ENTREGA: Record<string, string> = {
  SOLO_PERSONAL: 'solo en punto de venta',
  REQUIERE_DIRECCION: 'necesita una dirección de entrega',
  ZONA_FORANEA: 'fuera de Culiacán',
  ZONA_LOCAL: 'en Culiacán la entrega es por chofer',
  MINIMO_LOCAL: 'la entrega local es a partir del mínimo',
  HORARIO_REQUERIDO: 'elige el horario de entrega',
  HORARIO_INVALIDO: 'ese horario de entrega no existe',
  HORARIO_OCUPADO: 'ese horario se acaba de ocupar; elige otro',
  HORARIO_PASADO: 'ese horario ya pasó; elige uno más tarde',
  HORARIO_LEJANO: 'ese horario está demasiado lejos',
  HORARIO_DIA_NO_VALIDO: 'ese día el chofer no entrega',
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
export type PromesaInput = Pick<EntregaPedido, 'tipo' | 'salida' | 'llega_desde' | 'llega_hasta'> & Partial<Pick<EntregaPedido, 'recoge' | 'horario'>>
export function promesaDe(e: PromesaInput, hoy?: string | null): string {
  const esHoy = (d: string) => !!hoy && d === hoy
  const dia = (d: string) => (esHoy(d) ? 'hoy' : fechaCorta(d))
  if (e.tipo === 'mostrador') return 'Te lo llevas ahora'
  // ENT-H · entrega local con horario: el día y la ventana de media hora que se reservó.
  const h = e.horario ?? null
  if (h && h.fecha && h.inicio) return h.fin ? `Llega ${esHoy(h.fecha) ? 'hoy' : 'el ' + fechaCorta(h.fecha)} entre ${h.inicio} y ${h.fin}` : `Llega ${esHoy(h.fecha) ? 'hoy' : 'el ' + fechaCorta(h.fecha)} a las ${h.inicio}`
  if (e.tipo === 'recoge') {
    const lugar = e.recoge ? ` en ${e.recoge.lugar}` : ''
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
/** ENT-H · ¿Esa opción exige elegir horario? Solo la entrega local por chofer. */
export function requiereHorario(o: Pick<OpcionEntrega, 'tipo' | 'paqueteria'> | null | undefined): boolean { return !!o && o.tipo === 'local' && o.paqueteria === 'chofer' }
/** "jueves 22 oct · 10:30–11:00" */
export function textoHorario(h: Pick<HorarioEntrega, 'fecha' | 'inicio' | 'fin'> | null | undefined, hoy?: string | null): string {
  if (!h) return ''
  return `${hoy && h.fecha === hoy ? 'hoy' : fechaCorta(h.fecha)} · ${h.inicio}–${h.fin}`
}
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

/** ENT-H · Horarios de entrega local para elegir (doctor y personal). El servidor decide qué día y qué horas se ofrecen. */
export async function horariosEntregaDisponibles(): Promise<{ ok: true; data: HorariosDisponibles } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('entrega_horarios_disponibles')
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as unknown as HorariosDisponibles }
}
/** ENT-H · Agenda de entregas locales (Dirección, Almacén/Empaque, Chofer). Fechas YYYY-MM-DD; sin rango = desde hoy, 7 días. */
export async function agendaEntregasLocales(desde?: string | null, hasta?: string | null): Promise<{ ok: true; data: AgendaEntregas } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('entrega_horarios_agenda', { p_desde: desde ?? undefined, p_hasta: hasta ?? undefined })
  if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message) ? 'La agenda de entregas es de Dirección, Almacén y Chofer.' : error.message }
  return { ok: true, data: data as unknown as AgendaEntregas }
}
/** ENT-H · Dirección/Almacén mueven una entrega local a otro horario (con motivo; queda en la bitácora y en el pedido). */
export async function reprogramarHorarioEntrega(orderId: string, horario: HorarioElegido, motivo: string): Promise<{ ok: true; data: { order_id: string; folio: string | null; horario: HorarioEntrega; anterior: HorarioEntrega | null } } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('entrega_horario_reprogramar', { p_order: orderId, p_fecha: horario.fecha, p_inicio: horario.inicio, p_motivo: motivo })
  if (error) return { ok: false, error: textoErrorHorario(error.message) }
  return { ok: true, data: data as unknown as { order_id: string; folio: string | null; horario: HorarioEntrega; anterior: HorarioEntrega | null } }
}
/** Mensaje en palabras para los errores del servidor sobre horarios (códigos HORARIO_*, MOTIVO_REQUERIDO…). */
export function textoErrorHorario(msg: string): string {
  const code = Object.keys(MOTIVO_ENTREGA).find((k) => k.startsWith('HORARIO_') && msg.includes(k))
  if (code) return MOTIVO_ENTREGA[code].charAt(0).toUpperCase() + MOTIVO_ENTREGA[code].slice(1) + '.'
  if (/NO_AUTORIZADO/.test(msg)) return 'Solo Dirección o Almacén reprograman una entrega.'
  if (/MOTIVO_REQUERIDO/.test(msg)) return 'Escribe por qué se cambia el horario.'
  if (/PEDIDO_CERRADO/.test(msg)) return 'Ese pedido ya está cerrado y no se reprograma.'
  if (/HORARIO_NO_APLICA/.test(msg)) return 'Solo las entregas locales por chofer llevan horario.'
  return msg
}

// ── ENT-CFG · la regla de entrega, editable por Dirección (Configuración). El servidor valida y audita (entrega_config_guardar). ──
export interface EntregaConfig {
  corte: string; foraneo_gratis_desde: number; foraneo_costo: number; local_gratis_desde: number; local_costo: number
  cp_local_desde: string; cp_local_hasta: string; dias_paqueteria: number[]; dias_chofer: number[]; dias_entrega_foranea: number[]
  dhl_transito_min: number; dhl_transito_max: number; t1_activo: boolean; t1_transito_min: number; t1_transito_max: number
  local_mismo_dia: boolean; recoge_lugar: string; recoge_horario: string; updated_at?: string
  /** ENT-H · bloques de entrega local, intervalo, cupo por horario, margen del mismo día y días hacia adelante. */
  horario_franjas: Array<{ desde: string; hasta: string }>; horario_intervalo_min: number; horario_cupo: number; horario_margen_min: number; horario_dias_adelante: number
}
type ResultadoCfg<T> = { ok: true; data: T } | { ok: false; error: string }
export async function verConfigEntrega(): Promise<ResultadoCfg<EntregaConfig>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('entrega_config_ver')
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'No se pudo leer la regla de entrega.' }
  return { ok: true, data: data as unknown as EntregaConfig }
}
export async function guardarConfigEntrega(d: Partial<EntregaConfig>): Promise<ResultadoCfg<EntregaConfig>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('entrega_config_guardar', { p: d as never })
  if (error) return { ok: false, error: /NO_AUTORIZADO/.test(error.message) ? 'Solo Dirección cambia la regla de entrega.' : /ck_entcfg_cp_rango/.test(error.message) ? 'El C.P. "hasta" debe ser mayor o igual que el "desde".' : /ck_entcfg_franjas/.test(error.message) ? 'Revisa los bloques de entrega: horas HH:MM y cada bloque debe terminar después de empezar.' : /ck_entcfg_(cupo|intervalo|margen|dias_adelante)/.test(error.message) ? 'Revisa los horarios de entrega: cupo 1–20, intervalo 10–120 min, margen 0–480 min, 1–30 días.' : /check constraint|invalid input/.test(error.message) ? 'Revisa los valores: montos de 0 en adelante, C.P. de 5 dígitos, tránsito de 0 a 30 días.' : error.message }
  return { ok: true, data: data as unknown as EntregaConfig }
}
