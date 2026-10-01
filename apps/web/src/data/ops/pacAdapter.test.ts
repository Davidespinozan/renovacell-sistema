// W3-B · B3 — El adaptador del PAC, probado SOLO contra un proveedor SIMULADO.
// Nada de este archivo toca Facturama. `fetch` se inyecta, que es justamente por lo que
// el adaptador lo recibe como dependencia.
//
// La regla que se protege: un resultado solo es `fallido` cuando se DEMUESTRA que el
// proveedor no produjo efecto. Todo lo demás es `incierto`. Un timeout nunca es "no se timbró".
import { describe, it, expect, vi } from 'vitest'
import {
  clasificarRespuesta, uuidValido, sanitiza, timbrarEnPAC, buscarPorSerieFolio,
  buscarPorOrderNumber, consultarEstatusSAT, construirCFDI, ConstruccionFiscalPendiente,
  TIMEOUT_PAC_MS, PAGINA_MAX_REGISTROS, PAGINAS_MAX,
} from '../../../../../supabase/functions/_shared/pac'

const UUID = 'a1b2c3d4-1111-2222-3333-444455556666'
const deps = (f: typeof fetch) => ({ fetch: f, base: 'https://pac.simulado.local', auth: 'Basic ***' })

// PAC simulado: responde lo que la prueba le dicte, y registra lo que recibió.
function pacFalso(respuestas: Array<{ status: number; body: unknown } | { lanza: Error }>) {
  const llamadas: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init })
    const r = respuestas[Math.min(i, respuestas.length - 1)]; i += 1
    if ('lanza' in r) throw r.lanza
    return { status: r.status, json: async () => r.body } as unknown as Response
  })
  return { f: f as unknown as typeof fetch, llamadas }
}

describe('uuidValido · solo un folio fiscal real cuenta como prueba', () => {
  it('acepta un UUID bien formado, en cualquier caja', () => {
    expect(uuidValido(UUID)).toBe(true)
    expect(uuidValido(UUID.toUpperCase())).toBe(true)
  })
  it('rechaza lo que NO es prueba de timbrado', () => {
    for (const v of ['', '   ', 'SAT-REAL-1', undefined, null, 123, {},
                     '00000000-0000-0000-0000-000000000000', 'a1b2c3d4-1111-2222-3333-44445555666']) {
      expect(uuidValido(v)).toBe(false)
    }
  })
})

describe('clasificarRespuesta · la tabla congelada', () => {
  it('2xx con UUID válido → timbrado, con los datos del proveedor', () => {
    const r = clasificarRespuesta(201, {
      Id: 'FAC-1', Folio: '7', Serie: 'REN', Date: '2026-10-01T10:00:00',
      Complement: { TaxStamp: { Uuid: UUID } },
    })
    expect(r).toMatchObject({ clase: 'timbrado', uuid: UUID, providerRef: 'FAC-1', folioProveedor: '7', serieProveedor: 'REN' })
  })
  it('2xx SIN UUID → incierto, nunca timbrado', () => {
    for (const body of [{}, { Id: 'FAC-1' }, { Complement: {} }, { Uuid: '' },
                        { Uuid: '00000000-0000-0000-0000-000000000000' }]) {
      expect(clasificarRespuesta(200, body)).toMatchObject({ clase: 'incierto', code: 'respuesta_sin_uuid' })
    }
  })
  it('400 → fallido (validación demostrada, sin efecto)', () => {
    expect(clasificarRespuesta(400, { Message: 'RFC inválido' }))
      .toMatchObject({ clase: 'fallido', code: 'validacion', message: 'RFC inválido' })
  })
  it('401 y 403 → fallido de configuración, sin filtrar el detalle del proveedor', () => {
    for (const s of [401, 403]) {
      const r = clasificarRespuesta(s, { Message: 'user secreto' })
      expect(r.clase).toBe('fallido')
      expect(r.code).toBe('configuracion')
      expect(r.message).not.toMatch(/secreto/)
    }
  })
  it('404 → fallido', () => {
    expect(clasificarRespuesta(404, {})).toMatchObject({ clase: 'fallido', code: 'no_encontrado' })
  })
  it('5xx → incierto: el proveedor pudo haber timbrado', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(clasificarRespuesta(s, {})).toMatchObject({ clase: 'incierto', code: 'error_proveedor' })
    }
  })
  it('códigos inesperados → incierto, no fallido', () => {
    for (const s of [301, 418, 429]) expect(clasificarRespuesta(s, {}).clase).toBe('incierto')
  })
  it('NO existe un camino de 409/duplicado: 409 cae en incierto', () => {
    // La documentación del proveedor no define 409. No se inventa semántica.
    expect(clasificarRespuesta(409, {}).clase).toBe('incierto')
  })
})

