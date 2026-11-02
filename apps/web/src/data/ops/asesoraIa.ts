// IA MEJOR QUE EL HUMANO (2 nov 2026) · Dirección: el modelo de la IA del portal, el examen (corridas por modelo, caso por
// caso con la Edge ia-examen) y la comparación IA vs equipo en conversaciones reales. Todo pasa por RPC ia_* (la base
// valida que sea Dirección); aquí solo se llama y se tipa.
import { supabase } from '../../lib/supabase'

export type Esfuerzo = 'low' | 'medium' | 'high'
export const MODELOS: Array<{ id: string; nombre: string; nota: string }> = [
  { id: 'claude-haiku-4-5-20251001', nombre: 'Claude Haiku 4.5', nota: 'el de siempre' },
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', nota: 'rápido y económico' },
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', nota: 'equilibrado' },
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', nota: 'el más capaz' },
]
export const nombreModelo = (id: string | null | undefined) => MODELOS.find((m) => m.id === id)?.nombre ?? (id || 'El de siempre (Haiku 4.5)')

export interface ConfigIA { modelo_portal: string | null; esfuerzo_portal: Esfuerzo; updated_at: string | null; modelos: string[] }
export interface Corrida {
  id: string; modelo: string; esfuerzo: Esfuerzo; nota: string | null; created_at: string; perfil: string | null
  casos: number; corridos: number; puntaje: number | null; aprobados: number; rechazos_validacion: number; errores: number
  latencia_p50: number | null; latencia_p90: number | null; costo_promedio_usd: number | null; por_categoria: Record<string, number> | null
}
export interface Juicio { puntaje: number; aprobado: boolean; cumple: string[]; falla: string[]; comentario: string }
export interface ResultadoCaso {
  caso_id: string; categoria: string; pregunta: string; historial: Array<{ actor: string; content: string }>; ideal: string | null
  respuesta: string | null; estado: string | null; motivo_validacion: string | null; herramientas: Array<{ herramienta: string }> | null
  latencia_ms: number | null; costo_usd: number | null; puntaje: number | null; aprobado: boolean | null; juicio: Juicio | null; error: string | null
}
export interface Metrica { n: number; mediana_seg: number | null; p90_seg: number | null; en_5_min: number | null }
export interface MetricaConv { n: number; con_pedido: number; conversion: number | null; ticket_promedio: number | null; pidieron_asesor: number }
export interface IaVsHumano { dias: number; respuestas: Partial<Record<'ia' | 'equipo', Metrica>>; conversaciones: Partial<Record<'ia' | 'equipo' | 'sin_respuesta', MetricaConv>>; muestra_suficiente: boolean }
export interface DoctorExamen { id: string; full_name: string | null; email: string | null }

type Res<T> = { ok: true; data: T } | { ok: false; error: string }
const rpc = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<Res<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never)
  if (error) return { ok: false, error: /NO_AUTORIZADO|insufficient/i.test(error.message) ? 'Solo Dirección puede hacer esto.' : /PERFIL_INVALIDO/.test(error.message) ? 'El examen se corre como un doctor verificado y activo.' : 'No se pudo completar. Intenta de nuevo.' }
  return { ok: true, data: data as T }
}

export const asesoraIa = {
  config: () => rpc<ConfigIA>('ia_config'),
  guardarConfig: (modelo: string | null, esfuerzo: Esfuerzo) => rpc<ConfigIA>('ia_config_guardar', { p_modelo: modelo ?? '', p_esfuerzo: esfuerzo }),
  corridas: () => rpc<Corrida[]>('ia_examen_corridas'),
  resultados: (corrida: string) => rpc<ResultadoCaso[]>('ia_examen_resultados', { p_corrida: corrida }),
  crearCorrida: (modelo: string, perfil: string, esfuerzo: Esfuerzo, casos: string[] | null, nota: string | null) =>
    rpc<string>('ia_examen_crear', { p_modelo: modelo, p_perfil: perfil, p_esfuerzo: esfuerzo, p_casos: casos, p_nota: nota }),
  vsHumano: (dias: number) => rpc<IaVsHumano>('ia_vs_humano', { p_dias: dias }),
  async correrCaso(corrida: string, caso: string): Promise<Res<{ puntaje: number | null }>> {
    const { data, error } = await supabase.functions.invoke('ia-examen', { body: { corrida_id: corrida, caso_id: caso } })
    if (error) return { ok: false, error: 'El caso no se pudo correr.' }
    return { ok: true, data: data as { puntaje: number | null } }
  },
  async doctores(q: string): Promise<Res<DoctorExamen[]>> {
    let s = supabase.from('profiles').select('id, full_name, email').eq('role_id', 'doctor').eq('verified', true).eq('active', true).order('full_name').limit(30)
    if (q.trim()) s = s.or(`full_name.ilike.%${q.trim().replace(/[%,()]/g, '')}%,email.ilike.%${q.trim().replace(/[%,()]/g, '')}%`)
    const { data, error } = await s
    return error ? { ok: false, error: 'No se pudo buscar.' } : { ok: true, data: (data ?? []) as DoctorExamen[] }
  },
}
export type ClienteAsesoraIa = typeof asesoraIa

/** Corre los casos de una corrida de a `paralelo` a la vez; avisa el avance. Un caso que falla no detiene a los demás. */
export async function correrCorrida(cliente: Pick<ClienteAsesoraIa, 'correrCaso'>, corrida: string, casos: string[], alAvanzar: (hechos: number, fallidos: number) => void, paralelo = 3): Promise<{ hechos: number; fallidos: number }> {
  let i = 0; let hechos = 0; let fallidos = 0
  const trabajador = async () => {
    while (i < casos.length) {
      const c = casos[i++]
      const r = await cliente.correrCaso(corrida, c)
      if (r.ok) hechos++; else fallidos++
      alAvanzar(hechos, fallidos)
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralelo, casos.length) }, trabajador))
  return { hechos, fallidos }
}
