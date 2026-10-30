// HERRAMIENTAS DEL VENDEDOR · bloque D (mig 20270217): listas de difusión del vendedor y envíos por correo (buzón, con
// baja) y por el chat del portal (tarjeta). Vendedor: su cartera; jefe de ventas y Dirección: todos. La base decide.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { TipoCliente } from './perfilComercial'

export interface Lista { id: string; nombre: string; es_mia: boolean; vendedor: string | null; clientes: number }
export interface ClienteLista { customer_id: string; nombre: string; ciudad: string | null; tipo: TipoCliente | null; especialidad: string | null; con_correo: boolean; con_cuenta: boolean; en_lista: boolean }
export type Audiencia = { tipo: 'cartera' } | { tipo: 'lista'; etiqueta_id: string } | { tipo: 'filtro'; tipo_cliente: TipoCliente | null; especialidad: string | null }
export interface Previa { total: number; con_correo: number; dados_de_baja: number; sin_correo: number; con_cuenta: number }
export interface Contenido { titulo: string; texto: string; enlace: string; imagen: string }
export interface Resultado { id: string; destinatarios: number; correo: number; chat: number; sin_correo: number; dados_de_baja: number }
export interface Difusion { id: string; titulo: string; texto: string; enlace: string | null; imagen_url: string | null; audiencia: Audiencia; canales: string[]; destinatarios: number; correo: number; chat: number; sin_correo: number; dados_de_baja: number; creada: string; es_mia: boolean; vendedor: string | null; lista: string | null }
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string }

const MENSAJES: Array<[RegExp, string]> = [
  [/LIMITE_DIARIO/, 'Ya mandaste 5 difusiones hoy. Podrás mandar más mañana.'], [/AUDIENCIA_VACIA/, 'No hay clientes en esa audiencia.'],
  [/LISTA_REPETIDA/, 'Ya tienes una lista con ese nombre.'], [/ck_dif_enlace/, 'El enlace debe empezar con https://'], [/ck_dif_titulo/, 'El título debe tener de 3 a 120 caracteres.'],
  [/ck_dif_texto/, 'Escribe el mensaje (hasta 2,000 caracteres).'], [/DATO_INVALIDO:canales/, 'Elige al menos un canal.'], [/SIN_CORREO/, 'Tu cuenta no tiene correo para la prueba.'],
  [/PRUEBAS_EXCEDIDAS/, 'Ya mandaste varias pruebas; espera unos minutos.'], [/NO_AUTORIZADO/, 'No tienes permiso para esto.'],
]
const mensaje = (m?: string) => MENSAJES.find(([re]) => re.test(m ?? ''))?.[1] ?? 'No se pudo completar. Intenta de nuevo.'

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export class ClienteDifusiones {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    try { const { data, error } = await this.rpc(fn, args); return error ? { ok: false, mensaje: mensaje(error.message) } : { ok: true, data: data as T } } catch { return { ok: false, mensaje: 'No hay conexión con el servidor.' } }
  }
  listas() { return this.llamar<Lista[]>('mis_listas') }
  guardarLista(id: string | null, nombre: string) { return this.llamar<{ id: string; nombre: string }>('lista_guardar', { p_id: id, p_nombre: nombre }) }
  borrarLista(id: string) { return this.llamar<null>('lista_borrar', { p_id: id }) }
  cambiarClientes(id: string, clientes: string[], agregar: boolean) { return this.llamar<{ clientes: number }>('lista_clientes_cambiar', { p_id: id, p_clientes: clientes, p_agregar: agregar }) }
  agregarPorFiltro(id: string, tipo: TipoCliente | null, especialidad: string | null) { return this.llamar<{ clientes: number }>('lista_agregar_filtro', { p_id: id, p_tipo: tipo, p_especialidad: especialidad }) }
  buscarClientes(id: string | null, q: string, soloLista = false) { return this.llamar<ClienteLista[]>('lista_buscar_clientes', { p_id: id, p_q: q || null, p_solo_lista: soloLista, p_limite: 100 }) }
  previa(a: Audiencia) { return this.llamar<Previa>('difusion_previa', { p_audiencia: a }) }
  enviar(c: Contenido, a: Audiencia, canales: Array<'correo' | 'chat'>) {
    return this.llamar<Resultado>('difusion_enviar', { p_titulo: c.titulo.trim(), p_texto: c.texto.trim(), p_enlace: c.enlace.trim() || null, p_imagen: c.imagen.trim() || null, p_audiencia: a, p_canales: canales })
  }
  prueba(c: Contenido) { return this.llamar<{ para: string }>('difusion_prueba', { p_titulo: c.titulo.trim(), p_texto: c.texto.trim(), p_enlace: c.enlace.trim() || null, p_imagen: c.imagen.trim() || null }) }
  enviadas() { return this.llamar<Difusion[]>('mis_difusiones') }
}
export const difusiones = new ClienteDifusiones()

// ── Tarjeta en el chat del portal: "[difusion:<id>]\n<título>\n<texto>\n[enlace] url\n[imagen] url" ──
export const MARCA_DIFUSION = /^\[difusion:([0-9a-f-]{36})\]\n?/
export function leerDifusion(content: string): { titulo: string; texto: string; enlace: string | null; imagen: string | null } | null {
  if (!MARCA_DIFUSION.test(content)) return null
  const lineas = content.replace(MARCA_DIFUSION, '').split('\n')
  let enlace: string | null = null; let imagen: string | null = null
  const resto = lineas.filter((l) => {
    const e = /^\[enlace\] (https:\/\/\S+)$/.exec(l); if (e) { enlace = e[1]; return false }
    const i = /^\[imagen\] (https:\/\/\S+)$/.exec(l); if (i) { imagen = i[1]; return false }
    return true
  })
  return { titulo: resto[0] ?? '', texto: resto.slice(1).join('\n').trim(), enlace, imagen }
}
