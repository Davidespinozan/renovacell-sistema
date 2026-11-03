// Edge Function (se despliega con --no-verify-jwt; valida el JWT ella misma): COTIZAR EL ENVÍO AL VENDER (2 nov 2026).
// Alberto: "los vendedores son los que tienen que elegir la paquetería del cliente y el cliente también… y al usuario tiene
// que salirle exactamente cuándo llega su pedido". El doctor (en el portal) o su vendedor (pedido, caja, chat) ve los
// servicios de la paquetería con su FECHA EXACTA de entrega antes de comprar; la cotización queda guardada (2 h) y el
// pedido la usa (_entrega_servicio). El paquete es un estimado por piezas (Configuración → Regla de entrega); la guía
// real la genera Almacén con el servicio elegido.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { buildRateRequest, dhlBaseUrl, fetchConTimeout, parseRates, TIMEOUT_COTIZACION_MS, type NeutralShipper } from '../shipping/dhl.ts'
import { paqueteEstimado, serviciosCotizados } from '../_shared/cotizarEnvio.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  const esDoctor = tieneRol(q.quien, ['doctor'])
  if (!esDoctor && !tieneRol(q.quien, ['admin', 'pos', 'warehouse'])) return json(403, { error: 'no_autorizado' })
  if (esDoctor && !q.quien.verified) return json(403, { error: 'no_verificado', message: 'Tu cuenta aún no está verificada.' })
  const b = await req.json().catch(() => ({})) as { cp?: string; ciudad?: string; estado?: string; piezas?: number }
  const cp = t(b.cp).replace(/\D/g, ''); const piezas = Math.round(Number(b.piezas))
  if (!/^\d{5}$/.test(cp)) return json(400, { error: 'cp', message: 'El código postal debe tener 5 dígitos.' })
  if (!(piezas >= 1 && piezas <= 500)) return json(400, { error: 'piezas' })

  const user = Deno.env.get('DHL_API_USERNAME'), pass = Deno.env.get('DHL_API_PASSWORD'), account = Deno.env.get('DHL_ACCOUNT_NUMBER')
  if (!user || !pass || !account) return json(501, { error: 'sin_paqueteria', message: 'La cotización en línea no está disponible: se usa la regla de entrega.' })
  const [{ data: cfg }, { data: c }] = await Promise.all([
    admin.from('entrega_config').select('paquete_kg_base, paquete_kg_pieza, paquete_largo_cm, paquete_ancho_cm, paquete_alto_cm').eq('id', 1).maybeSingle(),
    admin.from('company_settings').select('shipping_name, shipping_address, shipping_cp, shipping_city, shipping_state, shipping_country, shipping_phone, shipping_email').eq('id', 'default').maybeSingle(),
  ])
  const shipper: NeutralShipper = { name: t(c?.shipping_name), addressLine1: t(c?.shipping_address), cp: t(c?.shipping_cp), city: t(c?.shipping_city), state: t(c?.shipping_state), country: t(c?.shipping_country) || 'MX', phone: t(c?.shipping_phone), email: t(c?.shipping_email) }
  if (!shipper.cp || !shipper.city) return json(422, { error: 'origen', message: 'Falta el origen de envíos en Configuración.' })
  const pkg = paqueteEstimado(piezas, cfg ?? {})
  try {
    const r = await fetchConTimeout(fetch, `${dhlBaseUrl(Deno.env.get('DHL_API_ENV'))}/rates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(`${user}:${pass}`) },
      body: JSON.stringify(buildRateRequest(shipper, { name: 'Cliente', address: { line1: 'Por confirmar', cp, city: t(b.ciudad) || 'Mexico', state: t(b.estado) } }, pkg, account)),
    }, Math.min(TIMEOUT_COTIZACION_MS, 15_000))
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return json(502, { error: 'paqueteria', message: 'DHL no respondió la cotización: se usa la regla de entrega.' })
    const servicios = serviciosCotizados(parseRates(data))
    if (!servicios.length) return json(502, { error: 'sin_servicios', message: 'DHL no ofrece servicio a ese código postal: se usa la regla de entrega.' })
    const { data: ins, error } = await admin.from('entrega_cotizaciones').insert({ proveedor: 'dhl', cp, piezas, paquete: pkg, servicios, creado_por: q.quien.uid }).select('id, expira_at').single()
    if (error || !ins) return json(500, { error: 'guardar' })
    return json(200, { cotizacion_id: ins.id, expira_at: ins.expira_at, proveedor: 'dhl', servicios })
  } catch {
    return json(504, { error: 'tiempo', message: 'DHL tardó demasiado: se usa la regla de entrega.' })
  }
}))
