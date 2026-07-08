// Puente al ASISTENTE IA real (Edge Function `assistant` → modelo Claude). Devuelve el
// texto de respuesta, o `null` si no hay backend, no está configurado (501) o falla —
// en cuyo caso el hook usa el motor local (mock). No expone la llave: vive en el servidor.
import { hasSupabase, supabase } from '../../lib/supabase'
import type { AssistantContext } from './engine'

export async function askLLM(text: string, ctx: AssistantContext, mode: 'doctor' | 'landing' = 'doctor'): Promise<string | null> {
  if (!hasSupabase) return null
  try {
    const products = ctx.products.map((p) => ({ name: p.name, line: p.line, category: p.category }))
    const { data, error } = await supabase.functions.invoke('assistant', { body: { mode, text, products } })
    if (error || !data?.text) return null
    return String(data.text)
  } catch {
    return null
  }
}
