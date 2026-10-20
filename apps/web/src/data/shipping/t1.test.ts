// T1 Envíos · API v2.0 · adaptador puro con los CONTRATOS OFICIALES (T1 Cuenta): configuración por ambiente, cabeceras,
// cotización (request documentado; respuesta {success, detail[]} con total_cost y token), guía (request origin_/destination_,
// respuesta detail.tracking_number/order_number/carrier/cost/guide_link/file), errores 400/401/402/409/500, reintentos.
import { describe, it, expect } from 'vitest'
import { t1Config, cabecerasT1, urlT1, HOSTS_T1, RUTAS_T1, CONTRATO_T1, buildQuoteT1, faltantesCotizacion, parseQuoteT1, claveServicio, datosOrigenT1, datosDestinoT1, faltantesGuia, PISTA_ORIGEN_T1, buildGuideT1, CAMPOS_GUIA_V2, parseGuideT1, errorT1, reintentableCotizacion, esperaReintentoMs, partirNombre, partirCalle, formaDe, describirT1, T1_SECRETOS } from '../../../../../supabase/functions/shipping/t1'

// Origen = bloque "Origen de envíos" de Configuración (misma fuente que DHL), con los campos estructurados de la 183.
const SHIPPER = { name: 'Renovacell SA de CV', addressLine1: 'Nuevo Mundo 1045 17', cp: '80197', city: 'Culiacán', state: 'Sinaloa', country: 'MX', phone: '667 164 7799', email: 'envios@renovacell.mx', calle: 'Nuevo Mundo', numeroExt: '1045', numeroInt: '17', colonia: 'Las Quintas', referencias: 'Local 17, frente al parque' }
const RECEIVER = { name: 'Dra. Ana María Ruiz Pérez', email: 'ana@clinica.mx', address: { line1: 'Av. Reforma 123 int. 4', colonia: 'Centro', cp: '06600', city: 'Ciudad de México', state: 'CDMX', refs: 'Edificio azul', phone: '(55) 1234-5678' } }
const PKG = { weightKg: 1.4, lengthCm: 30, widthCm: 20, heightCm: 15, pieces: 1 }
const env = (o: Record<string, string>) => (k: string) => o[k]
const KEY = 'k1k2k3k4k5k6k7k8k9k0abcd'
const OK = { T1_API_ENV: 'test', T1_API_KEY: KEY, T1_SHOP_ID: '7781' }
// Fixture OFICIAL de cotización (valores de ejemplo de la documentación).
const COTIZACION = { success: true, message: 'Successful Search!', carriers: '', detail: [
  { service_id: 'DHL', service_name: 'EXPRESS DOMESTIC', service_type: 'Dia Siguiente', total_packages: 1, cost: 298.04, total_cost: 376.16, delivery_days: 1, currency: 'MXN', carrier: 'DHL', token: 'TOKEN_DHL', recommended: true, insurance: true, package_value: 3000, shipment_cost: 118.49, insurance_cost: 45, extended_zone: true, extended_zone_cost: 212.67 },
  { service_id: 'FEDEX', service_name: 'GROUND', service_type: 'Terrestre', total_packages: 1, cost: 140, total_cost: 162.4, delivery_days: 4, currency: 'MXN', carrier: 'FEDEX', token: 'TOKEN_FX', recommended: false, insurance: false },
] }
// Fixture OFICIAL de guía.
const B64 = 'JVBERi0xLjQKJfbk/N8KMSAwIG9iago8PAov'.repeat(4)
const GUIA = { success: true, message: 'Guide Generated!', detail: { packages: 1, order_number: 6039298, carrier: 'DHL', creation_date: '2026-07-09 16:21:38', cost: 374.11, destination: 'Maria Calle 5 200 Reforma Coatzacoalcos', current_balance: 8709760.27, tracking_number: '6232915371', extended_zone: false, guide_link: 'https://shipping-guides-storage-dev.s3.us-east-1.amazonaws.com/labels/ejemplo.pdf', file: B64 } }