describe('timbrarEnPAC · red y tiempo', () => {
  it('timeout → incierto (un timeout NO es "no se timbró")', async () => {
    const e = new Error('abortado'); e.name = 'AbortError'
    const { f } = pacFalso([{ lanza: e }])
    expect(await timbrarEnPAC(deps(f), {})).toMatchObject({ clase: 'incierto', code: 'timeout' })
  })
  it('error de red → incierto', async () => {
    const { f } = pacFalso([{ lanza: new TypeError('Failed to fetch') }])
    expect(await timbrarEnPAC(deps(f), {})).toMatchObject({ clase: 'incierto', code: 'red' })
  })
  it('el timeout está acotado y pasa un AbortSignal', async () => {
    expect(TIMEOUT_PAC_MS).toBe(30_000)
    const { f, llamadas } = pacFalso([{ status: 200, body: { Complement: { TaxStamp: { Uuid: UUID } } } }])
    await timbrarEnPAC(deps(f), { Folio: '1' })
    expect(llamadas[0].init?.signal).toBeDefined()
    expect(llamadas[0].url).toBe('https://pac.simulado.local/3/cfdis')
  })
  it('envía el payload tal cual, sin recalcular la identidad', async () => {
    const { f, llamadas } = pacFalso([{ status: 200, body: { Complement: { TaxStamp: { Uuid: UUID } } } }])
    await timbrarEnPAC(deps(f), { Folio: '42', Date: '2026-10-01T09:30:00', OrderNumber: 'doc-1' })
    const enviado = JSON.parse(String(llamadas[0].init?.body))
    expect(enviado).toMatchObject({ Folio: '42', Date: '2026-10-01T09:30:00', OrderNumber: 'doc-1' })
  })
})

describe('sanitiza · las credenciales nunca salen', () => {
  it('oculta Basic, Bearer y pares clave/valor sensibles', () => {
    expect(sanitiza('Authorization: Basic dXNlcjpwYXNz')).not.toMatch(/dXNlcjpwYXNz/)
    expect(sanitiza('Bearer eyJhbGciOi.abc-123')).not.toMatch(/eyJhbGciOi/)
    expect(sanitiza('{"password":"s3cr3t","x":1}')).not.toMatch(/s3cr3t/)
    expect(sanitiza('apikey=ABC123')).not.toMatch(/ABC123/)
  })
  it('acota la longitud', () => {
    expect(sanitiza('x'.repeat(5000)).length).toBeLessThanOrEqual(400)
  })
})

describe('búsqueda de huérfano · acotada y por la identidad que controlamos', () => {
  it('consulta por Serie y folio exacto, sin mezclar rangos', async () => {
    const { f, llamadas } = pacFalso([{ status: 200, body: [] }])
    await buscarPorSerieFolio(deps(f), 'REN', '7')
    const u = new URL(llamadas[0].url)
    expect(u.pathname).toBe('/cfdi')
    expect(u.searchParams.get('type')).toBe('issued')
    expect(u.searchParams.get('Serie')).toBe('REN')
    expect(u.searchParams.get('folio')).toBe('7')
    expect(u.searchParams.get('page')).toBe('0')
    // La documentación advierte que combinar folio con rangos filtra mal.
    expect(u.searchParams.get('folioStart')).toBeNull()
    expect(u.searchParams.get('folioEnd')).toBeNull()
  })
  it('vacío es "vacio", no "no existe"', async () => {
    const { f } = pacFalso([{ status: 200, body: [] }])
    expect(await buscarPorSerieFolio(deps(f), 'REN', '7')).toEqual({ outcome: 'vacio' })
  })
  it('un solo resultado → encontrado, con su UUID', async () => {
    const { f } = pacFalso([{ status: 200, body: [{ Id: 'FAC-1', Folio: '7', Serie: 'REN', Uuid: UUID, Status: 'active' }] }])
    const r = await buscarPorSerieFolio(deps(f), 'REN', '7')
    expect(r.outcome).toBe('encontrado')
    if (r.outcome === 'encontrado') expect(r.candidatos[0]).toMatchObject({ uuid: UUID, providerRef: 'FAC-1', folio: '7' })
  })
  it('varios resultados → multiple (revisión manual, nunca autocorrección)', async () => {
    const { f } = pacFalso([{ status: 200, body: [{ Uuid: UUID }, { Uuid: UUID.replace('a1', 'b2') }] }])
    expect((await buscarPorSerieFolio(deps(f), 'REN', '7')).outcome).toBe('multiple')
  })
  it('la paginación tiene tope duro: no hay barrido del proveedor', async () => {
    // El PAC simulado devuelve SIEMPRE una página llena: sin tope sería infinito.
    const llena = { status: 200, body: Array.from({ length: PAGINA_MAX_REGISTROS }, () => ({ Uuid: UUID })) }
    const { f, llamadas } = pacFalso([llena])
    await buscarPorSerieFolio(deps(f), 'REN', '7')
    expect(llamadas.length).toBe(PAGINAS_MAX)
    expect(PAGINAS_MAX).toBeLessThanOrEqual(5)
  })
  it('una página incompleta termina la consulta', async () => {
    const { f, llamadas } = pacFalso([{ status: 200, body: [{ Uuid: UUID }] }])
    await buscarPorSerieFolio(deps(f), 'REN', '7')
    expect(llamadas.length).toBe(1)
  })
  it('un error de red en la consulta es "error", no "vacio"', async () => {
    const { f } = pacFalso([{ lanza: new TypeError('Failed to fetch') }])
    expect(await buscarPorSerieFolio(deps(f), 'REN', '7')).toMatchObject({ outcome: 'error', code: 'red' })
  })
  it('la llave secundaria usa OrderNumber', async () => {
    const { f, llamadas } = pacFalso([{ status: 200, body: [] }])
    await buscarPorOrderNumber(deps(f), 'doc-abc')
    expect(new URL(llamadas[0].url).searchParams.get('OrderNumber')).toBe('doc-abc')
  })
})

