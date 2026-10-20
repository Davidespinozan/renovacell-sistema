// T1 Envíos · adaptador puro (supabase/functions/shipping/t1.ts): configuración (seam 501), armado de cotización y guía con el
// contrato documentado, lectura de tarifas (token se queda en el servidor), guía (PDF crudo o base64), rastreo y recolección.
import { describe, it, expect } from 'vitest'
import { t1Config, buildQuoteT1, parseQuoteT1, buildGuideT1, parseGuideT1, parseTrackingT1, buildPickupT1, parsePickupT1, partirNombre, partirCalle, t1ErrorMessage, t1Token, _olvidarTokenT1, T1_SECRETOS } from '../../../../../supabase/functions/shipping/t1'
import { resumenT1 } from '../../../../../supabase/functions/shipping/rastreo'

const SHIPPER = { name: 'Renovacell SA de CV', addressLine1: 'Blvd. Pedro Infante 2911', cp: '80100', city: 'Culiacán', state: 'Sinaloa', country: 'MX', phone: '667 164 7799', email: 'envios@renovacell.mx' }
const RECEIVER = { name: 'Dra. Ana María Ruiz Pérez', email: 'ana@clinica.mx', address: { line1: 'Av. Reforma 123 int. 4', colonia: 'Centro', cp: '06600', city: 'Ciudad de México', state: 'CDMX', refs: 'Edificio azul', phone: '(55) 1234-5678' } }
const PKG = { weightKg: 1.4, lengthCm: 30, widthCm: 20, heightCm: 15, pieces: 1 }
const env = (o: Record<string, string>) => (k: string) => o[k]
const FULL = { T1_API_URL: 'https://api.t1.test/', T1_AUTH_URL: 'https://keycloak.t1.test/token', T1_CLIENT_SECRET: 'sec', T1_USERNAME: 'u@x.mx', T1_PASSWORD: 'p', T1_SHOP_ID: '77' }

describe('T1 · configuración (seam)', () => {
  it('sin alguna llave indispensable → null (la Edge responde 501); con todas → base sin barra final y comercio_id = shop_id si no se da', () => {
    expect(t1Config(env({}))).toBeNull()
    for (const k of T1_SECRETOS) expect(t1Config(env({ ...FULL, [k]: '' }))).toBeNull()
    const c = t1Config(env(FULL))!
    expect(c.base).toBe('https://api.t1.test'); expect(c.clientId).toBe('t1envios'); expect(c.comercioId).toBe('77'); expect(c.shopId).toBe('77')
    expect(t1Config(env({ ...FULL, T1_COMERCIO_ID: 'c9' }))!.comercioId).toBe('c9')
  })
  it('token: pide con grant password y lo cachea hasta antes de que expire', async () => {
    _olvidarTokenT1()
    const llamadas: Array<{ url: string; body: string }> = []
    const fetchFalso = (async (url: string, init: RequestInit) => { llamadas.push({ url, body: String(init.body) }); return new Response(JSON.stringify({ access_token: 'tok1', expires_in: 1800 }), { status: 200 }) }) as unknown as typeof fetch
    const c = t1Config(env(FULL))!
    expect(await t1Token(c, fetchFalso, 1000)).toBe('tok1')
    expect(llamadas[0].url).toBe('https://keycloak.t1.test/token'); expect(llamadas[0].body).toContain('grant_type=password'); expect(llamadas[0].body).toContain('client_id=t1envios'); expect(llamadas[0].body).toContain('username=u%40x.mx')
    expect(await t1Token(c, fetchFalso, 1000 + 1700 * 1000)).toBe('tok1'); expect(llamadas).toHaveLength(1)   // sigue vigente
    expect(await t1Token(c, fetchFalso, 1000 + 1750 * 1000)).toBe('tok1'); expect(llamadas).toHaveLength(2)   // renovó (margen de 60 s)
    const fetchMalo = (async () => new Response(JSON.stringify({ error_description: 'Invalid user credentials' }), { status: 401 })) as unknown as typeof fetch
    _olvidarTokenT1()
    await expect(t1Token(c, fetchMalo, 1)).rejects.toThrow(/credenciales \(401: Invalid user credentials\)/)
  })
})

