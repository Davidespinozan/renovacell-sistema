// META-02 · diagnóstico seguro del webhook de Meta: el módulo puro (canal, cuenta, correlación, clasificación, línea) y las
// guardas de fuente de meta-webhook (cada camino de 500 y de 401/400 deja una línea; nunca textos, teléfonos, nombres ni ids
// completos; los códigos HTTP y los reintentos de Meta no cambian).
import { describe, it, expect } from 'vitest'
import { canalDe, cuentaDe, correlacion, clasificarError, lineaDiagnostico } from '../../../../../supabase/functions/_shared/metaDiagnostico'
import webhook from '../../../../../supabase/functions/meta-webhook/index.ts?raw'
import diagSrc from '../../../../../supabase/functions/_shared/metaDiagnostico.ts?raw'

const WA = { object: 'whatsapp_business_account', entry: [{ id: '916038264473218', changes: [{ field: 'messages', value: { messages: [{ from: '5216671234567', id: 'wamid.HBgNNTIxNjY3MTIzNDU2NxUCABIYFDNBMEY3', type: 'text', text: { body: 'Hola, quiero cotizar' } }] } }] }] }
const IG = { object: 'instagram', entry: [{ id: '17841400000000001', messaging: [{ sender: { id: '1234567890123456' }, recipient: { id: '17841400000000001' }, message: { mid: 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQ', text: 'Precio?' } }] }] }
const PG = { object: 'page', entry: [{ id: '1000000000000001', messaging: [{ sender: { id: '7000000000000001' }, message: { mid: 'm_ABC123456789', text: 'Hola' } }] }] }

describe('META-02 · módulo puro de diagnóstico', () => {
  it('canal por objeto; cuenta = cola de 4 del id de la WABA/página; correlación = hash corto estable del identificador técnico', () => {
    expect(canalDe(WA)).toBe('whatsapp'); expect(canalDe(IG)).toBe('instagram'); expect(canalDe(PG)).toBe('messenger'); expect(canalDe({ object: 'user' })).toBe('desconocido'); expect(canalDe(null)).toBe('desconocido')
    expect(cuentaDe(WA)).toBe('…3218'); expect(cuentaDe(IG)).toBe('…0001'); expect(cuentaDe({})).toBe(''); expect(cuentaDe({ entry: [{ id: 0 }] })).toBe('…0')
    const c = correlacion('wamid.HBgNNTIxNjY3MTIzNDU2NxUCABIYFDNBMEY3')
    expect(c).toMatch(/^[0-9a-f]{8}$/); expect(correlacion('wamid.HBgNNTIxNjY3MTIzNDU2NxUCABIYFDNBMEY3')).toBe(c); expect(correlacion('otro')).not.toBe(c)
    expect(c).not.toContain('5216671234567'); expect(c.length).toBe(8)
  })
  it('clasifica errores de la base y excepciones SIN copiar el texto: validación (23514/P0001 con etiqueta), autorización (42501/NO_AUTORIZADO), base de datos, excepción', () => {
    expect(clasificarError({ code: 'P0001', message: 'WA_SIN_TEXTO', details: null, hint: null })).toEqual({ causa: 'validacion', codigo: 'WA_SIN_TEXTO' })
    expect(clasificarError({ code: '23514', message: 'META_DATOS_INVALIDOS' })).toEqual({ causa: 'validacion', codigo: 'META_DATOS_INVALIDOS' })
    expect(clasificarError({ code: 'P0001', message: 'CUENTA_SUSPENDIDA' })).toEqual({ causa: 'validacion', codigo: 'CUENTA_SUSPENDIDA' })
    expect(clasificarError({ code: 'P0001', message: 'IA_SILENCIADA: modo human_assigned' })).toEqual({ causa: 'validacion', codigo: 'IA_SILENCIADA' })
    expect(clasificarError({ code: '42501', message: 'permission denied for function cc_wa_entrante' })).toEqual({ causa: 'autorizacion', codigo: '42501' })
    expect(clasificarError({ code: 'P0001', message: 'NO_AUTORIZADO' })).toEqual({ causa: 'autorizacion', codigo: 'NO_AUTORIZADO' })
    expect(clasificarError({ code: '23505', message: 'duplicate key value violates unique constraint "uq_x" Key (wa_id)=(5216671234567) already exists' })).toEqual({ causa: 'base_datos', codigo: '23505' })
    expect(clasificarError({ code: '57014', message: 'canceling statement due to statement timeout' })).toEqual({ causa: 'base_datos', codigo: '57014' })
    expect(clasificarError({ code: 'PGRST301', message: 'JWT expired' })).toEqual({ causa: 'base_datos', codigo: 'PGRST301' })
    expect(clasificarError(new TypeError('fetch failed: https://x.supabase.co token abc'))).toEqual({ causa: 'excepcion', codigo: 'TypeError' })
    expect(clasificarError('cadena')).toEqual({ causa: 'excepcion', codigo: 'desconocido' })
    // un mensaje con datos de la persona nunca pasa al código
    const e = clasificarError({ code: 'P0001', message: 'WA_DATOS_INVALIDOS: from=5216671234567 nombre=Juan Pérez texto=Hola doctor' })
    expect(e).toEqual({ causa: 'validacion', codigo: 'WA_DATOS_INVALIDOS' })
  })
  it('línea estable con prefijo fijo y solo campos técnicos; recorta y nunca incluye lo que no se le pasa', () => {
    const l = lineaDiagnostico({ canal: 'instagram', etapa: 'meta_entrante', causa: 'validacion', codigo: 'META_DATOS_INVALIDOS', http: 500, correlacion: 'deadbeef', cuenta: '…0001' })
    expect(l).toBe('meta-webhook {"canal":"instagram","etapa":"meta_entrante","causa":"validacion","codigo":"META_DATOS_INVALIDOS","http":500,"correlacion":"deadbeef","cuenta":"…0001"}')
    const r = lineaDiagnostico({ canal: 'whatsapp', etapa: 'recibido', causa: 'ok', codigo: 'ok', http: 200, conteo: { wa: 1, estados: 2, meta: 0 } })
    expect(JSON.parse(r.slice('meta-webhook '.length))).toEqual({ canal: 'whatsapp', etapa: 'recibido', causa: 'ok', codigo: 'ok', http: 200, conteo: { wa: 1, estados: 2, meta: 0 } })
    expect(lineaDiagnostico({ canal: 'messenger', etapa: 'procesar', causa: 'excepcion', codigo: 'X'.repeat(80), http: 500, correlacion: 'y'.repeat(40) })).toHaveLength(('meta-webhook ' + JSON.stringify({ canal: 'messenger', etapa: 'procesar', causa: 'excepcion', codigo: 'X'.repeat(40), http: 500, correlacion: 'y'.repeat(16) })).length)
    // el módulo no acepta ni serializa textos, teléfonos ni nombres: no existe ningún campo para ellos
    const codigoSinComentarios = diagSrc.split('\n').filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l)).map((l) => l.replace(/\/\/.*$/, '').replace(/\/\*\*.*?\*\//g, '')).join('\n')
    expect(codigoSinComentarios).not.toMatch(/texto|nombre|wa_id|psid|telefono|phone|token/i)
  })
})

describe('META-02 · guardas de fuente de meta-webhook', () => {
  const src = webhook.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  /** Argumento completo de cada diag({…}) (con llaves anidadas), para revisar SOLO lo que se registra. */
  const diags: string[] = []
  for (let i = src.indexOf('diag({'); i >= 0; i = src.indexOf('diag({', i + 1)) {
    let n = 0, j = i + 'diag('.length
    for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}') { n--; if (n === 0) break } }
    diags.push(src.slice(i, j + 1))
  }
  it('cada camino deja su línea: firma 401, JSON 400, estado WA (200, no bloquea), WA entrante 500, Meta entrante 500, excepción 500 y resumen 200', () => {
    expect(src).toMatch(/const diag = \(d: Diagnostico\) => console\.error\(lineaDiagnostico\(d\)\)/)
    expect(src).toMatch(/etapa: 'firma', causa: 'autorizacion', codigo: 'firma_invalida', http: 401[^\n]*\n\s*return new Response\('Firma inválida', \{ status: 401 \}\)/)
    expect(src).toMatch(/etapa: 'json', causa: 'validacion', codigo: 'json_invalido', http: 400 \}\); return new Response\('JSON inválido', \{ status: 400 \}\)/)
    expect(src).toMatch(/try \{ const \{ error: eEst \} = await admin\.rpc\('cc_wa_estado'[^\n]*if \(eEst\) diag\(\{ canal: 'whatsapp', etapa: 'wa_estado', \.\.\.clasificarError\(eEst\), http: 200/)
    expect(src).toMatch(/catch \(ex\) \{ diag\(\{ canal: 'whatsapp', etapa: 'wa_estado', \.\.\.clasificarError\(ex\), http: 200/)
    expect(src).toMatch(/if \(error\) \{ obs\('whatsapp', 'internal_error', \{ code: 'cc_wa_entrante', error \}\); diag\(\{ canal: 'whatsapp', etapa: 'wa_entrante', \.\.\.clasificarError\(error\), http: 500, correlacion: correlacion\(m\.wamid\), cuenta \}\); return new Response\('reintentar', \{ status: 500 \}\)/)
    expect(src).toMatch(/if \(error\) \{ obs\('meta', 'internal_error', \{ code: 'cc_meta_entrante', error \}\); diag\(\{ canal: m\.canal, etapa: 'meta_entrante', \.\.\.clasificarError\(error\), http: 500, correlacion: correlacion\(m\.mid\), cuenta \}\); return new Response\('reintentar', \{ status: 500 \}\)/)
    expect(src).toMatch(/diag\(\{ canal, etapa: 'procesar', \.\.\.clasificarError\(e\), http: 500, cuenta \}\)\n\s*obs\('procesar', 'internal_error', \{ code: 'exception', error: e \}\)\n\s*throw e/)
    expect(src).toMatch(/diag\(\{ canal, etapa: 'recibido', causa: 'ok', codigo: 'ok', http: 200, cuenta, conteo: \{ wa: wa\.length, estados: estados\.length, meta: mt\.length \} \}\)\n\s*return new Response\(JSON\.stringify\(\{ received: true \}\), \{ status: 200/)
    expect(diags).toHaveLength(8)
  })
  it('ninguna línea de diagnóstico lleva contenido ni identificadores de personas; los códigos HTTP y el orden firma→parseo→proceso no cambian', () => {
    expect(diags).toHaveLength(8)
    for (const l of diags) expect(l).not.toMatch(/m\.texto|m\.wa_id|m\.nombre|m\.psid|e\.error\b|\bbody\b|payload\b|JSON\.stringify|error\.message|error\.details|appSecret|verifyToken|Authorization|\.estado\b/)
    expect(src).not.toMatch(/console\.(log|error)\([^\n]*(m\.texto|m\.wa_id|m\.psid|m\.nombre|body)/)
    const iFirma = src.indexOf('validSignature(body'), iParse = src.indexOf('payload = JSON.parse(body)'), iCanal = src.indexOf('const canal = canalDe(payload), cuenta = cuentaDe(payload)'), iTry = src.indexOf('try {\n', iCanal)
    expect(iFirma).toBeGreaterThan(0); expect(iParse).toBeGreaterThan(iFirma); expect(iCanal).toBeGreaterThan(iParse); expect(iTry).toBeGreaterThan(iCanal)
    expect((src.match(/status: 500/g) ?? []).length).toBe(2)   // los mismos dos retornos de 500 de siempre (más el throw)
    expect(src).toMatch(/return new Response\('Meta no configurado', \{ status: 501 \}\)/)
    expect((src.match(/\bobs\(/g) ?? []).length).toBe(3)   // la telemetría W6 no cambia
    expect(src).not.toMatch(/p_encolar: true|modo = 'activo'|cc_wa_config|cc_meta_config/)   // nada de activación ni de reglas de IA
  })
})
