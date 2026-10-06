// CC-3 · Cliente de administración del conocimiento comercial (solo Dirección). Todo pasa por
// RPC: la base decide quién puede, deriva el nivel de la sección, exige fuente en T1/T2, bloquea
// T2 salvo habilitación explícita y revisa claims. El cliente nunca escribe tablas ni manda
// `nivel`, `estado` ni `audiencia` por encima de lo que la base acepta.
// Los nombres de función aún no están en database.types.ts (se regeneran tras aplicar la
// migración, como en W6-A1); por eso el wrapper tipado local.
import { hasSupabase, supabase } from '../../lib/supabase'

export type Nivel = 'T0' | 'T1' | 'T2'
export type EstadoConocimiento = 'draft' | 'approved' | 'retired'
export const SECCIONES: { key: string; label: string; nivel: Nivel }[] = [
  { key: 'resumen', label: 'Resumen', nivel: 'T0' }, { key: 'presentacion', label: 'Presentación', nivel: 'T0' }, { key: 'diferenciadores', label: 'Diferenciadores', nivel: 'T0' },
  { key: 'caracteristicas', label: 'Características', nivel: 'T0' }, { key: 'uso_comercial', label: 'Uso comercial', nivel: 'T0' }, { key: 'faq', label: 'Preguntas frecuentes', nivel: 'T0' },
  { key: 'marca', label: 'Marca', nivel: 'T0' }, { key: 'fabricante', label: 'Fabricante', nivel: 'T0' },
  { key: 'composicion', label: 'Composición', nivel: 'T1' }, { key: 'tecnologia', label: 'Tecnología', nivel: 'T1' }, { key: 'certificaciones', label: 'Certificaciones', nivel: 'T1' },
  { key: 'ficha_tecnica', label: 'Ficha técnica', nivel: 'T1' }, { key: 'concentracion', label: 'Concentración', nivel: 'T1' }, { key: 'volumen', label: 'Volumen', nivel: 'T1' },
  { key: 'indicaciones', label: 'Indicaciones', nivel: 'T2' }, { key: 'contraindicaciones', label: 'Contraindicaciones', nivel: 'T2' }, { key: 'protocolo', label: 'Protocolo', nivel: 'T2' }, { key: 'advertencias', label: 'Advertencias', nivel: 'T2' },
]
export const TIPOS_FUENTE = ['renovacell', 'fabricante', 'distribuidor', 'ficha_tecnica', 'catalogo_oficial', 'regulatorio', 'carga_manual'] as const

export interface Cobertura { product_id: string; nombre: string; familia: string | null; categoria: string | null; es_padre: boolean; aprobadas: string[]; borradores: string[]; faltantes_t0: string[] | null; faltantes_t1: string[] | null }
export interface Version { id: string; seccion: string; nivel: Nivel; version: number; rev: number; estado: EstadoConocimiento; audiencia: string; contenido: string; datos: unknown; source_id: string | null; fuente: string | null; importado_de: string | null; created_at: string; approved_at: string | null; retired_at: string | null; retired_reason: string | null }
export interface Fuente { id: string; tipo: string; referencia: string; documento_url: string | null; version: string | null; captured_at: string; notas: string | null }
export interface Claim { tipo: 'prohibido' | 'requiere_aprobacion' | 'disclaimer'; patron: string; motivo: string }
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export function mensajeError(m: string | undefined): string {
  const t = m ?? ''
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'Solo Dirección administra el conocimiento.'
  if (/T2_BLOQUEADO/.test(t)) return 'El contenido clínico requiere habilitar T2 y confirmar explícitamente.'
  if (/FUENTE_REQUERIDA/.test(t)) return 'Este nivel exige una fuente documentada antes de aprobarse.'
  if (/CLAIM_PROHIBIDO/.test(t)) return 'El texto contiene afirmaciones no permitidas (cura, garantiza, 100 %…).'
  if (/CLAIM_REQUIERE_T2/.test(t)) return 'El texto contiene lenguaje clínico: va en una sección clínica (T2).'
  if (/REV_DESACTUALIZADA/.test(t)) return 'El borrador cambió en otra sesión. Recarga y vuelve a intentar.'
  if (/DRAFT_EXISTE/.test(t)) return 'Ya hay un borrador de esa sección; edítalo.'
  if (/CONOCIMIENTO_INMUTABLE/.test(t)) return 'Una versión aprobada o retirada no se edita; crea una nueva versión.'
  if (/ALIAS_AMBIGUO/.test(t)) return 'Ese término ya apunta a otro producto.'
  if (/MOTIVO_REQUERIDO/.test(t)) return 'Indica el motivo.'
  if (/ck_cpk_contenido/.test(t)) return 'El contenido debe tener entre 1 y 4000 caracteres.'
  return t || 'No se pudo completar la operación.'
}

export class ClienteConocimiento {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Resultado<T>> {
    if (!hasSupabase) return { ok: false, error: 'Sin conexión con Supabase.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      if (error) return { ok: false, error: mensajeError(error.message) }
      return { ok: true, data: data as T }
    } catch (e) { return { ok: false, error: mensajeError((e as Error)?.message) } }
  }
  cobertura() { return this.llamar<Cobertura[]>('cc_cobertura') }
  listar(product_id: string) { return this.llamar<Version[]>('cc_conocimiento_listar', { p_product: product_id }) }
  fuentes() { return this.llamar<Fuente[]>('cc_fuentes_listar') }
  registrarFuente(f: { tipo: string; referencia: string; documento_url?: string | null; version?: string | null; notas?: string | null }) {
    return this.llamar<string>('cc_fuente_registrar', { p_tipo: f.tipo, p_referencia: f.referencia, p_documento_url: f.documento_url ?? null, p_version: f.version ?? null, p_notas: f.notas ?? null })
  }
  guardar(p: { product_id: string; seccion: string; contenido: string; source_id?: string | null; id?: string | null; rev?: number | null }) {
    return this.llamar<{ id: string; version: number; rev: number; estado: EstadoConocimiento; nivel: Nivel; claims: Claim[] }>('cc_conocimiento_guardar', {
      p_product: p.product_id, p_seccion: p.seccion, p_contenido: p.contenido, p_datos: null, p_source: p.source_id ?? null, p_audiencia: null, p_id: p.id ?? null, p_rev: p.rev ?? null,
    })
  }
  aprobar(id: string, confirmarClinico = false) { return this.llamar<{ id: string; estado: string; retirada?: string | null; claims?: Claim[] }>('cc_conocimiento_aprobar', { p_id: id, p_confirmar_clinico: confirmarClinico }) }
  retirar(id: string, motivo: string) { return this.llamar<{ id: string; estado: string }>('cc_conocimiento_retirar', { p_id: id, p_motivo: motivo }) }
  restaurar(id: string) { return this.llamar<{ id: string; version: number }>('cc_conocimiento_restaurar', { p_id: id }) }
  importar() { return this.llamar<Record<string, number>>('cc_importar_conocimiento_existente') }
  configurarT2(habilitado: boolean) { return this.llamar<boolean>('cc_config_t2', { p_habilitado: habilitado }) }
  ficha(product_id: string) { return this.llamar<Record<string, unknown> | null>('cc_ficha_producto', { p_product: product_id, p_audiencia: null }) }
}

export const conocimiento = new ClienteConocimiento()