describe('T1 v2.0 · configuración por ambiente', () => {
  it('sandbox: host del registro, cabeceras X-Api-Key + shop_id, rutas oficiales; la llave nunca aparece en la descripción', () => {
    const c = t1Config(env(OK)); expect(c.ok).toBe(true); if (!c.ok) return
    expect(c.cfg).toEqual({ base: 'https://sandbox.t1api.com', ambiente: 'test', apiKey: KEY, shopId: '7781' })
    expect(T1_SECRETOS).toEqual(['T1_API_ENV', 'T1_API_KEY', 'T1_SHOP_ID'])   // sin T1_ORIGEN_COLONIA: el origen sale del ERP
    expect(cabecerasT1(c.cfg)).toEqual({ 'Content-Type': 'application/json', 'X-Api-Key': KEY, shop_id: '7781' })
    expect(urlT1(c.cfg, RUTAS_T1.cotizar)).toBe('https://sandbox.t1api.com/t1-shipping/quote/create-with-quote')
    expect(urlT1(c.cfg, RUTAS_T1.guia)).toBe('https://sandbox.t1api.com/t1-shipping/guide/create-guide')
    expect(describirT1(c.cfg)).not.toContain(KEY)
  })
  it('producción sin host confirmado NO opera (bloqueo de producción); el registro no tiene host productivo', () => {
    expect(HOSTS_T1.production).toBeNull()
    expect(t1Config(env({ ...OK, T1_API_ENV: 'production' }))).toMatchObject({ ok: false, motivo: 'produccion_sin_host' })
  })
  it('ausente, relleno, shop_id faltante y ambiente inválido fallan de forma segura; las variables de Keycloak ya no configuran nada', () => {
    expect(t1Config(env({}))).toMatchObject({ ok: false, motivo: 'sin_configurar' })
    expect(t1Config(env({ ...OK, T1_API_KEY: '' }))).toMatchObject({ ok: false, motivo: 'sin_configurar' })
    expect(t1Config(env({ ...OK, T1_SHOP_ID: '' }))).toMatchObject({ ok: false, motivo: 'sin_configurar' })
    for (const r of ['...', '<API_KEY>', 'cambiar', 'xxxxxxxxxxxxxxxxxx', 'corta']) expect(t1Config(env({ ...OK, T1_API_KEY: r })), r).toMatchObject({ ok: false, motivo: 'relleno' })
    expect(t1Config(env({ ...OK, T1_API_ENV: 'sandbox' }))).toMatchObject({ ok: false, motivo: 'ambiente_invalido' })
    expect(t1Config(env({ T1_API_URL: 'https://x', T1_AUTH_URL: 'https://y', T1_CLIENT_SECRET: 's', T1_USERNAME: 'u', T1_PASSWORD: 'p', T1_SHOP_ID: '1' }))).toMatchObject({ ok: false, motivo: 'ambiente_invalido' })
    expect(t1Config.length).toBe(1)   // una sola fuente (secretos): el cliente no elige ambiente ni host
  })
})

