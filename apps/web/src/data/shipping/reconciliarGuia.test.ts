// DHL D1 · módulo de datos de la reconciliación: transporta la decisión de Dirección, nunca la evidencia; traduce los
// rechazos del servidor; una respuesta sin código de negocio es DESCONOCIDA (reintentar con el mismo opId es seguro).
import { describe, it, expect, vi } from 'vitest'
import { consultarReconciliacion, resolverReconciliacion, mensajeReconciliar } from './reconciliarGuia'

const datos = {
  intento: { id: 'A-1', creado: '2026-10-23T18:00:00Z', actualizado: null, horas: 2.1, referencia: 'abc', servicio: 'N', con_snapshot: true, costo: null, moneda: null },
  consulta: { consultado_en: '2026-10-23T20:00:00Z', referencia: 'abc', por_referencia: { realizada: true, resultado: 'sin_resultados' as const, encontradas: [] } },
  guias_distintas: [], reglas: { minutos_minimos_sin_guia: 60, minutos_vigencia_consulta: 30, advertencia: 'Un 404 de DHL no prueba que la guía no exista.' },
}
const respuestaError = (status: number, body: unknown) => ({ data: null, error: { message: `Edge Function returned a non-2xx status code`, context: new Response(JSON.stringify(body), { status }) } })

describe('consultar', () => {
  it('pide consultar al servidor con el pedido y, si lo hay, el número del portal; no manda nada más', async () => {
    const inv = vi.fn(async () => ({ data: datos, error: null }))
    const r = await consultarReconciliacion('O-1', ' 3143999482 ', inv as never)
    expect(inv).toHaveBeenCalledWith({ action: 'reconciliar_guia', sub: 'consultar', order_id: 'O-1', tracking: ' 3143999482 ' })
    expect(r).toEqual({ ok: true, datos })
    await consultarReconciliacion('O-1', undefined, inv as never)
    expect(inv).toHaveBeenLastCalledWith({ action: 'reconciliar_guia', sub: 'consultar', order_id: 'O-1' })
  })
  it('traduce los rechazos del servidor (403 solo Dirección, 404 sin intento, 501 sin configurar)', async () => {
    expect(await consultarReconciliacion('O-1', undefined, (async () => respuestaError(403, { error: 'solo_direccion' })) as never)).toEqual({ ok: false, error: 'Solo Dirección puede resolver un intento en estado desconocido.' })
    expect(await consultarReconciliacion('O-1', undefined, (async () => respuestaError(404, { error: 'sin_intento_desconocido' })) as never)).toMatchObject({ ok: false, error: /ya no tiene un intento/ })
    expect(await consultarReconciliacion('O-1', undefined, (async () => respuestaError(501, { error: 'not_configured' })) as never)).toMatchObject({ ok: false, error: /DHL no está configurado/ })
  })
})

describe('resolver', () => {
  it('manda la decisión, el motivo, el op_id y las confirmaciones como booleanos; nunca evidencia (encontradas, consultado_en)', async () => {
    const inv = vi.fn(async (_body: Record<string, unknown>) => ({ data: { resultado: { status: 'applied', resolucion: 'sin_guia', order_status: 'packed' }, etiqueta: 'no_aplica' }, error: null }))
    const r = await resolverReconciliacion('O-1', { resolucion: 'sin_guia', motivo: 'Revisé portal y DHL', opId: 'OP-1', portalRevisado: true, aceptaDuplicadoTardio: true }, inv as never)
    expect(inv).toHaveBeenCalledWith({ action: 'reconciliar_guia', sub: 'resolver', order_id: 'O-1', op_id: 'OP-1', resolucion: 'sin_guia', motivo: 'Revisé portal y DHL', portal_revisado: true, acepta_duplicado_tardio: true })
    const enviado = JSON.stringify(inv.mock.calls[0][0])
    expect(enviado).not.toMatch(/encontradas|consultado_en|por_referencia/)
    expect(r.ok).toBe(true)
  })
  it('con tracking lo manda; la confirmación de guía responde con la etiqueta y el costo pendiente', async () => {
    const inv = vi.fn(async (_body: Record<string, unknown>) => ({ data: { resultado: { status: 'applied', resolucion: 'guia_confirmada', tracking: '3143999482', order_status: 'shipped', costo_pendiente: true }, etiqueta: 'guardada' }, error: null }))
    const r = await resolverReconciliacion('O-1', { resolucion: 'guia_confirmada', motivo: 'Aparece con la referencia', opId: 'OP-2', tracking: '3143999482', portalRevisado: false, aceptaDuplicadoTardio: false }, inv as never)
    expect(inv.mock.calls[0][0]).toMatchObject({ tracking: '3143999482', portal_revisado: false, acepta_duplicado_tardio: false })
    expect(r).toMatchObject({ ok: true, datos: { etiqueta: 'guardada', resultado: { tracking: '3143999482', costo_pendiente: true } } })
  })
  it('rechazos con código de negocio del comando: mensaje claro y NO ambiguo; el detalle de la coincidencia se conserva', async () => {
    const r1 = await resolverReconciliacion('O-1', { resolucion: 'sin_guia', motivo: 'x'.repeat(12), opId: 'OP', portalRevisado: true, aceptaDuplicadoTardio: true }, (async () => respuestaError(409, { error: 'CIERRE_PREMATURO', message: 'CIERRE_PREMATURO: espera al menos 60 minutos' })) as never)
    expect(r1).toEqual({ ok: false, error: 'Aún no pasaron 60 minutos desde el intento. Espera antes de resolver sin guía.', ambiguo: false })
    const r2 = await resolverReconciliacion('O-1', { resolucion: 'guia_confirmada', motivo: 'x'.repeat(12), opId: 'OP', tracking: '3143999482', portalRevisado: false, aceptaDuplicadoTardio: false }, (async () => respuestaError(409, { error: 'COINCIDENCIA_INSUFICIENTE', message: 'COINCIDENCIA_INSUFICIENTE: el CP de destino de la guía (44600) no es el del pedido (44100)' })) as never)
    expect(r2).toMatchObject({ ok: false, ambiguo: false, error: /No se registra\. Detalle: el CP de destino de la guía \(44600\)/ })
    for (const code of ['HALLAZGOS_EXISTEN', 'REVISION_REQUERIDA', 'RIESGO_NO_ACEPTADO', 'AMBIGUO', 'SIN_SNAPSHOT', 'GUIA_YA_REGISTRADA', 'CONSULTA_CADUCA']) expect(mensajeReconciliar(code)).not.toMatch(/No se pudo completar/)
  })
  it('sin código de negocio (5xx, red) el resultado es desconocido: ambiguo=true y se invita a reintentar con el mismo opId', async () => {
    const r = await resolverReconciliacion('O-1', { resolucion: 'sin_guia', motivo: 'x'.repeat(12), opId: 'OP', portalRevisado: true, aceptaDuplicadoTardio: true }, (async () => ({ data: null, error: { message: 'FunctionsFetchError: Failed to send a request' } })) as never)
    expect(r).toMatchObject({ ok: false, ambiguo: true, error: /no se aplicará dos veces/ })
    const r2 = await resolverReconciliacion('O-1', { resolucion: 'sin_guia', motivo: 'x'.repeat(12), opId: 'OP', portalRevisado: true, aceptaDuplicadoTardio: true }, (async () => { throw new Error('red') }) as never)
    expect(r2).toMatchObject({ ok: false, ambiguo: true })
  })
})
