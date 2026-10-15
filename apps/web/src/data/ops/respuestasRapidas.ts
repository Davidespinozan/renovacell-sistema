// CHAT PRO · respuestas rápidas del personal. Las de la empresa (profile_id null) las edita Dirección; cada vendedor
// tiene además las suyas. Se leen con RLS y se escriben solo con cc_respuesta_guardar / cc_respuesta_borrar (migración 161).
import { hasSupabase, supabase } from '../../lib/supabase'
import { primerNombre } from '../../lib/nombres'

export interface RespuestaRapida { id: string; profile_id: string | null; titulo: string; texto: string; orden: number }
export type Resultado = { ok: true } | { ok: false; mensaje: string }

// Sin backend (vista previa local): las mismas de la empresa que siembra la migración.
export const RESPUESTAS_BASE: RespuestaRapida[] = [
  ['Saludo', 'Hola {nombre}, gracias por escribir a Renovacell. ¿En qué te puedo ayudar?'],
  ['Verificación', 'Para ver precios y hacer pedidos necesitamos verificar tu cédula profesional. Toca «Verificar mi cuenta» arriba en este chat; toma un par de minutos.'],
  ['Fotos del INE', '¿Me compartes por aquí una foto del frente y otra del reverso de tu INE? Con eso termino tu verificación.'],
  ['Ya verificado', 'Listo {nombre}, tu cuenta ya está verificada: ya puedes ver precios y hacer tus pedidos.'],
  ['Envío', 'Enviamos a todo México. En cuanto se genere tu guía te comparto el número para que le des seguimiento.'],
  ['Un momento', 'Dame un momento, lo reviso y te confirmo.'],
  ['Despedida', 'Gracias {nombre}, quedo al pendiente por aquí para lo que necesites.'],
].map(([titulo, texto], i) => ({ id: `base-${i}`, profile_id: null, titulo, texto, orden: (i + 1) * 10 }))

/** Cambia {nombre} por el primer nombre del cliente; sin nombre, lo quita sin dejar huecos raros. */
export function aplicarNombre(texto: string, nombre: string | null | undefined): string {
  const n = primerNombre(nombre ?? null)
  if (n) return texto.replace(/\{nombre\}/g, n)
  return texto.replace(/\s*\{nombre\}/g, '').replace(/^,\s*/, '').replace(/\s+,/g, ',')
}

/** Filtra por lo que va después de "/" (título o texto, sin acentos ni mayúsculas). */
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export function filtrar(lista: RespuestaRapida[], q: string): RespuestaRapida[] {
  const k = plano(q.trim())
  if (!k) return lista
  return lista.filter((r) => plano(r.titulo).includes(k) || plano(r.texto).includes(k))
}

// Los comandos aún no están en los tipos generados: llamada sin tipar, como en salud.ts.
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)

export const respuestasRapidas = {
  async listar(): Promise<RespuestaRapida[]> {
    if (!hasSupabase) return RESPUESTAS_BASE
    const { data, error } = await supabase.from('cc_respuestas_rapidas').select('id, profile_id, titulo, texto, orden').order('orden').order('created_at')
    if (error) return []
    // Primero las propias (las usa más quien las escribió), luego las de la empresa.
    const filas = (data ?? []) as RespuestaRapida[]
    return [...filas.filter((r) => r.profile_id), ...filas.filter((r) => !r.profile_id)]
  },
  async guardar(r: { id?: string; titulo: string; texto: string; empresa: boolean }): Promise<Resultado> {
    if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    const titulo = r.titulo.trim(); const texto = r.texto.trim()
    if (titulo.length < 2 || texto.length < 2) return { ok: false, mensaje: 'Escribe un título y un texto.' }
    const { error } = await rpc('cc_respuesta_guardar', { p_id: r.id ?? null, p_titulo: titulo, p_texto: texto, p_empresa: r.empresa })
    if (!error) return { ok: true }
    if (/DATOS_INVALIDOS/.test(error.message ?? '')) return { ok: false, mensaje: 'El título va de 2 a 40 caracteres y el texto hasta 1000.' }
    return { ok: false, mensaje: /NO_AUTORIZADO/.test(error.message ?? '') ? 'Solo Dirección cambia las respuestas de la empresa.' : 'No se pudo guardar.' }
  },
  async borrar(id: string): Promise<Resultado> {
    if (!hasSupabase) return { ok: false, mensaje: 'Requiere conexión con el servidor.' }
    const { error } = await rpc('cc_respuesta_borrar', { p_id: id })
    return error ? { ok: false, mensaje: /NO_AUTORIZADO/.test(error.message ?? '') ? 'Solo Dirección borra las respuestas de la empresa.' : 'No se pudo borrar.' } : { ok: true }
  },
}
export type ClienteRespuestas = typeof respuestasRapidas
