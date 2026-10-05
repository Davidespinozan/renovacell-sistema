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

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

interface Reclamado {
  id: string; claim_token: string; idempotency_key: string; plantilla: string
  to_address: string; to_name: string | null; payload: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  // Antes que nada: ¿hay proveedor? Si no, no se toca ni un mensaje.
  const cfg = leerConfig((k) => Deno.env.get(k))
  if (!cfg) {
    return json(501, { error: 'not_configured',
      message: 'El correo transaccional no está activado. Configura MAIL_PROVIDER, MAIL_API_KEY y MAIL_FROM.' })
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  // Cliente con el JWT de quien invoca: los comandos deciden si puede.
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json(401, { error: 'No autenticado.' })

  const { data: lote, error: eRec } = await caller.rpc('comm_reclamar', { p_limite: 20 })
  if (eRec) {
    // W6-A1: la base niega a una cuenta suspendida (CUENTA_SUSPENDIDA) con el JWT del
    // llamante; aquí no hace falta llave de servicio para saberlo.
    if (/CUENTA_SUSPENDIDA/.test(eRec.message)) return json(403, { error: 'CUENTA_SUSPENDIDA', message: 'Tu acceso fue suspendido por Dirección.' })
    const negado = /NO_AUTORIZADO/.test(eRec.message)
    return json(negado ? 403 : 500, { error: negado ? 'Solo Dirección envía mensajes al cliente.' : 'No se pudo leer la cola de mensajes.' })
  }

  const cuenta = { enviado: 0, fallido: 0, incierto: 0 }
  for (const m of (lote ?? []) as Reclamado[]) {
    let resultado: 'enviado' | 'fallido' | 'incierto' = 'incierto'
    let messageId: string | null = null
    let error: string | null = null
    try {
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
    if (!eRes) cuenta[resultado] += 1
  }
  return json(200, { procesados: (lote ?? []).length, ...cuenta })
})
