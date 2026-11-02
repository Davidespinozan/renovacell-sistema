// Edge Function: CFDI — TIMBRADO REAL (2 nov 2026), sobre el camino seguro de W3 (se despliega con --no-verify-jwt; valida
// el JWT ella misma y solo atiende a Dirección/Facturación).
//
// Por qué la versión anterior se contuvo (W3-A): un timeout tras un timbrado real hacía que el cliente borrara la
// evidencia y volviera a ofrecer "Emitir" → dos CFDI ante el SAT. Este camino no puede repetir eso:
//   · La intención es durable (fiscal_documents) y el reclamo atómico fija serie, folio y Date ANTES de salir al PAC.
//   · Todo lo que no demuestra "no hubo efecto" es `incierto` y NO se reintenta: se concilia por serie+folio, o se
//     reenvía con la MISMA identidad (Facturama deduplica por Folio+Date) dentro de la ventana segura.
//   · Antes del reclamo se arma el comprobante completo (cfdiConceptos.ts): si a un producto le faltan claves
//     validadas, si no cuadra el total o si la forma de pago es ambigua, se responde qué falta y NO se consume folio.
//   · El entorno es explícito (FACTURAMA_ENV = sandbox | produccion, sin default) y queda guardado en cada documento.
//
// Acciones (POST { accion, doc_id | order_id, forma_pago? }):
//   preparar  · vista previa: conceptos, IVA, total, forma de pago y lo que falta. Sin escribir nada.
//   timbrar   · reclama, timbra, registra el resultado y manda el CFDI al correo del receptor.
//   conciliar · para una solicitud incierta (o un reclamo abandonado): busca por serie+folio; si existe, la adopta; si no
//               y la ventana lo permite, reenvía con la misma identidad.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { conCors } from '../_shared/cors.ts'
import { resolverQuien, tieneRol } from '../_shared/quien.ts'
import { resolverFacturama } from '../_shared/facturama.ts'
import { buscarPorSerieFolio, sanitiza, timbrarEnPAC, type DepsPAC } from '../_shared/pac.ts'
import { armarConceptos, comprobante, type Preparado } from '../_shared/cfdiConceptos.ts'

const cors = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const op = () => crypto.randomUUID()
// La solicitud ya no está "pendiente" durante una conciliación: ese faltante no aplica al reenvío.
const sinEstado = (p: Preparado): Preparado => ({ ...p, faltantes: (p.faltantes ?? []).filter((f) => !f.startsWith('La solicitud está en estado')) })

