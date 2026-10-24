// DHL D1 · reconciliación de intentos desconocidos: referencia CU única por intento, día hábil, consulta por referencia y
// recuperación de etiqueta según el contrato probado en sandbox (23 oct 2026); guardas en el fuente de la Edge.
import { describe, it, expect, vi } from 'vitest'
import {
  siguienteDiaHabil, plannedDate, referenciaIntento, buildShipmentRequest, urlRastreoPorReferencia, urlRastreoPorNumero, urlGetImage,
  mesRecoleccion, clasificarRastreo, guiasDeRastreo, parseGetImage,
  consultarDHL, decisionPrevia, guiasDistintas, horasDesde, TIMEOUT_GUIA_MS, TIMEOUT_COTIZACION_MS,
} from '../../../../../supabase/functions/shipping/dhl'
import edgeSrc from '../../../../../supabase/functions/shipping/index.ts?raw'
import migSrc from '../../../../../supabase/migrations/20270112120000_dhl_d1_reconciliacion_guia.sql?raw'

const shipper = { name: 'Renovacell', addressLine1: 'Blvd 1', cp: '80197', city: 'Culiacán', state: 'Sinaloa', country: 'MX', phone: '6671234567', email: 'e@x.mx' }
const receiver = { name: 'Dra. Prueba', address: { line1: 'Av. 2', cp: '44100', city: 'Guadalajara', phone: '3312345678' } }
const pkg = { weightKg: 1.2, lengthCm: 20, widthCm: 20, heightCm: 10, pieces: 1 }

describe('fecha planeada: siguiente día hábil', () => {
  const dia = (iso: string) => siguienteDiaHabil(Date.parse(iso)).toISOString().slice(0, 10)
  it('de lunes a jueves es el día siguiente; viernes, sábado y domingo saltan al lunes', () => {
    expect(dia('2026-10-19T15:00:00Z')).toBe('2026-10-20')   // lunes → martes
    expect(dia('2026-10-22T15:00:00Z')).toBe('2026-10-23')   // jueves → viernes
    expect(dia('2026-10-23T15:00:00Z')).toBe('2026-10-26')   // viernes → lunes (antes: sábado → DHL 996)
    expect(dia('2026-10-24T15:00:00Z')).toBe('2026-10-26')   // sábado → lunes
    expect(dia('2026-10-25T15:00:00Z')).toBe('2026-10-26')   // domingo → lunes
  })
  it('formato MyDHL a las 10:00 GMT+00:00 y nunca cae en fin de semana', () => {
    expect(plannedDate(Date.parse('2026-10-23T23:30:00Z'))).toBe('2026-10-26T10:00:00 GMT+00:00')
    for (let i = 0; i < 14; i++) {
      const d = siguienteDiaHabil(Date.parse('2026-10-19T00:00:00Z') + i * 86_400_000)
      expect([0, 6]).not.toContain(d.getUTCDay())
    }
  })
})

describe('referencia CU única por intento', () => {
  const id = '4c37b767-e7d7-48fc-856b-278575280d8a'
  it('es el id sin guiones (32) y cabe en los 35 que admite DHL', () => {
    expect(referenciaIntento(id)).toBe('4c37b767e7d748fc856b278575280d8a')
    expect(referenciaIntento(id).length).toBeLessThanOrEqual(35)
  })
  it('viaja en la guía en la raíz y en el paquete con typeCode CU (contrato aceptado por el sandbox: HTTP 201)', () => {
    const r = buildShipmentRequest(shipper, receiver, pkg, '123456789', 'N', 'S100003', referenciaIntento(id)) as Record<string, unknown>
    expect(r.customerReferences).toEqual([{ value: '4c37b767e7d748fc856b278575280d8a', typeCode: 'CU' }])
    const content = r.content as { packages: Array<Record<string, unknown>> }
    expect(content.packages[0].customerReferences).toEqual([{ value: '4c37b767e7d748fc856b278575280d8a', typeCode: 'CU' }])
  })
  it('sin referencia la petición es la de siempre (sin campos nuevos)', () => {
    const r = buildShipmentRequest(shipper, receiver, pkg, '123456789', 'N', 'S100003') as Record<string, unknown>
    expect(r).not.toHaveProperty('customerReferences')
    expect((r.content as { packages: Array<Record<string, unknown>> }).packages[0]).not.toHaveProperty('customerReferences')
  })
})