describe('T1 v2.0 · cotización (contrato oficial)', () => {
  it('request documentado: cp, medidas enteras hacia arriba, package_type 2, insurance false, home false', () => {
    expect(buildQuoteT1(SHIPPER, RECEIVER, PKG)).toEqual({ home: false, origin_postal_code: '80197', destination_postal_code: '06600', weight: 2, length: 30, width: 20, height: 15, shipping_days: 0, insurance: false, package_type: 2, packages: 1 })
    expect(faltantesCotizacion(buildQuoteT1(SHIPPER, { ...RECEIVER, address: { ...RECEIVER.address, cp: '66' } }, PKG))).toEqual(['C.P. de destino (5 dígitos)'])
  })
  it('respuesta oficial: valida success y detail[], usa total_cost (no cost), conserva token, distingue t1 del transportista, ordena por total', () => {
    expect(CONTRATO_T1.cotizacion_response).toBe(true)
    const r = parseQuoteT1(COTIZACION); expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.tarifas.map((t) => [t.serviceCode, t.carrier, t.service, t.amount, t.etaDays, t.token, t.currency])).toEqual([
      ['FEDEX|GROUND', 'FedEx', 'Terrestre · Terrestre', 162.4, 4, 'TOKEN_FX', 'MXN'],
      ['DHL|EXPRESS_DOMESTIC', 'DHL', 'Express · Dia Siguiente', 376.16, 1, 'TOKEN_DHL', 'MXN'],
    ])
    const dhl = r.tarifas[1]
    expect(dhl.detalle).toEqual({ service_id: 'DHL', service_name: 'EXPRESS DOMESTIC', service_type: 'Dia Siguiente', cost: 298.04, insurance: true, insurance_cost: 45, extended_zone: true, extended_zone_cost: 212.67, recommended: true, total_packages: 1 })
    expect(r.tarifas[0].detalle).toMatchObject({ insurance: false, insurance_cost: null, extended_zone: null, recommended: false })   // opcionales ausentes → null, nunca inventados
    expect(claveServicio('DHL', 'EXPRESS DOMESTIC')).toBe('DHL|EXPRESS_DOMESTIC')
  })
  it('rechazo seguro: sin success/detail, success false, detail vacío, servicios sin total_cost o sin token', () => {
    expect(parseQuoteT1({ status: 'ok', data: [] })).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' })
    expect(parseQuoteT1({ success: false, message: 'Bad', detail: [] })).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' })
    expect(parseQuoteT1({ success: true, detail: [] })).toMatchObject({ ok: false, motivo: 'sin_servicios' })
    expect(parseQuoteT1({ success: true, detail: [{ carrier: 'DHL', service_name: 'EXPRESS DOMESTIC', cost: 298.04, token: 'x' }] })).toMatchObject({ ok: false, motivo: 'respuesta_incompleta' })   // sin total_cost
    expect(parseQuoteT1({ success: true, detail: [{ carrier: 'DHL', service_name: 'EXPRESS DOMESTIC', total_cost: 376.16 }] })).toMatchObject({ ok: false, motivo: 'respuesta_incompleta' })   // sin token
    const x = parseQuoteT1({ success: true, detail: [{ carrier: 'DHL', service_name: 'EXPRESS DOMESTIC', total_cost: 376.16, token: 'ok' }, { carrier: 'UPS', service_name: 'SAVER', total_cost: 0, token: 'z' }] })
    expect(x.ok && x.tarifas.map((t) => t.serviceCode)).toEqual(['DHL|EXPRESS_DOMESTIC'])   // el incompleto se descarta, el válido queda
    expect(formaDe({ a: [1, { b: null }] })).toBe('{a:[number]}')
  })
  it('errores documentados en palabras, sin cabeceras ni respuesta completa; reintento solo 429/5xx (cotizar), nunca la guía', () => {
    expect(errorT1(400, { message: 'destination_postal_code inválido' })).toEqual({ clase: 'cotizacion', mensaje: 'T1: destination_postal_code inválido' })
    expect(errorT1(401, { message: 'Unauthorized' })).toMatchObject({ clase: 'credenciales' }); expect(errorT1(401, {}).mensaje).not.toContain(KEY)
    expect(errorT1(402, {})).toMatchObject({ clase: 'sin_saldo' })
    expect(errorT1(409, { message: 'quote_token expired' })).toMatchObject({ clase: 'token_vencido' })
    expect(errorT1(500, { message: 'x'.repeat(500) }).mensaje).toBe('T1 no está disponible (500).')
    for (const st of [400, 401, 402, 409]) expect(reintentableCotizacion(st)).toBe(false)
    for (const st of [429, 500, 502, 503]) expect(reintentableCotizacion(st)).toBe(true)
    expect([0, 1, 2, 3, 6].map((i) => esperaReintentoMs(i))).toEqual([600, 1200, 2400, 4800, 8000])
  })
})