Deno.serve(conCors(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'método no permitido' })
  const url = Deno.env.get('SUPABASE_URL')!
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const q = await resolverQuien(caller, admin)
  if (!q.ok) return json(q.status, q.body)
  if (!tieneRol(q.quien, ['admin', 'billing'])) return json(403, { error: 'no_autorizado', message: 'Solo Dirección o Facturación timbran.' })

  const b = await req.json().catch(() => ({})) as { accion?: string; doc_id?: string; order_id?: string; forma_pago?: string | null }
  const accion = b.accion ?? 'preparar'
  if (!['preparar', 'timbrar', 'conciliar'].includes(accion)) return json(400, { error: 'accion_invalida' })
  let doc = UUID.test(b.doc_id ?? '') ? b.doc_id! : null
  if (!doc && UUID.test(b.order_id ?? '')) {
    const { data } = await admin.from('fiscal_documents').select('id').eq('order_id', b.order_id).in('status', ['pendiente', 'en_proceso', 'incierto']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    doc = data?.id ?? null
  }
  if (!doc) return json(404, { error: 'sin_solicitud', message: 'Ese pedido no tiene una solicitud de factura abierta. Primero "Solicitar factura".' })

  // Entorno y credenciales: sin ellos se puede ver la vista previa, pero nunca se sale al PAC.
  const ent = resolverFacturama(Deno.env.get('FACTURAMA_ENV'))
  const user = Deno.env.get('FACTURAMA_USER') ?? ''; const pass = Deno.env.get('FACTURAMA_PASSWORD') ?? ''
  const configurado = ent.ok && !!user && !!pass
  const deps: DepsPAC | null = configurado && ent.ok ? { fetch, base: ent.base, auth: 'Basic ' + btoa(`${user}:${pass}`) } : null

  const leer = async (): Promise<Preparado | null> => { const { data, error } = await caller.rpc('cfdi_preparar', { p_doc: doc }); return error ? null : data as Preparado }
  const prep = await leer()
  if (!prep) return json(409, { error: 'preparar', message: 'No se pudo leer la solicitud de factura.' })

  if (accion === 'preparar') {
    const a = armarConceptos(prep, b.forma_pago)
    return json(200, { doc_id: doc, status: prep.status, entorno: ent.ok ? ent.entorno : null, configurado, listo: a.ok,
      faltantes: a.ok ? [] : a.faltantes, requiere_forma_tarjeta: !a.ok && a.faltantes.some((f) => f.includes('crédito (04) o débito (28)')),
      resumen: a.ok ? { conceptos: a.items.length, subtotal: a.subtotal, iva: a.iva, total: a.total, forma_pago: a.formaPago } : null })
  }
  if (!deps || !ent.ok) return json(501, { error: 'config_incompleta', message: ent.ok ? 'Faltan las credenciales de Facturama.' : ent.message })

  if (accion === 'timbrar') {
    const a = armarConceptos(prep, b.forma_pago)
    if (!a.ok) return json(409, { error: 'faltantes', faltantes: a.faltantes, requiere_forma_tarjeta: a.faltantes.some((f) => f.includes('crédito (04) o débito (28)')) })
    const { data: id, error: eRec } = await caller.rpc('reclamar_cfdi', { p_op_id: op(), p_doc_id: doc, p_provider_env: ent.entorno, p_claim_id: op() })
    if (eRec || !id) return json(409, { error: 'reclamo', message: sanitiza(eRec?.message ?? 'No se pudo reservar el folio.') })
    const r = id as { serie: string; folio: string; provider_date_sent: string; order_number: string; claim_id: string }
    const res = await timbrarEnPAC(deps, comprobante(r, prep, a))
    const { error: eReg } = await caller.rpc('registrar_resultado_cfdi', { p_op_id: op(), p_doc_id: doc, p_claim_id: r.claim_id, p_resultado: res.clase,
      p_uuid: res.uuid ?? null, p_provider_ref: res.providerRef ?? null, p_stamped_at: res.clase === 'timbrado' ? new Date().toISOString() : null,
      p_error_code: res.clase === 'timbrado' ? null : (res.code ?? 'desconocido'), p_error_message: res.clase === 'timbrado' ? null : sanitiza(res.message ?? '') })
    if (eReg) {
      // El PAC respondió pero no se pudo guardar: queda en proceso y la conciliación lo recupera por serie+folio.
      return json(202, { status: 'incierto', serie: r.serie, folio: r.folio, message: 'Facturama respondió pero no se pudo guardar el resultado. Usa "Conciliar con Facturama"; no vuelvas a timbrar.' })
    }
    let correo = false
    if (res.clase === 'timbrado' && res.providerRef && /@/.test(prep.receiver?.email_facturacion ?? '')) {
      try {
        const qs = new URLSearchParams({ CfdiType: 'issued', CfdiId: String(res.providerRef), Email: prep.receiver.email_facturacion })
        const m = await fetch(`${deps.base}/Cfdi?${qs.toString()}`, { method: 'POST', headers: { Authorization: deps.auth, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
        correo = m.ok && ((await m.json().catch(() => ({}))) as { success?: boolean }).success === true
      } catch { /* el CFDI ya existe; el envío se puede repetir desde la pantalla */ }
    }
    const http = res.clase === 'timbrado' ? 200 : res.clase === 'fallido' ? 422 : 202
    return json(http, { status: res.clase, uuid: res.uuid ?? null, serie: r.serie, folio: r.folio, entorno: ent.entorno, total: a.total, correo_enviado: correo,
      message: res.clase === 'timbrado' ? `CFDI ${r.serie}-${r.folio} timbrado.` : res.clase === 'fallido' ? `Facturama lo rechazó: ${sanitiza(res.message ?? '')}` : 'No hubo respuesta clara de Facturama: NO vuelvas a timbrar; usa "Conciliar con Facturama".' })
  }

  // CONCILIAR
  const { data: idn, error: eId } = await caller.rpc('identidad_cfdi', { p_doc_id: doc })
  if (eId || !idn) return json(409, { error: 'identidad', message: 'No se pudo leer la identidad de esa factura.' })
  const i = idn as { status: string; serie: string; folio: string; provider_date_sent: string; order_number: string; replay_permitido: boolean }
  if (i.status !== 'incierto' && i.status !== 'en_proceso') return json(409, { error: 'no_conciliable', message: `La factura está en estado ${i.status}.` })
  if (i.status === 'en_proceso') {
    // Reclamo abandonado (la función se cortó a medio camino): primero se declara incierto, nunca se asume que no se timbró.
    const { data: d } = await admin.from('fiscal_documents').select('claim_id, claimed_at').eq('id', doc).maybeSingle()
    if (!d?.claimed_at || Date.now() - new Date(d.claimed_at).getTime() < 2 * 60_000) return json(409, { error: 'en_proceso', message: 'Hay un timbrado en curso; espera un par de minutos.' })
    await caller.rpc('registrar_resultado_cfdi', { p_op_id: op(), p_doc_id: doc, p_claim_id: d.claim_id, p_resultado: 'incierto', p_error_code: 'reclamo_abandonado', p_error_message: 'El timbrado no terminó de registrarse.' })
  }
  const busq = await buscarPorSerieFolio(deps, i.serie, i.folio)
  const cand = busq.outcome === 'encontrado' ? busq.candidatos[0] : null
  await caller.rpc('registrar_sondeo_cfdi', { p_op_id: op(), p_doc_id: doc, p_probe_kind: 'lookup_serie_folio', p_outcome: busq.outcome,
    p_candidates: 'candidatos' in busq ? busq.candidatos.length : 0, p_uuid: cand?.uuid ?? null, p_detail: busq.outcome === 'error' ? sanitiza(busq.message) : null })
  if (cand?.uuid) {
    const { error: eAd } = await caller.rpc('adoptar_cfdi', { p_op_id: op(), p_doc_id: doc, p_uuid: cand.uuid, p_provider_ref: cand.providerRef, p_stamped_at: new Date().toISOString(), p_evidencia: `serie ${i.serie} folio ${i.folio}` })
    return eAd ? json(409, { error: 'adoptar', message: sanitiza(eAd.message) }) : json(200, { status: 'timbrado', uuid: cand.uuid, serie: i.serie, folio: i.folio, message: 'La factura sí existía en Facturama: quedó registrada.' })
  }
  if (busq.outcome === 'multiple') return json(409, { status: 'revision_manual', message: 'Facturama tiene más de un comprobante con esa serie y folio: revísalo con Dirección.' })
  if (busq.outcome === 'error') return json(502, { status: 'incierto', message: 'No se pudo consultar Facturama; intenta de nuevo en unos minutos.' })
  if (!i.replay_permitido) return json(409, { status: 'incierto', message: 'No aparece en Facturama y ya pasó la ventana segura de reenvío: Dirección la resuelve como inexistente con dos consultas separadas.' })
  // Reenvío idempotente: MISMA serie, folio y Date (Facturama deduplica por Folio+Date).
  const a = armarConceptos(sinEstado(prep), b.forma_pago)
  if (!a.ok) return json(409, { error: 'faltantes', faltantes: a.faltantes, requiere_forma_tarjeta: a.faltantes.some((f) => f.includes('crédito (04) o débito (28)')) })
  const res = await timbrarEnPAC(deps, comprobante(i, prep, a))
  if (res.clase === 'timbrado' && res.uuid) {
    const { error: eAd } = await caller.rpc('adoptar_cfdi', { p_op_id: op(), p_doc_id: doc, p_uuid: res.uuid, p_provider_ref: res.providerRef ?? null, p_stamped_at: new Date().toISOString(), p_evidencia: 'reenvío con la misma identidad' })
    return eAd ? json(409, { error: 'adoptar', message: sanitiza(eAd.message) }) : json(200, { status: 'timbrado', uuid: res.uuid, serie: i.serie, folio: i.folio, message: `CFDI ${i.serie}-${i.folio} timbrado (reenvío).` })
  }
  return json(res.clase === 'fallido' ? 422 : 202, { status: 'incierto', message: res.clase === 'fallido' ? `Facturama rechazó el reenvío: ${sanitiza(res.message ?? '')}` : 'Sigue sin respuesta clara de Facturama; vuelve a conciliar más tarde.' })
}))
