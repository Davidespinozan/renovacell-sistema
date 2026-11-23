// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): DESTINO EN EL MAPA (23 nov 2026).
// La pantalla «Choferes en ruta» la llama cuando una entrega viva no tiene pin de destino. Busca hasta 5 direcciones
// en OpenStreetMap (Nominatim: 1 consulta por segundo, sin Google) y guarda un pin APROXIMADO por dirección
// (destino_pin_osm). Un pin aprendido de una entrega real nunca se pisa. Solo Dirección y Almacén.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { consultasOsm, elegirPunto, type DireccionPedido } from '../_shared/geocodificar.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const UA = 'RenovacellSistema/1.0 (mapa de entregas)'

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin', 'warehouse', 'packing'])) return json(403, { error: 'no_autorizado' })

  const { data: pendientes, error } = await admin.rpc('destinos_sin_pin', { p_limite: 5 })
  if (error) return json(500, { error: 'leer' })
  const lista = (Array.isArray(pendientes) ? pendientes : []) as Array<DireccionPedido & { clave: string }>
  let n = 0, primera = true
  for (const d of lista) {
    let hecho = false
    for (const c of consultasOsm(d)) {
      if (!primera) await espera(1100)   // política de Nominatim: máximo 1 consulta por segundo
      primera = false
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams(c.params)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) })
        if (!r.ok) continue
        const p = elegirPunto(await r.json(), c, d)
        if (!p) continue
        await admin.rpc('destino_pin_osm', { p_clave: d.clave, p_lat: p.lat, p_lng: p.lng, p_precision: c.precision })
        hecho = true; n++; break
      } catch { /* sigue con la búsqueda más gruesa */ }
    }
    if (!hecho) await admin.rpc('destino_pin_osm', { p_clave: d.clave, p_lat: null, p_lng: null, p_precision: 'sin_resultado' })
  }
  return json(200, { buscadas: lista.length, ubicadas: n })
}))