describe('T1 v2.0 · guía (contrato oficial)', () => {
  it('request oficial: quote_token, content ≤ 25, business_id = shop_id, origin_/destination_ completos, razón social opcional, sin recolección ni guide_origin', () => {
    expect(CONTRATO_T1.guia_request_campos_direccion).toBe(true); expect(CAMPOS_GUIA_V2.cp).toBeNull()
    const g = buildGuideT1('TOKEN_DHL', 'S100002', '7781', datosOrigenT1(SHIPPER), datosDestinoT1(RECEIVER), SHIPPER.name)
    expect(g).toEqual({
      quote_token: 'TOKEN_DHL', content: 'Pedido S100002', business_id: '7781', origin_business_name: 'Renovacell SA de CV',
      origin_first_name: 'Renovacell SA', origin_last_name: 'de CV', origin_email: 'envios@renovacell.mx', origin_phone: '6671647799', origin_street: 'Nuevo Mundo', origin_number: '1045 17', origin_neighborhood: 'Las Quintas', origin_municipality: 'Culiacán', origin_state: 'Sinaloa', origin_references: 'Local 17, frente al parque',
      destination_first_name: 'Ana María', destination_last_name: 'Ruiz Pérez', destination_email: 'ana@clinica.mx', destination_phone: '5512345678', destination_street: 'Av. Reforma', destination_number: '123 int. 4', destination_neighborhood: 'Centro', destination_municipality: 'Ciudad de México', destination_state: 'CDMX', destination_references: 'Edificio azul',
      generate_pickup: false, has_notification: false,
    })
    expect(Object.keys(g)).not.toContain('guide_origin')
    expect(buildGuideT1('t', 'X', '1', datosOrigenT1(SHIPPER), datosDestinoT1(RECEIVER))).not.toHaveProperty('origin_business_name')
  })
  it('el origen sale SOLO de los campos estructurados del ERP (sin dividir textos): sin colonia/referencias se reporta, nunca se inventa', () => {
    expect(datosOrigenT1(SHIPPER)).toEqual({ nombre: 'Renovacell SA', apellidos: 'de CV', correo: 'envios@renovacell.mx', telefono: '6671647799', calle: 'Nuevo Mundo', numero: '1045 17', colonia: 'Las Quintas', municipio: 'Culiacán', estado: 'Sinaloa', cp: '80197', referencias: 'Local 17, frente al parque' })
    // como está hoy producción: solo shipping_address "Nuevo Mundo 1045-17" y campos nuevos vacíos → faltan calle, número, colonia y referencias (no se divide el texto)
    const legado = datosOrigenT1({ ...SHIPPER, addressLine1: 'Nuevo Mundo 1045-17', calle: '', numeroExt: '', numeroInt: '', colonia: '', referencias: '' })
    expect(legado).toMatchObject({ calle: '', numero: '', colonia: '', referencias: '' })
    expect(faltantesGuia(legado, datosDestinoT1(RECEIVER))).toEqual(['origen: calle', 'origen: número', 'origen: colonia', 'origen: referencias'])
    expect(datosOrigenT1({ ...SHIPPER, numeroInt: '' }).numero).toBe('1045')
    expect(PISTA_ORIGEN_T1).toMatch(/Configuración → Origen de envíos/)
  })
  it('sin datos obligatorios NO se arma la guía (nada inventado): faltantes en palabras por lado; teléfonos de 10 dígitos', () => {
    const o = datosOrigenT1({ ...SHIPPER, colonia: '', referencias: '' }), d = datosDestinoT1({ ...RECEIVER, email: null, address: { ...RECEIVER.address, colonia: '', phone: '55' } })
    expect(faltantesGuia(o, d)).toEqual(['origen: colonia', 'origen: referencias', 'destino: correo', 'destino: teléfono (10 dígitos)', 'destino: colonia'])
    expect(() => buildGuideT1('tk', 'S1', '7781', o, d)).toThrow(/faltan: origen: colonia, origen: referencias, destino: correo/)
    expect(() => buildGuideT1('', 'S1', '7781', datosOrigenT1(SHIPPER), datosDestinoT1(RECEIVER))).toThrow(/token de cotización/)
    expect(partirNombre('Carlos López')).toEqual({ nombre: 'Carlos', apellidos: 'López' }); expect(partirCalle('Calle sin número')).toEqual({ calle: 'Calle sin número', numero: 'S/N' })
    // Un solo nombre (hoy prod: shipping_name = "Renovacell"): el apellido no se repite ni se inventa → solo la GUÍA se detiene; cotizar no usa nombres.
    expect(partirNombre('Renovacell')).toEqual({ nombre: 'Renovacell', apellidos: '' })
    expect(faltantesGuia(datosOrigenT1({ ...SHIPPER, name: 'Renovacell' }), datosDestinoT1(RECEIVER))).toEqual(['origen: apellidos'])
    expect(buildQuoteT1({ ...SHIPPER, name: 'Renovacell' }, RECEIVER, PKG).origin_postal_code).toBe('80197')
  })
  it('respuesta oficial: tracking_number, order_number, carrier, cost, guide_link como URL y file como PDF base64', () => {
    expect(CONTRATO_T1.guia_response).toBe(true)
    const r = parseGuideT1(GUIA); expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.guia).toEqual({ tracking: '6232915371', orderNumber: '6039298', carrier: 'DHL', cost: 374.11, labelUrl: 'https://shipping-guides-storage-dev.s3.us-east-1.amazonaws.com/labels/ejemplo.pdf', labelBase64: B64, extendedZone: false, currentBalance: 8709760.27 })
    expect(parseGuideT1({ ...GUIA, detail: { ...GUIA.detail, file: `data:application/pdf;base64,${B64}` } })).toMatchObject({ ok: true, guia: { labelBase64: B64 } })
  })
  it('respuestas incompletas: success false → rechazada; success sin tracking → sin_guia (desconocido); forma extraña → no reconocida', () => {
    expect(parseGuideT1({ success: false, message: 'Insufficient balance' })).toMatchObject({ ok: false, motivo: 'rechazada', mensaje: 'Insufficient balance' })
    expect(parseGuideT1({ success: true, detail: { order_number: 1, carrier: 'DHL' } })).toMatchObject({ ok: false, motivo: 'sin_guia' })
    const x = parseGuideT1({ ok: true, guide: '1' }); expect(x).toMatchObject({ ok: false, motivo: 'forma_no_reconocida' }); if (x.ok) return; expect(x.forma).toBe('{ok:boolean,guide:string}')
  })
})
