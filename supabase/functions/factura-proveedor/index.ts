// Edge: LEER FACTURA DE PROVEEDOR EN PDF (26 nov 2026). Dirección o Facturación sube el PDF al bucket privado «compras» y
// esta función se lo da a la IA para leer proveedor, folio y renglones. NO guarda nada: la pantalla muestra lo leído para
// revisarlo y corregirlo antes de registrar la compra (el XML se lee en el navegador, sin IA).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { HERRAMIENTA_FACTURA, INSTRUCCION_FACTURA, normalizarFactura } from '../_shared/facturaProveedor.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const MODELO = 'claude-haiku-4-5-20251001'   // lee PDF, sin pensamiento: admite la herramienta forzada (JSON estructurado)

function base64(bytes: Uint8Array): string {
  let s = ''; const paso = 0x8000
  for (let i = 0; i < bytes.length; i += paso) s += String.fromCharCode(...bytes.subarray(i, i + paso))
  return btoa(s)
}

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'no_autorizado', message: 'Solo Dirección o Facturación registran compras.' })

  const { path } = await req.json().catch(() => ({})) as { path?: string }
  if (!path || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(path) || !path.startsWith(q.quien.uid)) return json(400, { error: 'archivo', message: 'Archivo inválido.' })
  const key = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (!key) return json(501, { error: 'ia_no_configurada', message: 'La lectura automática no está disponible; captura los renglones a mano.' })

  const { data: archivo, error } = await admin.storage.from('compras').download(path)
  if (error || !archivo) return json(404, { error: 'archivo', message: 'No se encontró el PDF subido.' })
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (bytes.length > 10 * 1024 * 1024) return json(413, { error: 'grande', message: 'El PDF pesa más de 10 MB.' })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(55_000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODELO, max_tokens: 4000, tools: [HERRAMIENTA_FACTURA], tool_choice: { type: 'tool', name: HERRAMIENTA_FACTURA.name },
        messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64(bytes) } }, { type: 'text', text: INSTRUCCION_FACTURA }] }] }),
    })
    const d = await r.json().catch(() => null) as { content?: Array<{ type: string; input?: unknown }> } | null
    if (!r.ok || !d) return json(502, { error: 'ia', message: 'No se pudo leer el PDF automáticamente; captura los renglones a mano.' })
    const uso = d.content?.find((b) => b.type === 'tool_use')
    if (!uso) return json(422, { error: 'ia', message: 'No se reconocieron datos de factura en ese PDF; captura los renglones a mano.' })
    return json(200, { ok: true, factura: normalizarFactura(uso.input) })
  } catch {
    return json(504, { error: 'ia', message: 'La lectura tardó demasiado; intenta de nuevo o captura a mano.' })
  }
}))