describe('consulta a DHL · contrato REST', () => {
  const base = 'https://express.api.dhl.com/mydhlapi/test'
  const creado = Date.parse('2026-10-23T18:00:00Z')
  it('por referencia: shipmentReference + tipo CU + cuenta (obligatoria: DHL 400/1013 sin ella) + rango de fechas', () => {
    const u = new URL(urlRastreoPorReferencia(base, 'ref123', '987654321', creado))
    expect(u.pathname).toBe('/mydhlapi/test/tracking')
    expect(u.searchParams.get('shipmentReference')).toBe('ref123')
    expect(u.searchParams.get('shipmentReferenceType')).toBe('CU')
    expect(u.searchParams.get('shipperAccountNumber')).toBe('987654321')
    expect(u.searchParams.get('dateRangeFrom')).toBe('2026-10-22')
    expect(u.searchParams.get('dateRangeTo')).toBe('2026-10-25')
  })
  it('por número: la ruta de siempre; etiqueta: get-image con pickupYearAndMonth YYYY-MM (parámetro exigido por DHL)', () => {
    expect(urlRastreoPorNumero(base, '3143999482')).toBe(`${base}/shipments/3143999482/tracking?trackingView=all-checkpoints&levelOfDetail=all`)
    expect(mesRecoleccion(creado)).toBe('2026-10')
    const u = new URL(urlGetImage(base, '3143999482', '987654321', creado))
    expect(u.pathname).toBe('/mydhlapi/test/shipments/3143999482/get-image')
    expect(u.searchParams.get('pickupYearAndMonth')).toBe('2026-10')
    expect(u.searchParams.get('typeCode')).toBe('label')
    expect(u.searchParams.get('shipperAccountNumber')).toBe('987654321')
  })
  it('clasificación: 200 con envíos = encontradas; 200 vacío o 404 "No Shipments Found" = sin_resultados; 400/401/5xx = error', () => {
    expect(clasificarRastreo(200, { shipments: [{ shipmentTrackingNumber: '1' }] })).toBe('encontradas')
    expect(clasificarRastreo(200, { shipments: [] })).toBe('sin_resultados')
    expect(clasificarRastreo(404, { title: 'No data found', detail: 'No Shipments Found for ReferenceID | RCD1X' })).toBe('sin_resultados')
    expect(clasificarRastreo(404, { title: 'No data found', detail: 'No data found' })).toBe('sin_resultados')
    expect(clasificarRastreo(400, { detail: '1013: Either Shipper Account Number or Payer Account Number must be provided' })).toBe('error')
    expect(clasificarRastreo(401, {})).toBe('error')
    expect(clasificarRastreo(503, {})).toBe('error')
  })
  it('guías halladas: solo hechos de DHL (referencias de envío y de pieza, producto, CP destino, peso, piezas); nada se completa', () => {
    const g = guiasDeRastreo({ shipments: [{
      shipmentTrackingNumber: '3143999482', productCode: 'N', totalWeight: 1.2, numberOfPieces: 1,
      shipperReferences: [{ value: 'REF1', typeCode: 'CU' }], receiverDetails: { postalAddress: { postalCode: '44100', countryCode: 'MX' } },
      pieces: [{ shipperReferences: [{ value: 'REF1', typeCode: 'CU' }, { value: 'OTRA' }] }], events: [],
    }, { shipmentTrackingNumber: '', productCode: 'N' }] })
    expect(g).toEqual([{ tracking: '3143999482', referencias: ['REF1', 'OTRA'], producto: 'N', destino_cp: '44100', peso_total: 1.2, piezas: 1, eventos: 0 }])
    expect(guiasDeRastreo({ shipments: [{ shipmentTrackingNumber: '1' }] })[0]).toMatchObject({ producto: null, destino_cp: null, peso_total: null, piezas: null, referencias: [] })
    expect(parseGetImage({ documents: [{ typeCode: 'label', content: 'QUJD' }] })).toBe('QUJD')
    expect(parseGetImage({ documents: [] })).toBeNull()
  })
  it('consultarDHL: por referencia siempre; por número solo si Dirección lo aporta; un 404 es sin_resultados (realizada), un timeout es error (no realizada)', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/tracking?shipmentReference=')) return new Response(JSON.stringify({ title: 'No data found', detail: 'No Shipments Found for ReferenceID | abc' }), { status: 404 })
      return new Response(JSON.stringify({ shipments: [{ shipmentTrackingNumber: '3143999482', productCode: 'N', totalWeight: 1.2, numberOfPieces: 1, shipperReferences: [{ value: 'abc' }] }] }), { status: 200 })
    })
    const c = await consultarDHL({ base, authz: 'Basic x', account: '987654321', referencia: 'abc', creadoEnMs: creado, tracking: '3143999482', fetchImpl: fetchImpl as never })
    expect(c.referencia).toBe('abc')
    expect(c.por_referencia).toMatchObject({ realizada: true, resultado: 'sin_resultados', http: 404, encontradas: [] })
    expect(c.por_tracking).toMatchObject({ tracking: '3143999482', realizada: true, resultado: 'encontradas' })
    expect(c.por_tracking!.encontradas[0].tracking).toBe('3143999482')
    expect(calls).toHaveLength(2)
    const sinTn = await consultarDHL({ base, authz: 'Basic x', account: '987654321', referencia: 'abc', creadoEnMs: creado, fetchImpl: fetchImpl as never })
    expect(sinTn.por_tracking).toBeUndefined()
    // Nunca responde; solo obedece la señal de aborto (como un fetch real colgado).
    const lento = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })))))
    const t = await consultarDHL({ base, authz: 'Basic x', account: '987654321', referencia: 'abc', creadoEnMs: creado, fetchImpl: lento as never, timeoutMs: 20 })
    expect(t.por_referencia).toMatchObject({ realizada: false, resultado: 'error' })
    expect(decisionPrevia(t)).toBe('fallo')
  })
  it('decisión previa a recomprar: sin_resultados → proceder; encontradas → guia_hallada; error → fallo (fail-closed)', () => {
    const mk = (resultado: 'sin_resultados' | 'encontradas' | 'error', encontradas: Array<{ tracking: string }> = []) =>
      ({ consultado_en: '', referencia: 'r', por_referencia: { realizada: resultado !== 'error', resultado, encontradas: encontradas as never } })
    expect(decisionPrevia(mk('sin_resultados'))).toBe('proceder')
    expect(decisionPrevia(mk('encontradas', [{ tracking: '1' }]))).toBe('guia_hallada')
    expect(decisionPrevia(mk('error'))).toBe('fallo')
    expect(guiasDistintas({ ...mk('encontradas', [{ tracking: '1' }, { tracking: '1' }]), por_tracking: { tracking: '2', realizada: true, resultado: 'encontradas', encontradas: [{ tracking: '2' }] as never } })).toEqual(['1', '2'])
    expect(horasDesde('2026-10-23T10:00:00Z', Date.parse('2026-10-23T12:30:00Z'))).toBe(2.5)
  })
})

