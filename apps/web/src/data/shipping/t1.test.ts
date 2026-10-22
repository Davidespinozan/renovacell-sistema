// T1 Envíos · API v2.0 · adaptador puro con los CONTRATOS OFICIALES (T1 Cuenta): configuración por ambiente, cabeceras,
// cotización (request documentado; respuesta {success, detail[]} con total_cost y token), guía (request origin_/destination_,
// respuesta detail.tracking_number/order_number/carrier/cost/guide_link/file), errores 400/401/402/409/500, reintentos.
import { describe, it, expect, beforeEach } from 'vitest'
import { t1Config, cabecerasT1, urlT1, HOSTS_T1, RUTAS_T1, CONTRATO_T1, buildQuoteT1, faltantesCotizacion, valorMercancia, parseQuoteT1, mensajeT1, diagnosticoT1, depurarTexto, cabecerasWalletT1, resumenWalletT1, claveServicio, datosOrigenT1, datosDestinoT1, faltantesGuia, PISTA_ORIGEN_T1, buildGuideT1, CAMPOS_GUIA_V2, parseGuideT1, errorT1, reintentableCotizacion, esperaReintentoMs, partirNombre, partirCalle, formaDe, describirT1, T1_SECRETOS, T1_SECRETOS_LIVE, GUIAS_LIVE_PERMITIDAS, HOSTS_T1_KEYCLOAK, RUTAS_T1_KEYCLOAK, rutaT1, KEYCLOAK_T1, T1_SECRETOS_KEYCLOAK_LIVE, buildTokenRequest, leerToken, obtenerTokenT1, olvidarTokenT1, olvidarTodosLosTokensT1, tokenVigente, cabecerasAutenticadasT1 } from '../../../../../supabase/functions/shipping/t1'

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
    expect(c.cfg).toEqual({ base: 'https://sandbox.t1api.com', ambiente: 'test', auth: 'api_key', apiKey: KEY, shopId: '7781', cotizarPermitido: true, guiasPermitidas: true })
    expect(T1_SECRETOS).toEqual(['T1_API_ENV', 'T1_API_KEY', 'T1_SHOP_ID'])   // sin T1_ORIGEN_COLONIA: el origen sale del ERP
    expect(cabecerasT1(c.cfg)).toEqual({ 'Content-Type': 'application/json', 'X-Api-Key': KEY, shop_id: '7781' })
    expect(urlT1(c.cfg, RUTAS_T1.cotizar)).toBe('https://sandbox.t1api.com/t1-shipping/quote/create-with-quote')
    expect(urlT1(c.cfg, RUTAS_T1.guia)).toBe('https://sandbox.t1api.com/t1-shipping/guide/create-guide')
    expect(describirT1(c.cfg)).not.toContain(KEY)
  })
  it('producción sin host confirmado NO opera (bloqueo de producción); el registro no tiene host productivo', () => {
    expect(HOSTS_T1.production).toBeNull()
    expect(t1Config(env({ ...OK, T1_API_ENV: 'production' }))).toMatchObject({ ok: false, motivo: 'sin_configurar' })   // las llaves sandbox no valen en production
    expect(t1Config(env({ T1_API_ENV: 'production', T1_LIVE_API_KEY: KEY, T1_LIVE_SHOP_ID: '7781' }))).toMatchObject({ ok: false, motivo: 'produccion_sin_host' })
  })
  it('ausente, relleno, shop_id faltante y ambiente inválido fallan de forma segura; las variables Keycloak LEGADO (T1_AUTH_URL…) no configuran nada', () => {
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
  it('request documentado + valor_paquete (T1 lo exige aunque insurance sea false): cp, medidas enteras, package_type 2, valor de la mercancía del pedido', () => {
    // comercio_id (string) = shop_id: HIPÓTESIS contractual pendiente de validar en sandbox (doc pública lo exige en el cuerpo)
    const q = buildQuoteT1(SHIPPER, RECEIVER, PKG, 350, '7781')
    expect(q).toEqual({ comercio_id: '7781', home: false, origin_postal_code: '80197', destination_postal_code: '06600', weight: 2, length: 30, width: 20, height: 15, shipping_days: 0, insurance: false, package_value: 350, valor_paquete: 350, package_type: 2, packages: 1 })
    // package_value (nombre v2.0 de T1 Cuenta) y valor_paquete (exigido por el sandbox) son el MISMO número
    expect(typeof q.package_value).toBe('number'); expect(typeof q.valor_paquete).toBe('number'); expect(q.package_value).toBe(q.valor_paquete)
    expect(buildQuoteT1(SHIPPER, RECEIVER, PKG, 1234.567, '7781')).toMatchObject({ package_value: 1234.57, valor_paquete: 1234.57 })
    expect(typeof buildQuoteT1(SHIPPER, RECEIVER, PKG, 350, '338714').comercio_id).toBe('string')
    expect(buildQuoteT1(SHIPPER, RECEIVER, PKG, 350, '7781')).not.toHaveProperty('business_id')   // la guía tiene su propio contrato
    expect(faltantesCotizacion(buildQuoteT1(SHIPPER, { ...RECEIVER, address: { ...RECEIVER.address, cp: '66' } }, PKG, 350, '7781'))).toEqual(['C.P. de destino (5 dígitos)'])
    expect(faltantesCotizacion(buildQuoteT1(SHIPPER, RECEIVER, PKG, 350, ''))).toEqual(['identificador de la tienda (T1_SHOP_ID)'])
    // pedido sin valor válido: no se manda 0 ni un fijo; se reporta
    expect(buildQuoteT1(SHIPPER, RECEIVER, PKG, 0, '7781')).toMatchObject({ package_value: 0, valor_paquete: 0 })
    expect(faltantesCotizacion(buildQuoteT1(SHIPPER, RECEIVER, PKG, 0, '7781'))).toEqual(['valor de la mercancía del pedido (renglones con precio)'])
    expect(faltantesCotizacion(buildQuoteT1(SHIPPER, RECEIVER, PKG, NaN, '7781'))).toEqual(['valor de la mercancía del pedido (renglones con precio)'])
  })
  it('valorMercancia: Σ cantidad × precio vendido de los renglones; sin renglones con precio → null (nunca se inventa)', () => {
    expect(valorMercancia([{ qty: 1, unit_price: 350 }])).toBe(350)   // S100002 real: 1 × $350
    expect(valorMercancia([{ qty: 2, unit_price: '4000.00' }, { qty: 1, unit_price: 3600 }, { qty: 0, unit_price: 99 }])).toBe(11600)
    expect(valorMercancia([])).toBeNull(); expect(valorMercancia([{ qty: 1, unit_price: 0 }])).toBeNull(); expect(valorMercancia([{ qty: 1, unit_price: null }])).toBeNull()
    expect(valorMercancia([{ qty: 3, unit_price: 33.333 }])).toBe(100)
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
    expect(errorT1(500, {}).mensaje).toBe('T1 no está disponible (500).')
    expect(errorT1(500, { message: 'Error interno al calcular el servicio ' + 'detalle '.repeat(60) }).mensaje).toMatch(/^T1 respondió 500: Error interno al calcular el servicio/)   // el texto de T1 se conserva (recortado) también en 5xx
    expect(mensajeT1({ detail: { error: 'Error en el campo valor_paquete con valor None: Campo requerido no proporcionado.' } })).toMatch(/valor_paquete/)
    expect(mensajeT1({ errors: [{ message: 'a' }, 'b'] })).toBe('a; b'); expect(mensajeT1(null)).toBe('')
    expect(diagnosticoT1('cotizar', 500, { success: false, message: 'Internal' })).toBe('[t1] cotizar · HTTP 500 · Internal · forma {success:boolean,message:string}')
    expect(diagnosticoT1('cotizar', 500, { success: false, error: 'ERR-QUOTE-STORE', message: 'No fue posible registrar la cotización.', errorType: 'StoreError' })).toBe('[t1] cotizar · HTTP 500 · No fue posible registrar la cotización. · ERR-QUOTE-STORE / StoreError · forma {success:boolean,error:string,message:string,errorType:string}')
    // depuración: correos, teléfonos/números largos y tokens no se muestran ni se registran; 200 máximo
    expect(depurarTexto('Contacto ana@clinica.mx tel 55 1234 5678 token abcdefghijklmnopqrstuvwxyz0123 calle ok')).toBe('Contacto [correo] tel [número] token [token] calle ok')
    expect(mensajeT1({ message: 'Error destination_phone 5512345678 inválido' })).toBe('Error destination_phone [número] inválido')
    expect(errorT1(500, { message: 'Internal: ' + 'detalle '.repeat(80) }).mensaje.length).toBeLessThanOrEqual(220)
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
    expect(buildQuoteT1({ ...SHIPPER, name: 'Renovacell' }, RECEIVER, PKG, 350, '7781').origin_postal_code).toBe('80197')
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

describe('TEMPORAL · diagnóstico de billetera T1 (sandbox)', () => {
  it('cabeceras con seller_id (no shop_id) y ruta documentada; resumen mínimo sin cuerpo, límites ni datos bancarios', () => {
    const c = t1Config(env(OK)); if (!c.ok) throw new Error('config')
    expect(cabecerasWalletT1(c.cfg)).toEqual({ 'X-Api-Key': KEY, seller_id: '7781' }); expect(RUTAS_T1.wallet).toBe('/t1-shipping/wallet/movements')
    const r = resumenWalletT1(200, { success: true, message: 'ok', detail: { seller_id: 7781, current_balance: 5000.5, balance_limits: { max: 99 }, bank: { clabe: '123456789012345678' }, movements: [{ amount: 1, email: 'x@y.mx' }] } }, '7781')
    expect(r).toEqual({ http: 200, success: true, seller_coincide: true, current_balance: 5000.5, error: null, errorType: null })
    expect(JSON.stringify(r)).not.toMatch(/balance_limits|clabe|movements|x@y\.mx|123456789012345678/)
    expect(resumenWalletT1(200, { success: true, detail: { seller_id: '999', current_balance: 10 } }, '7781').seller_coincide).toBe(false)
    expect(resumenWalletT1(400, { success: false, message: 'Error al procesar petición', error: 'No existe en recurso con id: 338714', errorType: 'NotFound' }, '338714')).toEqual({ http: 400, success: false, seller_coincide: null, current_balance: null, error: 'No existe en recurso con id: 338714', errorType: 'NotFound' })   // el id de comercio (6 dígitos) no es dato personal; teléfonos (≥8) sí se ocultan
    expect(resumenWalletT1(401, {}, '1')).toEqual({ http: 401, success: null, seller_coincide: null, current_balance: null, error: null, errorType: null })
    expect(resumenWalletT1(200, { success: false, detail: { current_balance: 7 } }, '1').current_balance).toBeNull()   // saldo solo con éxito
  })
})

describe('T1-LIVE-01 · producción separada del sandbox', () => {
  const LIVE = { T1_API_ENV: 'production', T1_LIVE_API_KEY: 'live-k1k2k3k4k5k6k7k8k9', T1_LIVE_SHOP_ID: '338714', T1_LIVE_COTIZAR: 'on' }
  const HOSTS_PRUEBA = { test: 'https://sandbox.t1api.com', production: 'https://live.ejemplo.test' }   // SOLO para la prueba; el registro real sigue sin host live
  it('sin host productivo confirmado, production no opera aunque tenga llaves live', () => {
    expect(HOSTS_T1.production).toBeNull()
    expect(t1Config(env(LIVE))).toMatchObject({ ok: false, motivo: 'produccion_sin_host' })
  })
  it('credenciales separadas: production lee T1_LIVE_*; las de sandbox no sirven en production ni al revés', () => {
    const c = t1Config(env(LIVE), HOSTS_PRUEBA); expect(c.ok).toBe(true); if (!c.ok) return
    expect(c.cfg).toEqual({ ambiente: 'production', auth: 'api_key', base: 'https://live.ejemplo.test', apiKey: 'live-k1k2k3k4k5k6k7k8k9', shopId: '338714', cotizarPermitido: true, guiasPermitidas: false })
    expect(t1Config(env({ T1_API_ENV: 'production', T1_API_KEY: KEY, T1_SHOP_ID: '7781' }), HOSTS_PRUEBA)).toMatchObject({ ok: false, motivo: 'sin_configurar', detalle: 'Faltan T1_LIVE_API_KEY y T1_LIVE_SHOP_ID.' })
    expect(t1Config(env({ T1_API_ENV: 'test', T1_LIVE_API_KEY: 'live-k1k2k3k4k5k6k7k8k9', T1_LIVE_SHOP_ID: '1' }), HOSTS_PRUEBA)).toMatchObject({ ok: false, motivo: 'sin_configurar' })
    expect(T1_SECRETOS_LIVE).toEqual(['T1_API_ENV', 'T1_LIVE_API_KEY', 'T1_LIVE_SHOP_ID', 'T1_LIVE_COTIZAR'])
  })
  it('control independiente de cotización live (T1_LIVE_COTIZAR=on) y guías live bloqueadas por código', () => {
    expect(GUIAS_LIVE_PERMITIDAS).toBe(false)
    const off = t1Config(env({ ...LIVE, T1_LIVE_COTIZAR: '' }), HOSTS_PRUEBA); expect(off.ok && off.cfg.cotizarPermitido).toBe(false)
    const si = t1Config(env({ ...LIVE, T1_LIVE_COTIZAR: 'ON' }), HOSTS_PRUEBA); expect(si.ok && si.cfg.cotizarPermitido).toBe(true); expect(si.ok && si.cfg.guiasPermitidas).toBe(false)
    const sb = t1Config(env(OK)); expect(sb.ok && sb.cfg.cotizarPermitido && sb.cfg.guiasPermitidas).toBe(true)   // sandbox sin cambios
    expect(t1Config(env({ ...LIVE, T1_LIVE_API_KEY: '...' }), HOSTS_PRUEBA)).toMatchObject({ ok: false, motivo: 'relleno' })
  })
})

describe('T1-LIVE-02 · Keycloak (contrato documentado, host productivo apiv2)', () => {
  const KC = { T1_API_ENV: 'production', T1_LIVE_AUTH: 'keycloak', T1_LIVE_SHOP_ID: '338714', T1_LIVE_COTIZAR: 'on', T1_LIVE_KC_CLIENT_SECRET: 'secreto-kc-1234567890', T1_LIVE_KC_USERNAME: 'ventas@renovacell.test', T1_LIVE_KC_PASSWORD: 'Clave.Segura.2026' }
  const AHORA = Date.parse('2026-10-22T18:00:00Z')
  const respuesta = (status: number, body: unknown) => ({ status, json: async () => body })
  beforeEach(() => olvidarTodosLosTokensT1())
  it('configuración: production + keycloak lee T1_LIVE_KC_*; host apiv2 documentado; sin X-Api-Key; rutas sin prefijo y guía sin confirmar', () => {
    const c = t1Config(env(KC)); expect(c.ok).toBe(true); if (!c.ok) return
    expect(c.cfg).toEqual({ ambiente: 'production', auth: 'keycloak', base: 'https://apiv2.t1envios.com', apiKey: '', shopId: '338714', cotizarPermitido: true, guiasPermitidas: false,
      keycloak: { tokenUrl: 'https://id.t1.com/realms/T1/protocol/openid-connect/token', clientId: 't1envios', clientSecret: 'secreto-kc-1234567890', username: 'ventas@renovacell.test', password: 'Clave.Segura.2026', grant: 'password' } })
    expect(HOSTS_T1_KEYCLOAK).toEqual({ test: null, production: 'https://apiv2.t1envios.com' }); expect(HOSTS_T1.production).toBeNull()   // el registro api_key no cambia
    expect(RUTAS_T1_KEYCLOAK).toEqual({ cotizar: '/quote/create-with-quote', guia: null, wallet: null })
    expect(rutaT1(c.cfg, 'cotizar')).toBe('/quote/create-with-quote'); expect(rutaT1(c.cfg, 'guia')).toBeNull(); expect(rutaT1({ auth: 'api_key' }, 'guia')).toBe('/t1-shipping/guide/create-guide')
    expect(urlT1(c.cfg, rutaT1(c.cfg, 'cotizar')!)).toBe('https://apiv2.t1envios.com/quote/create-with-quote')
    expect(describirT1(c.cfg)).toContain('Keycloak'); expect(describirT1(c.cfg)).not.toMatch(/secreto|Clave\.Segura|ventas@/)
    expect(T1_SECRETOS_KEYCLOAK_LIVE).toEqual(['T1_API_ENV', 'T1_LIVE_AUTH', 'T1_LIVE_SHOP_ID', 'T1_LIVE_COTIZAR', 'T1_LIVE_KC_CLIENT_SECRET', 'T1_LIVE_KC_USERNAME', 'T1_LIVE_KC_PASSWORD'])
    expect(KEYCLOAK_T1).toMatchObject({ grant: 'password', clientId: 't1envios', margenSeg: 60 })
    // valores opcionales: TOKEN_URL y CLIENT_ID se pueden sobreescribir; el grant solo acepta el documentado
    const c2 = t1Config(env({ ...KC, T1_LIVE_KC_TOKEN_URL: 'https://id.t1.com/realms/Otro/protocol/openid-connect/token', T1_LIVE_KC_CLIENT_ID: 'otro-cliente' })); expect(c2.ok && c2.cfg.keycloak).toMatchObject({ tokenUrl: 'https://id.t1.com/realms/Otro/protocol/openid-connect/token', clientId: 'otro-cliente' })
    expect(t1Config(env({ ...KC, T1_LIVE_KC_GRANT: 'client_credentials' }))).toMatchObject({ ok: false, motivo: 'grant_no_soportado' })
    expect(t1Config(env({ ...KC, T1_LIVE_KC_TOKEN_URL: 'http://id.t1.com/realms/T1/protocol/openid-connect/token' }))).toMatchObject({ ok: false, motivo: 'token_url_invalida' })
    expect(t1Config(env({ ...KC, T1_LIVE_KC_TOKEN_URL: 'https://malo.example/token' }))).toMatchObject({ ok: false, motivo: 'token_url_invalida' })
  })
  it('fallos seguros: credencial ausente, relleno, modo inválido, sandbox con keycloak sin host; api_key sigue siendo el modo por defecto', () => {
    for (const k of ['T1_LIVE_KC_CLIENT_SECRET', 'T1_LIVE_KC_USERNAME', 'T1_LIVE_KC_PASSWORD', 'T1_LIVE_SHOP_ID']) expect(t1Config(env({ ...KC, [k]: '' })), k).toMatchObject({ ok: false, motivo: 'sin_configurar', detalle: expect.stringContaining(k) })
    expect(t1Config(env({ ...KC, T1_LIVE_KC_PASSWORD: '...' }))).toMatchObject({ ok: false, motivo: 'relleno' })
    expect(t1Config(env({ ...KC, T1_LIVE_KC_CLIENT_SECRET: '<SECRET>' }))).toMatchObject({ ok: false, motivo: 'relleno' })
    expect(t1Config(env({ ...KC, T1_LIVE_AUTH: 'oauth' }))).toMatchObject({ ok: false, motivo: 'auth_invalida' })
    expect(t1Config(env({ T1_API_ENV: 'test', T1_AUTH: 'keycloak', T1_SHOP_ID: '7781', T1_KC_CLIENT_SECRET: 'secreto-kc-1234567890', T1_KC_USERNAME: 'u@x.test', T1_KC_PASSWORD: 'Clave.Segura' }))).toMatchObject({ ok: false, motivo: 'produccion_sin_host' })
    const sb = t1Config(env(OK)); expect(sb.ok && sb.cfg.auth).toBe('api_key'); expect(sb.ok && sb.cfg.keycloak).toBeUndefined()
    expect(t1Config(env({ ...KC, T1_LIVE_AUTH: '' }))).toMatchObject({ ok: false, motivo: 'sin_configurar', detalle: expect.stringContaining('T1_LIVE_API_KEY') })   // sin modo = api_key: exige la llave live
  })
  it('token: request documentado (form-urlencoded, grant password, client_id, client_secret, usuario, contraseña); lectura 200/400/401/403/5xx/forma', () => {
    const c = t1Config(env(KC)); if (!c.ok || !c.cfg.keycloak) throw new Error('cfg'); const kc = c.cfg.keycloak
    const r = buildTokenRequest(kc)
    expect(r.url).toBe('https://id.t1.com/realms/T1/protocol/openid-connect/token'); expect(r.init.method).toBe('POST'); expect(r.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const p = new URLSearchParams(r.init.body)
    expect(['grant_type', 'client_id', 'client_secret', 'username', 'password'].map((k) => [k, p.get(k)])).toEqual([['grant_type', 'password'], ['client_id', 't1envios'], ['client_secret', 'secreto-kc-1234567890'], ['username', 'ventas@renovacell.test'], ['password', 'Clave.Segura.2026']])
    expect(r.init.body.split('&')).toHaveLength(5)   // nada más viaja al token endpoint
    expect(leerToken(200, { access_token: 'abc.def.ghi', expires_in: 1800, token_type: 'Bearer' }, AHORA)).toEqual({ ok: true, token: { accessToken: 'abc.def.ghi', expiraEn: AHORA + 1800_000 } })
    expect(leerToken(200, { access_token: 'abc' }, AHORA)).toEqual({ ok: true, token: { accessToken: 'abc', expiraEn: AHORA + 1800_000 } })   // expires_in ausente → 30 min documentados
    expect(leerToken(200, { token_type: 'Bearer' }, AHORA)).toMatchObject({ ok: false, clase: 'forma_no_reconocida' })
    expect(leerToken(401, { error: 'invalid_grant', error_description: 'Invalid user credentials' }, AHORA)).toMatchObject({ ok: false, clase: 'credenciales_rechazadas', mensaje: expect.stringContaining('401 invalid_grant') })
    expect(leerToken(400, { error: 'unauthorized_client' }, AHORA)).toMatchObject({ ok: false, clase: 'credenciales_rechazadas' })
    expect(leerToken(403, {}, AHORA)).toMatchObject({ ok: false, clase: 'sin_permisos' })
    expect(leerToken(503, 'gateway', AHORA)).toMatchObject({ ok: false, clase: 'proveedor' })
    for (const l of [leerToken(401, { error: 'x', access_token: 'FILTRADO' }, AHORA), leerToken(500, { access_token: 'FILTRADO' }, AHORA)]) expect(JSON.stringify(l)).not.toContain('FILTRADO')
  })
  it('caché: un solo POST para varias peticiones; se renueva antes de vencer (margen 60 s); 401/403/red fallan sin reintento y sin guardar nada', async () => {
    const c = t1Config(env(KC)); if (!c.ok || !c.cfg.keycloak) throw new Error('cfg'); const kc = c.cfg.keycloak
    const llamadas: Array<{ url: string; body: string }> = []
    const fetchOk = async (url: string, init: { body: string }) => { llamadas.push({ url, body: init.body }); return respuesta(200, { access_token: 'tok-' + llamadas.length, expires_in: 1800 }) }
    const t1 = await obtenerTokenT1(kc, fetchOk, AHORA); const t2 = await obtenerTokenT1(kc, fetchOk, AHORA + 10 * 60_000)
    expect(t1).toMatchObject({ ok: true, token: { accessToken: 'tok-1' } }); expect(t2).toEqual(t1); expect(llamadas).toHaveLength(1)
    expect(tokenVigente(t1.ok ? t1.token : undefined, AHORA + 1800_000 - 61_000)).toBe(true); expect(tokenVigente(t1.ok ? t1.token : undefined, AHORA + 1800_000 - 59_000)).toBe(false)
    const t3 = await obtenerTokenT1(kc, fetchOk, AHORA + 1800_000 - 30_000)   // a 30 s de vencer: se renueva anticipadamente
    expect(t3).toMatchObject({ ok: true, token: { accessToken: 'tok-2' } }); expect(llamadas).toHaveLength(2)
    olvidarTokenT1(kc); await obtenerTokenT1(kc, fetchOk, AHORA); expect(llamadas).toHaveLength(3)
    // otra cuenta u otro realm = otra entrada de caché; el mismo usuario con otro secreto comparte clave (sin secretos en la clave) pero el secreto va en el POST
    await obtenerTokenT1({ ...kc, username: 'otro@x.test' }, fetchOk, AHORA); expect(llamadas).toHaveLength(4); expect(llamadas[3].body).toContain('otro%40x.test')
    olvidarTodosLosTokensT1()
    let n = 0
    const fetch401 = async () => { n++; return respuesta(401, { error: 'invalid_grant' }) }
    expect(await obtenerTokenT1(kc, fetch401, AHORA)).toMatchObject({ ok: false, clase: 'credenciales_rechazadas' }); expect(await obtenerTokenT1(kc, fetch401, AHORA)).toMatchObject({ ok: false }); expect(n).toBe(2)   // nada en caché tras un rechazo
    expect(await obtenerTokenT1(kc, async () => respuesta(403, {}), AHORA)).toMatchObject({ ok: false, clase: 'sin_permisos' })
    expect(await obtenerTokenT1(kc, async () => { throw new Error('ECONNRESET host secreto') }, AHORA)).toEqual({ ok: false, clase: 'sin_respuesta', mensaje: 'Keycloak de T1 no respondió (red o tiempo de espera).' })
  })
  it('cabeceras: api_key → X-Api-Key sin Authorization; keycloak → Bearer + shop_id sin X-Api-Key; sin credenciales no hay cabeceras', async () => {
    const sb = t1Config(env(OK)); if (!sb.ok) throw new Error('sb')
    const hs = await cabecerasAutenticadasT1(sb.cfg, async () => { throw new Error('no debe llamarse') })
    expect(hs).toEqual({ ok: true, headers: { 'Content-Type': 'application/json', 'X-Api-Key': KEY, shop_id: '7781' } })
    const c = t1Config(env(KC)); if (!c.ok) throw new Error('kc')
    const hk = await cabecerasAutenticadasT1(c.cfg, async () => respuesta(200, { access_token: 'abc.def', expires_in: 1800 }), AHORA)
    expect(hk).toEqual({ ok: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc.def', shop_id: '338714' } })
    expect(hk.ok && hk.headers['X-Api-Key']).toBeUndefined()
    olvidarTokenT1(c.cfg.keycloak!)   // sin caché: el 401 del token endpoint debe llegar al llamador
    const hf = await cabecerasAutenticadasT1(c.cfg, async () => respuesta(401, { error: 'invalid_grant' }), AHORA)
    expect(hf).toMatchObject({ ok: false, clase: 'credenciales_rechazadas' }); expect(JSON.stringify(hf)).not.toMatch(/secreto-kc|Clave\.Segura|Bearer/)
  })
})
