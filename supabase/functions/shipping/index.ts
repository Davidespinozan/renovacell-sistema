// Edge Function: PAQUETERÍA (cotizar tarifas + generar guía) contra un agregador real
// (Envia.com / Skydropx), con las llaves PROTEGIDAS en el servidor (nunca en el navegador).
//
// SEAM: si no hay `SHIPPING_API_KEY` responde 501 → el cliente cae al mock (demo sigue).
// Se activa metiendo secrets, sin tocar código:
//   SHIPPING_API_KEY     token del agregador
//   SHIPPING_API_URL     base (default https://api.envia.com)
//   SHIPPING_RATE_PATH   ruta de cotización (default /ship/rate/)
//   SHIPPING_LABEL_PATH  ruta de guía (default /ship/generate/)
// El mapeo de respuesta es tolerante (busca los campos comunes); ajústalo al contrato
// exacto de tu proveedor si difiere. Ver README.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
// deno-lint-ignore no-explicit-any
function pick(o: any, candidates: string[]): string | undefined {
  if (!o || typeof o !== 'object') return undefined
  for (const k of Object.keys(o)) {
    const nk = norm(k)
    if (candidates.some((c) => nk === norm(c) || nk.includes(norm(c))) && (typeof o[k] === 'string' || typeof o[k] === 'number')) return String(o[k])
  }
  return undefined
}

interface Addr { name: string; street: string; city: string; state: string; zip: string; phone: string }
interface Parcel { weightKg: number; lengthCm: number; widthCm: number; heightCm: number }

// Mapea al formato del agregador (forma tipo Envia.com; también sirve de base para otros).
// deno-lint-ignore no-explicit-any
function buildShipment(origin: Addr, destination: Addr, parcel: Parcel, carrier?: string): any {
  const addr = (a: Addr) => ({ name: a.name, street: a.street, city: a.city, state: a.state, country: 'MX', postalCode: a.zip, phone: a.phone })
  return {
    origin: addr(origin),
    destination: addr(destination),
    packages: [{
      content: 'Producto', amount: 1, type: 'box', weight: parcel.weightKg, weightUnit: 'KG',
      lengthUnit: 'CM', dimensions: { length: parcel.lengthCm, width: parcel.widthCm, height: parcel.heightCm },
    }],
    shipment: carrier ? { carrier, type: 1 } : { type: 1 },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })

  const key = Deno.env.get('SHIPPING_API_KEY')
  if (!key) return json(501, { error: 'not_configured', message: 'Paquetería no habilitada. Agrega SHIPPING_API_KEY.' })
  const base = (Deno.env.get('SHIPPING_API_URL') ?? 'https://api.envia.com').replace(/\/$/, '')
  const ratePath = Deno.env.get('SHIPPING_RATE_PATH') ?? '/ship/rate/'
  const labelPath = Deno.env.get('SHIPPING_LABEL_PATH') ?? '/ship/generate/'
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }

  // deno-lint-ignore no-explicit-any
  let p: any
  try { p = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const action = p.action

  try {
    if (action === 'quote') {
      const body = buildShipment(p.origin, p.destination, p.parcel, undefined)
      const r = await fetch(base + ratePath, { method: 'POST', headers, body: JSON.stringify(body) })
      const data = await r.json().catch(() => ({}))
      // deno-lint-ignore no-explicit-any
      const rows: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
      const rates = rows.map((x, i) => ({
        id: String(pick(x, ['rateid', 'id']) ?? `${pick(x, ['carrier']) ?? 'rate'}-${i}`),
        carrier: pick(x, ['carrier', 'carriername', 'provider']) ?? 'Paquetería',
        service: pick(x, ['servicedescription', 'service', 'servicename']) ?? '—',
        amount: Math.round(Number(pick(x, ['totalprice', 'amount', 'price', 'total']) ?? 0)),
        currency: (pick(x, ['currency']) ?? 'MXN').toUpperCase(),
        etaDays: Number(pick(x, ['deliveryestimate', 'deliverydays', 'days', 'etadays']) ?? 0) || 3,
      })).filter((rt) => rt.amount > 0)
      if (rates.length === 0) return json(502, { error: 'El agregador no devolvió tarifas.' })
      return json(200, { rates })
    }

    if (action === 'label') {
      const rate = p.rate ?? {}
      const body = buildShipment(p.origin, p.destination, p.parcel, rate.carrier)
      const r = await fetch(base + labelPath, { method: 'POST', headers, body: JSON.stringify(body) })
      const data = await r.json().catch(() => ({}))
      const d = data?.data?.[0] ?? data?.data ?? data ?? {}
      const etaDays = Number(rate.etaDays ?? pick(d, ['deliveryestimate', 'deliverydays']) ?? 3)
      return json(200, {
        label: {
          carrier: rate.carrier ?? pick(d, ['carrier']) ?? 'Paquetería',
          service: rate.service ?? pick(d, ['service', 'servicedescription']) ?? '—',
          tracking: pick(d, ['trackingnumber', 'tracking', 'trackingnum']) ?? '',
          labelUrl: pick(d, ['label', 'labelurl', 'url', 'trackurl']) ?? '',
          amount: Math.round(Number(rate.amount ?? pick(d, ['totalprice', 'amount']) ?? 0)),
          etaDays,
          estimatedDeliveryAt: new Date(Date.now() + etaDays * 86_400_000).toISOString(),
        },
      })
    }

    return json(400, { error: 'action inválida (usa quote | label).' })
  } catch (e) {
    return json(502, { error: `Error con el agregador: ${(e as Error).message}` })
  }
})