describe('T1 · datos', () => {
  it('parte nombre y calle como exige T1', () => {
    expect(partirNombre('Dra. Ana María Ruiz Pérez')).toEqual({ nombre: 'Ana María', apellidos: 'Ruiz Pérez' })
    expect(partirNombre('Carlos López')).toEqual({ nombre: 'Carlos', apellidos: 'López' })
    expect(partirNombre('Renovacell')).toEqual({ nombre: 'Renovacell', apellidos: 'Renovacell' })
    expect(partirCalle('Blvd. Pedro Infante 2911')).toEqual({ calle: 'Blvd. Pedro Infante', numero: '2911' })
    expect(partirCalle('Av. Reforma 123 int. 4')).toEqual({ calle: 'Av. Reforma', numero: '123 int. 4' })
    expect(partirCalle('Calle sin número')).toEqual({ calle: 'Calle sin número', numero: 'S/N' })
  })
  it('cotización: C.P., medidas enteras hacia arriba, paquete tipo 2, sin seguro', () => {
    expect(buildQuoteT1(SHIPPER, RECEIVER, PKG, '77')).toEqual({ codigo_postal_origen: '80100', codigo_postal_destino: '06600', peso: 2, largo: 30, ancho: 20, alto: 15, dias_embarque: 1, seguro: 0, valor_paquete: 0, tipo_paquete: 2, comercio_id: '77', paquetes: 1, generar_recoleccion: false })
  })
  it('tarifas: una por paquetería y servicio, ordenadas por precio, con el token aparte y nombres bonitos', () => {
    const data = { success: true, result: [
      { id: 1, clave: 'FEDEX', cotizacion: { success: true, servicios: { EXPRESSDOMESTIC: { costo_total: 210.5, dias_entrega: 2, moneda: 'MXN', token: 'tk-fx' }, GROUND: { costo_total: 140, dias_entrega: 4, moneda: 'MXN', token: 'tk-fg' } } } },
      { id: 2, clave: 'DHL', cotizacion: { success: true, servicios: { EXPRESSDOMESTIC: { costo_total: 199, dias_entrega: 1, moneda: 'MXN', token: 'tk-dh' }, MALO: { costo_total: 0, token: 'x' } } } },
      { id: 3, clave: 'UPS', cotizacion: { success: false } },
    ] }
    const r = parseQuoteT1(data)
    expect(r.map((x) => [x.serviceCode, x.carrier, x.service, x.amount, x.etaDays, x.token])).toEqual([
      ['FEDEX|GROUND', 'FedEx', 'Terrestre', 140, 4, 'tk-fg'], ['DHL|EXPRESSDOMESTIC', 'DHL', 'Express', 199, 1, 'tk-dh'], ['FEDEX|EXPRESSDOMESTIC', 'FedEx', 'Express', 210.5, 2, 'tk-fx'],
    ])
    expect(parseQuoteT1({ success: false })).toEqual([])
  })
  it('guía: todos los campos obligatorios de origen y destino, token_quote y contenido ≤ 25', () => {
    const g = buildGuideT1(SHIPPER, RECEIVER, 'tk-fg', 'S100002', '77', 'Las Quintas')
    expect(g).toMatchObject({ token_quote: 'tk-fg', origen_guia: 't1envios', comercio_id: '77', generar_recoleccion: false, tiene_notificacion: false, contenido: 'Pedido S100002',
      nombre_origen: 'Renovacell SA', apellidos_origen: 'de CV', calle_origen: 'Blvd. Pedro Infante', numero_origen: '2911', colonia_origen: 'Las Quintas', municipio_origen: 'Culiacán', estado_origen: 'Sinaloa', telefono_origen: '6671647799', email_origen: 'envios@renovacell.mx',
      nombre_destino: 'Ana María', apellidos_destino: 'Ruiz Pérez', calle_destino: 'Av. Reforma', numero_destino: '123 int. 4', colonia_destino: 'Centro', municipio_destino: 'Ciudad de México', estado_destino: 'CDMX', telefono_destino: '5512345678', referencias_destino: 'Edificio azul', email_destino: 'ana@clinica.mx' })
    expect(buildGuideT1(SHIPPER, { ...RECEIVER, address: { ...RECEIVER.address, colonia: '', refs: '' } }, 't', 'X', '77')).toMatchObject({ colonia_origen: 'Centro', colonia_destino: 'Centro', referencias_destino: 'Sin referencias' })
    for (const [k, v] of Object.entries(g)) if (typeof v === 'string' && /_(origen|destino)$/.test(k)) expect(v, k).not.toBe('')
  })
  it('respuesta de guía: PDF crudo → base64, base64 tal cual, link, paquetería y costo', () => {
    const crudo = parseGuideT1({ success: true, detail: { guia: '8617898483', file: '%PDF-1.4 hola', link_guia: 'https://t1.test/g.pdf', paqueteria: 'FEDEX', costo: 104.48, num_orden: '3532' } })
    expect(crudo.tracking).toBe('8617898483'); expect(atob(crudo.labelBase64!)).toBe('%PDF-1.4 hola'); expect(crudo.labelUrl).toBe('https://t1.test/g.pdf'); expect(crudo.carrier).toBe('FedEx'); expect(crudo.cost).toBe(104.48); expect(crudo.numOrden).toBe('3532')
    const b64 = 'JVBERi0xLjQK'.repeat(12)
    expect(parseGuideT1({ detail: { guia: 'X1', file: `data:application/pdf;base64,${b64}` } }).labelBase64).toBe(b64)
    expect(parseGuideT1({ success: false, message: 'No existe una cotización con el token proporcionado' })).toMatchObject({ tracking: '', labelBase64: null, labelUrl: null })
    expect(t1ErrorMessage(400, { success: false, message: 'No existe una cotización con el token proporcionado' })).toBe('T1: No existe una cotización con el token proporcionado')
    expect(t1ErrorMessage(401, {})).toMatch(/credenciales/)
  })
  it('rastreo: familia externa → estado neutral; entregado trae quién recibió y fecha', () => {
    const d = { success: true, detail: { codigo: 'DL', descripcion: 'Entregado en recepción', familia_interna: 'Entregado', familia_externa: 'Delivered', guia: 'G1', fecha: '2026-10-21 13:05:00', recibe: 'Ana Ruiz' } }
    const r = resumenT1(d)
    expect(r.estado).toBe('entregado'); expect(r.firmadoPor).toBe('Ana Ruiz'); expect(r.entregadoAt).toBe('2026-10-21T19:05:00.000Z'); expect(r.eventos).toHaveLength(1); expect(r.descripcion).toBe('Entregado en recepción · Entregado')
    expect(resumenT1({ detail: { familia_externa: 'In Process', familia_interna: 'Guia generada' } }).estado).toBe('sin_eventos')
    expect(resumenT1({ detail: { familia_externa: 'Collected', fecha: '2026-10-21 09:00:00' } }).estado).toBe('recolectado')
    expect(resumenT1({ detail: { familia_externa: 'Transit', fecha: '2026-10-21 09:00:00' } }).estado).toBe('en_transito')
    expect(resumenT1({ detail: { familia_externa: 'Exception of delivery', familia_interna: 'Dirección incorrecta', fecha: '2026-10-21 09:00:00' } }).estado).toBe('incidencia')
    expect(resumenT1({ detail: { familia_externa: 'Algo raro', fecha: '2026-10-21 09:00:00' } }).estado).toBe('en_transito')   // nunca entregado por adivinar
    expect(parseTrackingT1(d)).toEqual({ status: 'Delivered', events: [{ at: '2026-10-21T19:05:00.000Z', status: 'DL', description: 'Entregado en recepción · Entregado' }] })
  })
  it('recolección: contacto del origen, paquete entero y horario; confirmación = pick_up', () => {
    const r = buildPickupT1(SHIPPER, PKG, 'fedex', { date: '2026-10-22', ready: '10:00', close: '18:00', instructions: 'Recepción, preguntar por Alberto' }, '77', 'Las Quintas')
    expect(r).toMatchObject({ mensajeria: 'FEDEX', nombre_contacto: 'Renovacell SA', apellidos_contacto: 'de CV', calle: 'Blvd. Pedro Infante', numero: '2911', colonia: 'Las Quintas', codigo_postal: '80100', municipio: 'Culiacán', estado: 'Sinaloa', telefono: '6671647799', cantidad_piezas: 1, peso: 2, largo: 30, ancho: 20, alto: 15, fecha: '2026-10-22', hora_inicio: '10:00', horario_cierre: '18:00', comercio_id: '77', referencias: 'Recepción, preguntar por Alberto' })
    expect(parsePickupT1({ success: true, detail: { recoleccion: { pick_up: '321', localizacion: 'HPU' } } })).toEqual({ confirmation: '321' })
    expect(parsePickupT1({ success: false })).toEqual({ confirmation: '' })
  })
})
