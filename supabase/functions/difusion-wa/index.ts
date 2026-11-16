// Edge Function (se despliega con --no-verify-jwt; solo la tarea de cada minuto con x-cron-secret): DIFUSIONES POR
// WHATSAPP. La base decide a quién, cuándo y cuántos (_difwa_reclamar: horario, límite diario, pausa, plantilla aprobada,
// bajas); aquí solo se manda la plantilla y se asienta. Un rechazo del canal (retener) pausa la salida 30 min y lo que
// queda del lote vuelve a la cola sin intentarse: la lista nunca se quema.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { configWA } from '../_shared/whatsapp.ts'
import { clasificarEnvio, resultadoDeExcepcion, type ResultadoEnvio } from '../_shared/salidaClase.ts'
import { asientoWhatsApp } from '../_shared/invitacionMasiva.ts'
import { cuerpoDifusionWA } from '../_shared/difusionWA.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function iguales(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const h = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

type Lote = Array<{ envio_id: number; destino: string; plantilla: string; idioma: string; parametros: string[] }>

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const secretoCron = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
  if (secretoCron.length < 32 || !(await iguales(req.headers.get('x-cron-secret') ?? '', secretoCron))) return json(401, { error: 'no_autorizado' })
  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  if (p?.action !== 'enviar') return json(400, { error: 'Acción no reconocida.' })
  const cfg = configWA((k) => Deno.env.get(k))
  if (!cfg) return json(200, { sin_configurar: true })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const r = { enviados: 0, fallidos: 0, inciertos: 0, retenidos: 0 }
  const { data, error } = await admin.rpc('_difwa_reclamar', { p_lote: 20 })
  if (error) { console.error('difusion-wa reclamar', error.code ?? '', (error.message ?? '').slice(0, 120)); return json(500, { error: 'reclamar' }) }
  const lote = (Array.isArray(data) ? data : []) as Lote
  const asentar = async (id: number, a: ReturnType<typeof asientoWhatsApp>) => {
    const k = a.resultado === 'enviado' ? 'enviados' : a.resultado === 'fallido' ? 'fallidos' : a.resultado === 'incierto' ? 'inciertos' : 'retenidos'
    r[k]++
    await admin.rpc('_difwa_resolver', { p_envio: id, p_resultado: a.resultado, p_proveedor_id: a.resultado === 'enviado' ? a.id : null, p_error: a.resultado === 'enviado' ? null : a.error }).then(() => {}, () => {})
  }
  for (let i = 0; i < lote.length; i++) {
    const e = lote[i]
    let res: ResultadoEnvio
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000)
      const resp = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.phoneId}/messages`, {
        method: 'POST', signal: ctl.signal, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpoDifusionWA(e.destino, e.plantilla, e.idioma, e.parametros ?? [])),
      })
      clearTimeout(t)
      const cuerpo = await resp.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null
      res = clasificarEnvio(resp.status, cuerpo, cuerpo?.messages?.[0]?.id)
    } catch (err) { res = resultadoDeExcepcion(err) }
    const a = asientoWhatsApp(res)
    await asentar(e.envio_id, a)
    if (a.resultado === 'retener') { for (const resto of lote.slice(i + 1)) await asentar(resto.envio_id, { resultado: 'retener', error: a.error }); break }
  }
  return json(200, r)
}))
