// Puente al ASISTENTE IA real (Edge Function `assistant` → modelo Claude). Devuelve el
// texto de respuesta, o `null` si no hay backend, no está configurado (501) o falla —
// en cuyo caso el hook usa el motor local (mock). No expone la llave: vive en el servidor.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { AssistantContext } from './engine'

export async function askLLM(text: string, ctx: AssistantContext, mode: 'doctor' | 'landing' = 'doctor'): Promise<string | null> {
  if (!hasSupabase) return null
  try {
    // CC-0A: el catálogo lo carga el servidor desde products_safe/catalog_public; el cliente
    // ya no manda productos (y si los mandara, el servidor los ignora). `ctx` se conserva
    // para el motor local.
    void ctx
    const { data, error } = await supabase.functions.invoke('assistant', { body: { mode, text } })
    if (error || !data?.text) return null
    return String(data.text)
  } catch {
    return null
  }
}
