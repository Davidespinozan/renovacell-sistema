// ENLACE-VENDEDOR (mig 20270211) · enlaces del chat: uno por vendedor (renovacell.mx/contacto/roberto-ibarra) y uno por
// cliente para recomendar (renovacell.mx/contacto/lourdes-k7m2). Quien lo recibe ve con qué asesor va a hablar y quién lo
// recomendó; quién atiende lo decide la base (gana la cartera, luego el vendedor del enlace).
import { hasSupabase, supabase } from '../../lib/supabase'
import { leerTokenVisitante, abrirVisitante } from './visitante'
import { urlEnlaceContacto } from './contactoEnlace'

export interface EnlacePublico {
  valido: boolean; tipo?: 'vendedor' | 'referido'
  asesor?: { nombre: string; primer_nombre: string | null; foto: string | null } | null
  recomienda?: string | null
}
export interface Cifras { visitas: number; contactos: number; cuentas: number }
export interface MiEnlace { tipo: 'vendedor' | 'referido'; codigo: string; cifras: Cifras; asesor?: { nombre: string; primer_nombre: string | null } | null }
export interface EnlaceEquipo { seller: string; nombre: string; codigo: string; cifras: Cifras }
export interface OrigenConversacion { tipo: 'vendedor' | 'referido'; codigo: string; vendedor: string | null; es_tuyo: boolean; recomienda: string | null }

const CODIGO = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** /contacto/<código> → el código (o null en /contacto a secas o con algo que no es un código). */
export function codigoDeRuta(pathname: string): string | null {
  const m = /^\/contacto\/([^/?#]+)\/?$/i.exec(pathname)
  const c = m ? decodeURIComponent(m[1]).toLowerCase() : null
  return c && c.length <= 40 && CODIGO.test(c) ? c : null
}
/** La dirección que se comparte: el dominio oficial en producción. */
export const urlDeEnlace = (codigo: string, base = urlEnlaceContacto()) => `${base.replace(/\/$/, '')}/${codigo}`

type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>
const comoPublico = (d: unknown): EnlacePublico => (d && typeof d === 'object' && (d as EnlacePublico).valido === true ? d as EnlacePublico : { valido: false })

/** Lo público de un enlace (sin sesión). Nunca lanza. */
export async function verEnlace(codigo: string, invocar: Invocar = invocarPorDefecto): Promise<EnlacePublico> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { valido: false }
  try { const { data, error } = await invocar('visitor', { body: { action: 'ver_enlace', codigo } }); return error ? { valido: false } : comoPublico(data) } catch { return { valido: false } }
}
/** El visitante llegó por este enlace: queda registrado (gana el primero). Abre su sesión de visitante si hace falta. */
export async function aplicarEnlace(codigo: string, invocar: Invocar = invocarPorDefecto): Promise<EnlacePublico> {
  if (!hasSupabase && invocar === invocarPorDefecto) return { valido: false }
  try {
    if (!leerTokenVisitante()) await abrirVisitante({ invocar: invocar === invocarPorDefecto ? undefined : invocar })
    const token = leerTokenVisitante()
    if (!token) return verEnlace(codigo, invocar)
    const { data, error } = await invocar('visitor', { body: { action: 'enlace', token, codigo } })
    return error ? verEnlace(codigo, invocar) : comoPublico(data)
  } catch { return { valido: false } }
}

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
export async function miEnlace(rpc: Rpc = rpcPorDefecto): Promise<MiEnlace | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return null
  try { const { data, error } = await rpc('cc_mi_enlace'); return error || !data ? null : data as MiEnlace } catch { return null }
}
export async function enlacesEquipo(rpc: Rpc = rpcPorDefecto): Promise<EnlaceEquipo[]> {
  if (!hasSupabase && rpc === rpcPorDefecto) return []
  try { const { data, error } = await rpc('cc_enlaces_equipo'); return error || !Array.isArray(data) ? [] : data as EnlaceEquipo[] } catch { return [] }
}
export async function origenConversacion(conv: string, rpc: Rpc = rpcPorDefecto): Promise<OrigenConversacion | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return null
  try { const { data, error } = await rpc('cc_origen_conversacion', { p_conv: conv }); return error || !data ? null : data as OrigenConversacion } catch { return null }
}

/** Lo que se manda junto al enlace. Personal, en primera persona: así lo reenvía la gente. */
export function textoCompartir(e: { tipo: 'vendedor' | 'referido'; asesor?: { primer_nombre: string | null } | null }, url: string, nombreVendedor?: string | null): string {
  if (e.tipo === 'vendedor') return `Hola, soy ${nombreVendedor ?? 'tu asesor'}, asesor de Renovacell · Tecnologías Antiedad. Te atiendo directo por aquí, sin descargar nada: ${url}`
  const asesor = e.asesor?.primer_nombre
  return `Te recomiendo Renovacell, es con quien compro. ${asesor ? `Escríbele a ${asesor}, mi asesor` : 'Escríbeles'}, te atiende directo por aquí, sin descargar nada: ${url}`
}

/** Compartir con la hoja nativa del teléfono; si no hay, se copia. Devuelve qué pasó. */
export async function compartir(texto: string, url: string): Promise<'compartido' | 'copiado' | 'cancelado'> {
  const nav = typeof navigator !== 'undefined' ? navigator as Navigator & { share?: (d: ShareData) => Promise<void> } : null
  if (nav?.share) {
    try { await nav.share({ title: 'Renovacell · Tecnologías Antiedad', text: texto.replace(url, '').trim(), url }); return 'compartido' }
    catch (e) { if ((e as Error)?.name === 'AbortError') return 'cancelado' }
  }
  try { await navigator.clipboard.writeText(texto); return 'copiado' } catch { window.prompt('Copia y comparte:', texto); return 'copiado' }
}