describe('Edge shipping · guardas D1 en el fuente', () => {
  const codigo = edgeSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('el id del intento se fija antes del claim y viaja como Message-Reference y como referencia CU; el snapshot `request` se guarda al reclamar', () => {
    expect(codigo).toMatch(/const attemptId = crypto\.randomUUID\(\)/)
    expect(codigo).toMatch(/const msgRef = attemptId/)
    expect(codigo).toMatch(/const referencia = referenciaIntento\(attemptId\)/)
    expect(codigo).toMatch(/\.insert\(\{ id: attemptId, order_id: orderId, provider: 'dhl'[^\n]*request: \{ shipper, receiver, pkg, productCode, orderRef \}/)
    expect(codigo).toMatch(/'Message-Reference': msgRef, 'Message-Reference-Date'/)
    expect(codigo).toMatch(/buildShipmentRequest\(shipper, receiver, pkg, account, productCode, orderRef, referencia\)/)
  })
  it('timeouts explícitos en cotización y guía de DHL (antes: fetch sin límite)', () => {
    expect(codigo).toMatch(/fetchConTimeout\(fetch, `\$\{base\}\/shipments`, [^\n]*TIMEOUT_GUIA_MS\)/)
    expect((codigo.match(/fetchConTimeout\(fetch, `\$\{base\}\/rates`, [^\n]*TIMEOUT_COTIZACION_MS\)/g) ?? []).length).toBe(2)
    expect(TIMEOUT_GUIA_MS).toBe(60_000); expect(TIMEOUT_COTIZACION_MS).toBe(30_000)
  })
  it('consulta previa a recomprar tras un cierre sin_guia: guía hallada → 409 sin claim; DHL sin respuesta → 503 sin claim', () => {
    const i = codigo.indexOf("eq('reconciliacion->>resolucion', 'sin_guia')")
    const claim = codigo.indexOf('const attemptId = crypto.randomUUID()')
    expect(i).toBeGreaterThan(0); expect(i).toBeLessThan(claim)
    expect(codigo).toMatch(/if \(decision === 'guia_hallada'\)[\s\S]{0,400}return json\(409, \{ error: 'guia_hallada_tarde'/)
    expect(codigo).toMatch(/if \(decision === 'fallo'\)[\s\S]{0,400}return json\(503, \{ error: 'consulta_previa_fallida'/)
  })
  it('reconciliar_guia: solo Dirección, consulta del servidor, RPC con la identidad del llamante (caller), etiqueta best-effort con la identidad de Dirección', () => {
    const bloque = codigo.slice(codigo.indexOf("if (action === 'reconciliar_guia')"), codigo.indexOf('// ===================== PROVIDER DHL'))
    expect(bloque).toMatch(/if \(!tieneRol\(q\.quien, \['admin'\]\)\) return json\(403/)
    expect(bloque).toMatch(/await consultarDHL\(\{ base, authz, account, referencia, creadoEnMs, tracking: trackingPortal, fetchImpl: fetch \}\)/)
    expect(bloque).toMatch(/caller\.rpc\('reconciliar_guia'/)
    expect(bloque).not.toMatch(/admin\.rpc\('reconciliar_guia'/)
    expect(bloque).toMatch(/portal_revisado: p\.portal_revisado === true, acepta_duplicado_tardio: p\.acepta_duplicado_tardio === true/)
    expect(bloque).toMatch(/caller\.from\('shipments'\)\.update\(\{ label_path: path \}\)/)
    expect(bloque).not.toMatch(/encontradas:\s*p\./)   // la evidencia nunca viene del cliente
  })
})

describe('migración 190 · comando reconciliar_guia', () => {
  it('solo Dirección, idempotente por op_id, sin grant a service_role; sin_guia exige 60 min, sin hallazgos, portal, motivo y riesgo aceptado', () => {
    expect(migSrc).toMatch(/if v_rol is distinct from 'admin' then\s+raise exception 'NO_AUTORIZADO/)
    expect(migSrc).toMatch(/_w1_op_begin\(p_op_id, 'reconciliacion_guia', v_req\)/)
    expect(migSrc).toMatch(/revoke all on function public\.reconciliar_guia\(uuid, uuid, text, jsonb, text, text\) from public, anon, authenticated, service_role/)
    expect(migSrc).toMatch(/grant execute on function public\.reconciliar_guia\(uuid, uuid, text, jsonb, text, text\) to authenticated;/)
    for (const e of ['CIERRE_PREMATURO', 'HALLAZGOS_EXISTEN', 'REVISION_REQUERIDA', 'RIESGO_NO_ACEPTADO', 'CONSULTA_CADUCA', 'CONSULTA_INCOMPLETA', 'CONSULTA_AJENA', 'MOTIVO_REQUERIDO']) expect(migSrc).toContain(e)
    expect(migSrc).toMatch(/interval '60 minutes'/); expect(migSrc).toMatch(/interval '30 minutes'/)
  })
  it('guia_confirmada exige referencia, servicio, CP de destino, peso ±10 % y piezas del snapshot; una sola guía; nunca inventa costo', () => {
    for (const e of ['TRACKING_REQUERIDO', 'TRACKING_INVALIDO', 'SIN_SNAPSHOT', 'AMBIGUO', 'COINCIDENCIA_INSUFICIENTE', 'GUIA_YA_REGISTRADA']) expect(migSrc).toContain(e)
    expect(migSrc).toMatch(/v_peso \* 0\.10/)
    expect(migSrc).toMatch(/'provider_cost', a\.provider_cost/)
    expect(migSrc).toMatch(/'costo_pendiente', true/)
    expect(migSrc).toMatch(/public\.finalize_shipment\(a\.id, jsonb_build_object\(/)
    expect(migSrc).not.toMatch(/create or replace function public\.finalize_shipment/)
  })
})
