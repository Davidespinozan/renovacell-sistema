// Edge Function: DESPACHO de la comunicación transaccional al cliente.
//
// Toma mensajes del buzón (`comm_outbox`), los envía por el proveedor de correo y asienta
// lo que el proveedor respondió. La autoridad vive en la base: esta función solo reclama
// y resuelve por los comandos `comm_reclamar` / `comm_resolver`, con el JWT de quien la
// invoca — si no es Dirección, la base se niega.
//
// FALLA CERRADO: sin MAIL_PROVIDER / MAIL_API_KEY / MAIL_FROM responde 501 SIN reclamar
// nada. Los mensajes se quedan `pendiente`, que es la verdad: nadie los ha enviado.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { enviarCorreo, leerConfig } from '../_shared/correo.ts'
import { renderizar } from '../_shared/plantillas.ts'
import { observador } from '../_shared/observa.ts'
import { conCors } from '../_shared/cors.ts'   // CC-0B.2 · lista blanca de orígenes (antes '*')

// W6-A3.3 · telemetría opcional (no-op sin SENTRY_DSN; nunca altera la respuesta).
const obs = observador('comm-dispatch')

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Comparación de tiempo constante (por hash) para el secreto de la tarea programada.
async function iguales(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false
  const h = async (t: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))
  const [x, y] = await Promise.all([h(a), h(b)])
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d === 0
}

interface Reclamado {
  id: string; claim_token: string; idempotency_key: string; plantilla: string
  to_address: string; to_name: string | null; payload: Record<string, unknown>
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  // Antes que nada: ¿hay proveedor? Si no, no se toca ni un mensaje.
  const cfg = leerConfig((k) => Deno.env.get(k))
  if (!cfg) {
    return json(501, { error: 'not_configured',
      message: 'El correo transaccional no está activado. Configura MAIL_PROVIDER, MAIL_API_KEY y MAIL_FROM.' })
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  // CORREOS-AUTO (165) · la tarea de cada minuto llega con su secreto: entonces actúa el servidor (service_role, que la
  // base autoriza en _comm_autorizar). Si no, cliente con el JWT de quien invoca: los comandos deciden si puede.
  const secretoCron = (Deno.env.get('CORREOS_CRON_SECRET') ?? '').trim()
  const esCron = secretoCron.length >= 32 && await iguales(req.headers.get('x-cron-secret') ?? '', secretoCron)
  const caller = esCron
    ? createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    : createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  if (!esCron) {
    const { data: who } = await caller.auth.getUser()
    if (!who?.user) return json(401, { error: 'No autenticado.' })
  }

  const { data: lote, error: eRec } = await caller.rpc('comm_reclamar', { p_limite: 20 })
  if (eRec) {
    // W6-A1: la base niega a una cuenta suspendida (CUENTA_SUSPENDIDA) con el JWT del
    // llamante; aquí no hace falta llave de servicio para saberlo.
    if (/CUENTA_SUSPENDIDA/.test(eRec.message)) return json(403, { error: 'CUENTA_SUSPENDIDA', message: 'Tu acceso fue suspendido por Dirección.' })
    const negado = /NO_AUTORIZADO/.test(eRec.message)
    if (!negado) obs('reclamar', 'internal_error', { error: eRec })
    return json(negado ? 403 : 500, { error: negado ? 'Solo Dirección envía mensajes al cliente.' : 'No se pudo leer la cola de mensajes.' })
  }

  const cuenta = { enviado: 0, fallido: 0, incierto: 0 }
  for (const m of (lote ?? []) as Reclamado[]) {
    let resultado: 'enviado' | 'fallido' | 'incierto' = 'incierto'
    let messageId: string | null = null
    let error: string | null = null
    try {
      // Un aviso "va en camino" cuya guía se anuló NUNCA sale (el número ya no sirve; la guía nueva trae su aviso).
      const rastreo = m.plantilla === 'pedido_enviado' ? String((m.payload ?? {}).rastreo ?? '').trim() : ''
      if (rastreo) {
        const { data: anulada } = await caller.from('shipments').select('id').eq('provider_meta->anulada->>tracking', rastreo).limit(1).maybeSingle()
        if (anulada) throw new Error(`GUIA_ANULADA: la guía ${rastreo} de este aviso se anuló, no reenviar`)
      }
      const r = renderizar(m.plantilla, m.payload ?? {}, m.to_name)
      const env = await enviarCorreo(cfg, {
        para: m.to_address, asunto: r.asunto, texto: r.texto, html: r.html,
        llaveIdempotencia: m.idempotency_key,
      })
      resultado = env.resultado
      if (env.resultado === 'enviado') messageId = env.id
      else error = env.error
    } catch (e) {
      // Una plantilla que no se pudo armar es un fallo definitivo de ESTE mensaje:
      // no se envió nada y reintentar daría lo mismo.
      resultado = 'fallido'
      error = String((e as Error)?.message ?? 'no se pudo preparar el mensaje').slice(0, 200)
    }
    const { error: eRes } = await caller.rpc('comm_resolver', {
      p_id: m.id, p_claim: m.claim_token, p_resultado: resultado,
      p_provider: cfg.proveedor, p_message_id: messageId, p_error: error,
    })
    // Si no se pudo asentar el resultado, el mensaje queda `enviando`: la base lo
    // tratará como incierto y lo reintentará con la MISMA llave de idempotencia.
    if (eRes) obs('resolver', 'internal_error', { error: eRes })
    else if (resultado === 'incierto') obs('enviar', 'unknown', { code: 'incierto', mensaje: 'el proveedor de correo no confirmó el envío' })
    if (!eRes) cuenta[resultado] += 1
  }
  return json(200, { procesados: (lote ?? []).length, ...cuenta })
}))
