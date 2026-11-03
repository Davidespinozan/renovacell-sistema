// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): LEER UN FLYER DE PROMOCIÓN (2 nov 2026).
// Dirección/Facturación sube la imagen; Claude la lee con el catálogo vendible a la vista y regresa nombre, vigencia,
// condiciones y renglones (producto, desde cuántas piezas, precio). No guarda nada: la pantalla lo pone en el
// formulario de siempre para revisarlo.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { leerRespuestaFlyer, MAX_IMAGEN_FLYER, MODELO_FLYER, peticionFlyer, TIPOS_IMAGEN } from '../_shared/promoFlyer.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin', 'billing', 'warehouse', 'pos'])) return json(403, { error: 'no_autorizado', message: 'Solo Dirección, Facturación, Almacén o Ventas crean promociones.' })   // REPARTO-TURNO (2 nov 2026)
  const key = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (!key) return json(501, { error: 'sin_ia', message: 'La lectura de flyers no está configurada.' })

  const b = await req.json().catch(() => ({})) as { imagen?: string; media_type?: string }
  const mt = String(b.media_type ?? '').toLowerCase()
  if (!(TIPOS_IMAGEN as readonly string[]).includes(mt)) return json(400, { error: 'tipo', message: 'Sube una imagen JPG, PNG o WebP.' })
  if (typeof b.imagen !== 'string' || !b.imagen || b.imagen.length > MAX_IMAGEN_FLYER) return json(400, { error: 'tamano', message: 'La imagen debe pesar menos de 3.5 MB.' })

  const { data: prods } = await admin.from('products').select('id, name').eq('active', true).order('name').limit(400)
  const catalogo = (prods ?? []).map((p: { id: string; name: string }) => ({ id: p.id, nombre: p.name }))
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mazatlan' })
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(peticionFlyer(b.imagen, mt, catalogo, hoy, Deno.env.get('PROMO_FLYER_MODEL')?.trim() || MODELO_FLYER)),
    })
    const body = await r.json().catch(() => null)
    if (!r.ok) {
      const det = String((body as { error?: { type?: string; message?: string } } | null)?.error?.message ?? '').slice(0, 300)
      console.error('[promo-flyer] anthropic', r.status, (body as { error?: { type?: string } } | null)?.error?.type ?? '', det)
      return json(502, { error: 'ia', status: r.status, detalle: det, message: r.status === 429 ? 'La IA está ocupada; intenta en un minuto.' : `No se pudo leer el flyer (${r.status}${det ? ': ' + det : ''}).` })
    }
    const leido = leerRespuestaFlyer(body, catalogo)
    return leido.ok ? json(200, leido.promo) : json(422, { error: 'lectura', message: leido.error })
  } catch {
    return json(504, { error: 'tiempo', message: 'La lectura tardó demasiado; intenta de nuevo.' })
  }
}))