describe('estatus ante el SAT · la autoridad final', () => {
  it('envía la identidad congelada completa, con el total a dos decimales', async () => {
    const { f, llamadas } = pacFalso([{ status: 200, body: { Status: 'Vigente', IsCancelable: 'Cancelable sin aceptación' } }])
    const r = await consultarEstatusSAT(deps(f), UUID, 'AAA010101AAA', 'XAXX010101000', 1160)
    const u = new URL(llamadas[0].url)
    expect(u.pathname).toBe('/cfdi/status')
    expect(u.searchParams.get('uuid')).toBe(UUID)
    expect(u.searchParams.get('issuerRfc')).toBe('AAA010101AAA')
    expect(u.searchParams.get('receiverRfc')).toBe('XAXX010101000')
    expect(u.searchParams.get('total')).toBe('1160.00')
    expect(r).toMatchObject({ ok: true, status: 'Vigente' })
  })
  it('reconoce los tres estatus documentados y rechaza cualquier otro', async () => {
    for (const s of ['Vigente', 'Cancelado', 'No encontrado']) {
      const { f } = pacFalso([{ status: 200, body: { Status: s } }])
      expect(await consultarEstatusSAT(deps(f), UUID, 'A', 'B', 1)).toMatchObject({ ok: true, status: s })
    }
    const { f } = pacFalso([{ status: 200, body: { Status: 'Raro' } }])
    expect(await consultarEstatusSAT(deps(f), UUID, 'A', 'B', 1)).toMatchObject({ ok: false, code: 'estatus_desconocido' })
  })
  it('no consulta con un UUID inválido', async () => {
    const { f, llamadas } = pacFalso([{ status: 200, body: {} }])
    expect(await consultarEstatusSAT(deps(f), 'nope', 'A', 'B', 1)).toMatchObject({ ok: false, code: 'uuid_invalido' })
    expect(llamadas.length).toBe(0)
  })
})

describe('construcción del comprobante · D-W3-4 sigue abierta', () => {
  const id = {
    serie: 'REN', folio: '7', providerDateSent: '2026-10-01T09:30:00',
    orderNumber: 'doc-1', expeditionPlace: '80000', currency: 'MXN',
    receiver: { Rfc: 'XAXX010101000', Name: 'X', CfdiUse: 'G03', FiscalRegime: '601', TaxZipCode: '80000' },
  }
  it('SIN renglones se niega a construir: no se inventa política fiscal', () => {
    expect(() => construirCFDI(id, null)).toThrow(ConstruccionFiscalPendiente)
    expect(() => construirCFDI(id, [])).toThrow(ConstruccionFiscalPendiente)
    try { construirCFDI(id, null) } catch (e) {
      expect((e as ConstruccionFiscalPendiente).code).toBe('construccion_fiscal_pendiente')
    }
  })
  it('con renglones dados, reutiliza la identidad congelada sin recalcular nada', () => {
    const c = construirCFDI(id, [{ x: 1 }])
    expect(c).toMatchObject({
      Serie: 'REN', Folio: '7', Date: '2026-10-01T09:30:00', OrderNumber: 'doc-1',
      CfdiType: 'I', ExpeditionPlace: '80000', Currency: 'MXN',
    })
  })
  it('el adaptador NO contiene tasas ni claves fiscales inventadas', async () => {
    const src = await import('../../../../../supabase/functions/_shared/pac.ts?raw')
    const codigo = (src.default as string).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(codigo).not.toMatch(/0\.16/)
    expect(codigo).not.toMatch(/51241100/)
    expect(codigo).not.toMatch(/'PUE'|'PPD'/)
    expect(codigo).not.toMatch(/IVA/)
  })
})
