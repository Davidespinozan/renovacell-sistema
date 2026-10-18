// PROMO-1 · Promociones por vigencia: una promoción (nombre, del día X al Y, varios productos con precio o escalones por
// cantidad) que el SERVIDOR aplica en precio_de/3 mientras dura. Aquí: tipos, cliente RPC, el texto que se muestra y el
// lector de promos pegadas como texto ("Botox 1 pieza $4,000 · 5 a 9 piezas $3,800 · 10 piezas $3,600 · del 16 al 25 de octubre").
import { hasSupabase, supabase } from '../../lib/supabase'
import { hoyNegocio } from '../periodo'

export interface LineaPromo { id?: string; product_id: string; producto?: string; precio_normal?: number | null; min_qty: number; precio: number }
export type EstadoPromo = 'vigente' | 'proxima' | 'vencida' | 'inactiva'
export interface VentasPromo { pedidos: number; piezas: number; importe: number }
export interface DifusionPromo { correo: number; chat: number; sin_correo: number; ultimo: string | null }
export type CanalDifusion = 'correo' | 'chat'
export interface DatosPromoDifusion { promocion_id?: string; nombre: string; descripcion?: string | null; vigencia: string; desde: string; hasta: string; lineas: string[]; productos: Array<{ product_id: string; nombre: string; imagen_url: string | null; presentacion: string | null; precio_normal: number | null; escalones: Array<{ desde: number; precio: number }> }>; texto?: string }
export interface PreviaDifusion { texto: string; chat_texto?: string; datos?: DatosPromoDifusion; audiencia: number; sin_correo: number; enviados: { correo: number; chat: number } }
export interface ResultadoDifusion { audiencia: number; correo: number; chat: number; sin_correo: number; ya_enviados: number; texto: string }
export interface Promocion { id: string; nombre: string; descripcion: string | null; desde: string; hasta: string; activa: boolean; listas: string[] | null; estado: EstadoPromo; lineas: LineaPromo[]; ventas?: VentasPromo; difusion?: DifusionPromo; updated_at?: string }
export interface PromoVigente { promocion_id: string; nombre: string; desde: string; hasta: string; listas: string[] | null; product_id: string; min_qty: number; precio: number }
export interface PromoDatos { id?: string; nombre: string; descripcion?: string | null; desde: string; hasta: string; activa?: boolean; listas?: string[] | null; lineas: Array<{ product_id: string; min_qty: number; precio: number }> }
type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export const ETIQUETA_ESTADO: Record<EstadoPromo, string> = { vigente: 'Vigente', proxima: 'Próxima', vencida: 'Terminada', inactiva: 'Pausada' }
export const PILL_ESTADO: Record<EstadoPromo, string> = { vigente: 'p-ok', proxima: 'p-blue', vencida: 'p-neu', inactiva: 'p-warn' }

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function fechaPromo(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return ''
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MESES[m - 1]}`
}
/** "del 16 al 25 de oct" */
export function vigenciaTexto(p: Pick<Promocion, 'desde' | 'hasta'>): string {
  const [, m1] = p.desde.split('-').map(Number); const [, m2, d2] = p.hasta.split('-').map(Number); const d1 = Number(p.desde.slice(8, 10))
  return m1 === m2 ? `del ${d1} al ${d2} de ${MESES[m2 - 1]}` : `del ${fechaPromo(p.desde)} al ${fechaPromo(p.hasta)}`
}
/** Etiqueta corta junto al precio: "Promo Allergan · hasta el 25 oct". */
export function etiquetaPromo(v: Pick<PromoVigente, 'nombre' | 'hasta'>): string { return `${v.nombre} · hasta el ${fechaPromo(v.hasta)}` }

const traducir = (m: string): string => {
  if (/NO_AUTORIZADO/.test(m)) return 'Solo Dirección o Facturación administran promociones.'
  if (/PROMO_INVALIDA: (.+)/.test(m)) return m.match(/PROMO_INVALIDA: ([^\n]+)/)?.[1] ?? 'Revisa los datos de la promoción.'
  if (/PROMO_INEXISTENTE/.test(m)) return 'Esa promoción ya no existe.'
  return m
}
export async function listarPromociones(todas = true): Promise<Resultado<Promocion[]>> {
  if (!hasSupabase) return { ok: true, data: [] }
  const { data, error } = await supabase.rpc('promociones_lista', { p_todas: todas })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: (data ?? []) as unknown as Promocion[] }
}
export async function guardarPromocion(d: PromoDatos): Promise<Resultado<Promocion>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('promocion_guardar', { p: d as never })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: data as unknown as Promocion }
}
export async function estadoPromocion(id: string, activa: boolean): Promise<Resultado<Promocion>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('promocion_estado', { p_id: id, p_activa: activa })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: data as unknown as Promocion }
}
// PROMO-4 · difusión por correo y por el chat del sistema (Dirección o Facturación).
export async function previaDifusion(id: string): Promise<Resultado<PreviaDifusion>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('promocion_difusion_previa', { p_id: id })
  if (error) return { ok: false, error: traducir(error.message) }
  return { ok: true, data: data as unknown as PreviaDifusion }
}
export async function difundirPromocion(id: string, canales: CanalDifusion[]): Promise<Resultado<ResultadoDifusion>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('promocion_difundir', { p_id: id, p_canales: canales })
  if (error) return { ok: false, error: /PROMO_NO_VIGENTE/.test(error.message) ? 'Solo se manda una promoción activa y que no haya terminado.' : /CANAL_INVALIDO/.test(error.message) ? 'Elige correo, chat o los dos.' : traducir(error.message) }
  return { ok: true, data: data as unknown as ResultadoDifusion }
}
export async function eliminarPromocion(id: string): Promise<Resultado<{ eliminada: boolean; nombre: string }>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  const { data, error } = await supabase.rpc('promocion_eliminar', { p_id: id })
  if (error) return { ok: false, error: /PROMO_CON_ENVIOS/.test(error.message) ? 'Esta promoción ya se mandó a doctores: pásala a pausada en lugar de borrarla.' : /PROMO_CON_VENTAS/.test(error.message) ? 'Esta promoción ya tiene pedidos: pásala a pausada en lugar de borrarla.' : traducir(error.message) }
  return { ok: true, data: data as unknown as { eliminada: boolean; nombre: string } }
}
// PROMO-6 · tarjeta de una promoción para el chat del doctor (null si ya no está vigente o no aplica a su lista).
export const MARCA_PROMO = /^\[promo:([0-9a-f-]{36})\]\n?/
export async function promoTarjeta(id: string): Promise<DatosPromoDifusion | null> {
  if (!hasSupabase) return null
  const { data, error } = await supabase.rpc('promo_tarjeta', { p_id: id })
  if (error || !data) return null
  return data as unknown as DatosPromoDifusion
}
export async function promosVigentes(): Promise<PromoVigente[]> {
  if (!hasSupabase) return []
  const { data, error } = await supabase.rpc('promos_vigentes')
  if (error) return []
  return (data ?? []) as unknown as PromoVigente[]
}

// ── Lector de texto pegado ─────────────────────────────────────────────────────────────────────────
export interface PromoLeida { nombre: string | null; desde: string | null; hasta: string | null; lineas: Array<{ texto: string; min_qty: number; precio: number }>; sinLeer: string[] }
const num = (s: string) => Number(s.replace(/[$,\s]/g, ''))
const RE_PRECIO = /\$?\s*([\d]{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*$/
const RE_RANGO = /^(\d+)\s*(?:a|-|–)\s*(\d+)\s*(?:pzas?|piezas?|pz)?\b/i
const RE_DESDE = /^(\d+)\s*(?:pzas?|piezas?|pz)\b(?:\s*(?:o\s*m[aá]s|\+))?|^(\d+)\s*(?:o\s*m[aá]s|\+)\s*(?:pzas?|piezas?|pz)?\b/i
/** Lee un texto como el que mandan los proveedores. Devuelve lo que entendió y lo que no; la persona revisa y guarda. */
export function leerPromoTexto(texto: string, anio = Number(hoyNegocio().slice(0, 4))): PromoLeida {   // año del calendario del negocio
  const out: PromoLeida = { nombre: null, desde: null, hasta: null, lineas: [], sinLeer: [] }
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let producto: string | null = null
  const vistas = new Set<string>()
  for (const l of lineas) {
    const clave = l.toLowerCase()
    if (vistas.has(clave)) continue   // el texto suele venir pegado dos veces: cada renglón cuenta una vez
    vistas.add(clave)
    // vigencia: "del 16 al 25 de octubre" / "16 al 25 oct" / "16/10 al 25/10"
    const v = /del?\s*(\d{1,2})(?:\s*de\s*([a-záé]+))?\s*(?:al|a|-|–|hasta(?: el)?)\s*(\d{1,2})\s*(?:de\s*)?([a-záé]+)?/i.exec(l)
    if (v && /\bal\b|hasta|–|-/.test(l) && !/\$/.test(l)) {
      const mes = (nombre?: string) => { if (!nombre) return null; const i = MESES_LARGO.findIndex((m) => m.startsWith(nombre.toLowerCase().slice(0, 3))); return i >= 0 ? i + 1 : null }
      const m2 = mes(v[4]) ?? mes(v[2]); const m1 = mes(v[2]) ?? m2
      if (m1 && m2) { out.desde = `${anio}-${String(m1).padStart(2, '0')}-${v[1].padStart(2, '0')}`; out.hasta = `${anio}-${String(m2).padStart(2, '0')}-${v[3].padStart(2, '0')}`; continue }
    }
    if (/^precios?\s+de\s+promo|^promo/i.test(l) && !/\$/.test(l)) { out.nombre = l.replace(/^precios?\s+de\s+/i, '').replace(/^promo(ci[oó]n)?\s*/i, 'Promo ').trim(); continue }
    const pm = RE_PRECIO.exec(l)
    if (!pm) { if (l.length <= 60) { producto = l; continue } out.sinLeer.push(l); continue }
    const precio = num(pm[1]); const resto = l.slice(0, pm.index).replace(/[:\-–]\s*$/, '').trim()
    let min = 1; let nombreProd = resto
    const r = RE_RANGO.exec(resto); const d = RE_DESDE.exec(resto)
    if (r) { min = Number(r[1]); nombreProd = resto.slice(r[0].length).trim() }
    else if (d) { min = Number(d[1] ?? d[2]); nombreProd = resto.slice(d[0].length).trim() }
    else if (/^1\s*(pza|pieza)/i.test(resto)) { min = 1; nombreProd = '' }
    const texto = nombreProd || producto || ''
    if (!texto) { out.sinLeer.push(l); continue }
    if (nombreProd && !r && !d) producto = nombreProd   // los escalones que sigan ("10 o más $700") son de este producto
    out.lineas.push({ texto, min_qty: min, precio })
  }
  if (!out.nombre && out.lineas.length) out.nombre = 'Promoción'
  return out
}
