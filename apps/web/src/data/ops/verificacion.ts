// VERIF-VENDEDOR · cliente de la verificación hecha por quien atiende al doctor (Dirección, su vendedor de cartera o
// el que tiene su conversación). La base decide quién puede; la evidencia llega por enlaces temporales de la Edge.
import { hasSupabase, supabase } from '../../lib/supabase'

export interface DoctorPendiente {
  profile_id: string; nombre: string | null; email: string | null; telefono: string | null; organizacion: string | null
  cedula: string | null; verificado: boolean; estado: string; sep: { decision?: string; reasons?: string[] } | null; identidad: string | null; evidencia: Record<string, string>
}
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>

export function mensajeVerificacion(m: string | undefined): string {
  const t = m ?? ''
  if (/NOTA_REQUERIDA/.test(t)) return 'Escribe por qué se rechaza.'
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'No atiendes a este doctor: solo su vendedor o Dirección lo verifican.'
  if (/DOCTOR_INEXISTENTE/.test(t)) return 'No encontramos a este doctor.'
  return 'No se pudo completar. Intenta de nuevo.'
}

/** El doctor PENDIENTE dueño de una conversación, si quien mira puede verificarlo; null en cualquier otro caso. */
export async function pendienteDeConversacion(conv: string, rpc: Rpc = rpcPorDefecto): Promise<DoctorPendiente | null> {
  if (!hasSupabase && rpc === rpcPorDefecto) return null
  try { const { data, error } = await rpc('doctor_verificacion_de_conversacion', { p_conv: conv }); return error || !data ? null : data as DoctorPendiente } catch { return null }
}
export async function verificarDoctor(profile: string, aprobar: boolean, nota: string | null, rpc: Rpc = rpcPorDefecto): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
  try {
    const { error } = await rpc('doctor_verificar', { p_profile: profile, p_aprobar: aprobar, p_nota: nota })
    return error ? { ok: false, mensaje: mensajeVerificacion(error.message) } : { ok: true }
  } catch { return { ok: false, mensaje: 'No hay conexión con el servidor. Intenta de nuevo.' } }
}
export async function evidenciaDoctor(profile: string, invocar: Invocar = invocarPorDefecto): Promise<Record<string, string>> {
  if (!hasSupabase && invocar === invocarPorDefecto) return {}
  try { const { data, error } = await invocar('verificacion', { body: { action: 'evidencia', profile_id: profile } }); return error || !data ? {} : ((data as { evidencia?: Record<string, string> }).evidencia ?? {}) } catch { return {} }
}
