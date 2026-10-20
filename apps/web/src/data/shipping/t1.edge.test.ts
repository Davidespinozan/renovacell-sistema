// T1 v2.0 · guardas de FUENTE sobre la Edge `shipping` (sin red): X-Api-Key solo en t1.ts, host por ambiente, nada de Keycloak,
// identidad del servicio y precio confirmados antes de comprar, idempotencia (claim/desconocido/finalize), PDF fuera de
// metadatos, token fuera del cliente, 409 de T1 sin reintento, DHL intacto.
import { describe, it, expect } from 'vitest'
import edge from '../../../../../supabase/functions/shipping/index.ts?raw'
import t1 from '../../../../../supabase/functions/shipping/t1.ts?raw'

const sinComentarios = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n')
const c = sinComentarios(edge)
const MARCA_DHL = "if (action === 'rate' || action === 'create_shipment' || action === 'track') {\n    const user = Deno.env.get('DHL_API_USERNAME')"
const bloqueT1 = c.slice(c.indexOf("if (s(p.provider) === 't1') {"), c.indexOf(MARCA_DHL))
const bloqueDhl = c.slice(c.indexOf(MARCA_DHL))

describe('T1 v2.0 · fuente de la Edge', () => {
  it('autenticación: X-Api-Key + shop_id en t1.ts; ninguna ruta Keycloak/usuario/contraseña queda viva; host solo del registro', () => {
    const t = sinComentarios(t1)
    expect(t).toMatch(/'X-Api-Key': cfg\.apiKey, shop_id: cfg\.shopId/)
    for (const viejo of ['T1_AUTH_URL', 'T1_CLIENT_SECRET', 'T1_USERNAME', 'T1_PASSWORD', 'T1_API_URL', 'grant_type', 'openid-connect', 'Bearer']) { expect(t, viejo).not.toContain(viejo); expect(bloqueT1, viejo).not.toContain(viejo) }
    expect(t).toMatch(/HOSTS_T1.*test: 'https:\/\/sandbox\.t1api\.com', production: null/)
    expect(bloqueT1).toMatch(/t1Config\(Deno\.env\.get\)/)
    expect(bloqueT1).not.toMatch(/p\.(ambiente|env|host|base|url)\b/)
    expect(bloqueT1).toMatch(/urlT1\(cfg, RUTAS_T1\.cotizar\)/); expect(bloqueT1).toMatch(/urlT1\(cfg, RUTAS_T1\.guia\)/)
  })
  it('la llave y el PDF no se registran: ningún obs()/json() lleva cabeceras ni cfg.apiKey; provider_meta no lleva file/base64; el token no sale al navegador', () => {
    for (const m of bloqueT1.match(/obs\([^\n]*\)/g) ?? []) expect(m).not.toMatch(/\bH\b|apiKey|cabeceras|labelBase64|\.file\b/)
    for (const m of bloqueT1.match(/json\(\d+, [^\n]*\)/g) ?? []) expect(m).not.toMatch(/\bH\b|apiKey|cabeceras|labelBase64/)
    const meta = bloqueT1.match(/provider_meta: \{[^\n]*\}/)![0]
    expect(meta).not.toMatch(/labelBase64|file|base64/); expect(meta).toMatch(/ambiente/); expect(meta).toMatch(/order_number: g\.orderNumber/); expect(meta).toMatch(/guide_link: g\.labelUrl/)
    expect(bloqueT1).toMatch(/\.map\(\(\{ token: _t, detalle, \.\.\.r \}\)/)
  })
  it('identidad del servicio y precio: re-cotiza, exige el mismo serviceCode y el mismo total que vio el operador; si cambia → 409 precio_cambio y el intento se cierra', () => {
    expect(bloqueT1).toMatch(/const montoVisto = Number\(p\.rate\?\.amount\)/)
    expect(bloqueT1).toMatch(/q\.lectura\.tarifas\.find\(\(x\) => x\.serviceCode === serviceCode\)/)
    expect(bloqueT1).toMatch(/Math\.abs\(serverRate\.amount - montoVisto\) > 0\.005/)
    expect(bloqueT1).toMatch(/await failAttempt\(admin, attemptId, `precio_cambio[^\n]*\n\s*return json\(409, \{ error: 'precio_cambio'/)
    expect(bloqueT1).toMatch(/buildGuideT1\(serverRate\.token, orderRef, cfg\.shopId, origen, destino, shipper\.name\)/)   // el token fresco del MISMO servicio; business_id = shop_id
    expect(bloqueT1).toMatch(/datosOrigenT1\(shipper\)/)   // origen = companyShipper (misma fuente que DHL), por campos estructurados
    expect(c).toMatch(/shipping_street,shipping_ext_number,shipping_int_number,shipping_colonia,shipping_references'\)/)   // la 183 se lee en companyShipper
    expect(sinComentarios(t1)).not.toMatch(/partirDireccionOrigen|split\(','\)/)   // sin heurísticas de división del origen
    expect(bloqueT1).not.toMatch(/T1_ORIGEN_COLONIA|origenColonia/); expect(sinComentarios(t1)).not.toMatch(/T1_ORIGEN_COLONIA/)
    expect(bloqueT1).not.toMatch(/\.select\('[^']*\b(direccion|razon_social|rfc)\b/)   // nunca el domicilio fiscal
    expect(bloqueT1).not.toMatch(/serverRate\.amount = /)   // nunca se sustituye el precio por otro
  })
  it('idempotencia: guía existente = idempotente sin red; claim durable; timeout/2xx sin guía = desconocido sin reintento; finalize atómico; 409 de T1 = intento fallido, no reintento', () => {
    expect(bloqueT1).toMatch(/idempotent: true, label: await labelPayload/)
    expect(bloqueT1).toMatch(/status: 'pending' \}\)\s*\.select\('id'\)\.single\(\)/)
    expect(bloqueT1).toMatch(/markUnknown\(admin, attemptId, `create timeout\/network/)
    expect(bloqueT1).toMatch(/markUnknown\(admin, attemptId, `T1 2xx \$\{lg\.motivo\}`\)/)
    expect(bloqueT1).toMatch(/finalize_shipment/); expect(bloqueT1).toMatch(/unknown_requires_reconciliation/)
    expect(bloqueT1).toMatch(/shipResp\.status === 409 \? 409 : 502/)
    expect(bloqueT1).not.toMatch(/for \(let intento[^\n]*\n[^\n]*RUTAS_T1\.guia/)   // la guía nunca dentro de un bucle de reintentos
    const guia = bloqueT1.slice(bloqueT1.indexOf('RUTAS_T1.guia'))
    expect(guia).not.toMatch(/RUTAS_T1\.guia[\s\S]*RUTAS_T1\.guia/)   // una sola llamada a create-guide por intento
  })
  it('DHL intacto: su bloque no menciona T1 y conserva su autenticación Basic y sus rutas', () => {
    expect(bloqueDhl).not.toMatch(/t1Config|X-Api-Key|RUTAS_T1|precio_cambio/)
    expect(bloqueDhl).toMatch(/DHL_API_USERNAME/); expect(bloqueDhl).toMatch(/'Basic ' \+ btoa/); expect(bloqueDhl).toMatch(/\$\{base\}\/rates/); expect(bloqueDhl).toMatch(/\$\{base\}\/shipments/)
  })
})
