// HERRAMIENTAS DEL VENDEDOR · bloque B (mig 20270215): clínica o doctor y la especialidad, en la FICHA del cliente. La
// edita su vendedor, el jefe de ventas o Dirección (lo decide la base); el catálogo de especialidades lo amplía Dirección.
import { hasSupabase, supabase } from '../../lib/supabase'

export type TipoCliente = 'doctor' | 'clinica'
export interface Especialidad { clave: string; nombre: string; orden: number; activa: boolean }
export interface PerfilComercial { tipo: TipoCliente | null; especialidad: string | null; especialidad_nombre: string | null; especialidad_otra: string | null; especialidad_portal: string | null; puede_editar: boolean }
export interface FilaClasificar { customer_id: string; nombre: string; ciudad: string | null; tipo: TipoCliente | null; especialidad: string | null; especialidad_otra: string | null }
export interface MisClientesPerfil { total: number; clasificados: number; doctores: number; clinicas: number; encontrados: number; clientes: FilaClasificar[] }
export type Res<T> = { ok: true; data: T } | { ok: false; mensaje: string }

export const ETIQUETA_TIPO: Record<TipoCliente, string> = { doctor: 'Doctor', clinica: 'Clínica' }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>
const mensaje = (m?: string) => /NO_AUTORIZADO/.test(m ?? '') ? 'No puedes clasificar a este cliente.'
  : /especialidad_otra/.test(m ?? '') ? 'Escribe cuál es la especialidad.' : /DATO_INVALIDO/.test(m ?? '') ? 'Revisa la clasificación.' : 'No se pudo guardar. Intenta de nuevo.'

export class ClientePerfilComercial {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Res<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    try { const { data, error } = await this.rpc(fn, args); return error ? { ok: false, mensaje: mensaje(error.message) } : { ok: true, data: data as T } } catch { return { ok: false, mensaje: 'No hay conexión con el servidor.' } }
  }
  perfil(customer: string) { return this.llamar<PerfilComercial>('cliente_perfil_comercial', { p_customer: customer }) }
  guardar(customer: string, tipo: TipoCliente | null, especialidad: string | null, otra: string | null) {
    return this.llamar<PerfilComercial>('cliente_perfil_comercial_guardar', { p_customer: customer, p_tipo: tipo, p_especialidad: especialidad, p_otra: otra })
  }
  misClientes(q: string, soloSin: boolean, limite = 50, offset = 0) { return this.llamar<MisClientesPerfil>('mis_clientes_perfil', { p_q: q || null, p_solo_sin: soloSin, p_limite: limite, p_offset: offset }) }
  agregarEspecialidad(nombre: string) { return this.llamar<{ clave: string; nombre: string }>('especialidad_guardar', { p_nombre: nombre }) }
  async especialidades(): Promise<Especialidad[]> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return []
    // Tabla nueva (20270215): aún no está en los tipos generados; la consulta es la misma.
    type Q = { select: (c: string) => Q; eq: (k: string, v: unknown) => Q; order: (k: string) => Q } & PromiseLike<{ data: unknown }>
    const sb = supabase as unknown as { from: (t: string) => Q }
    try { const { data } = await sb.from('especialidades').select('clave, nombre, orden, activa').eq('activa', true).order('orden').order('nombre'); return (data ?? []) as Especialidad[] } catch { return [] }
  }
}
export const perfilComercial = new ClientePerfilComercial()
