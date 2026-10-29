// Frontera W1/W3 · Guía de paquetería activa en un pedido EMPACADO. Mientras exista, el
// servidor impide cancelar el pedido. Dirección puede registrar que la anuló MANUALMENTE
// en el portal de la paquetería (referencia obligatoria). Una guía en estado DESCONOCIDO
// se resuelve aquí mismo (DHL D1): el servidor consulta a DHL por la referencia única del
// intento y Dirección decide con esa evidencia: registrar la guía hallada o cerrar sin guía.
import React, { useEffect, useState } from 'react'
import { Icon } from '../../app/icons'
import { hasSupabase, supabase } from '../../lib/supabase'
import { runW1Command } from '../../data/ops/w1Command'
import { useOpId } from '../../data/hooks/useOpId'
import { consultarReconciliacion, resolverReconciliacion, type ConsultaReconciliacion, type Resolucion } from '../../data/shipping/reconciliarGuia'

interface Attempt { id: string; status: string; tracking_number: string | null; provider: string | null }

const box: React.CSSProperties = { marginTop: 14, padding: 14, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--hueso, #f8f9f6)' }
const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 5 }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', display: 'block', marginTop: 8 }

export function GuiaManualVoid({ orderId }: { orderId: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)
  const [ref, setRef] = useState('')
  const [evidence, setEvidence] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const { opId, renew } = useOpId()

  const load = async () => {
    if (!hasSupabase) { setAttempts([]); return }
    const { data } = await supabase.from('shipping_attempts').select('id, status, tracking_number, provider').eq('order_id', orderId) as unknown as { data: Attempt[] | null }
    setAttempts((data ?? []).filter((a) => ['pending', 'succeeded', 'unknown_requires_reconciliation'].includes(a.status)))
  }
  useEffect(() => { void load() }, [orderId])

  if (!attempts || attempts.length === 0) return aviso ? <div className="sysnote" style={box} data-testid="reconciliacion-aviso"><Icon name="check" /><span>{aviso}</span></div> : null
  const a = attempts[0]

  const anular = async () => {
    if (!ref.trim() || busy) return
    setBusy(true); setErr(null)
    const r = await runW1Command('anular_guia_manual', { p_op_id: opId, p_attempt_id: a.id, p_reference: ref.trim(), p_evidence: evidence.trim() || undefined }, opId)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    renew(); setRef(''); setEvidence('')
    await load()
  }

  if (a.status === 'unknown_requires_reconciliation') {
    return <ReconciliarGuia orderId={orderId} onResuelto={(m) => { setAviso(m); void load() }} />
  }
  if (a.status === 'pending') {
    return <div className="sysnote" style={box}><Icon name="truck" /><span>Hay una guía <b>en proceso</b> para este pedido. Espera a que termine antes de cancelar.</span></div>
  }
  return (
    <div style={box}>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <Icon name="truck" /> Guía activa {a.provider ? `(${a.provider.toUpperCase()}) ` : ''}<b className="mono">{a.tracking_number ?? '—'}</b>. Para cancelar el pedido primero anúlala en el portal de la paquetería y registra aquí la referencia.
      </div>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>Referencia de la anulación (obligatoria)</label>
      <input style={fld} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Folio / confirmación del portal" />
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', display: 'block', marginTop: 8 }}>Evidencia (opcional)</label>
      <input style={fld} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Nota o nombre de la captura" />
      {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{err}</span></div>}
      <div style={{ textAlign: 'right', marginTop: 10 }}>
        <button className="btn sm" type="button" disabled={!ref.trim() || busy} onClick={anular} style={!ref.trim() || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {busy ? 'Registrando…' : 'Registrar guía anulada manualmente'}
        </button>
      </div>
    </div>
  )
}

// DHL D1 · Intento en estado DESCONOCIDO. El servidor consulta a DHL por la referencia única del intento (y por el número
// que Dirección traiga del portal, verificándolo en DHL); aquí solo se muestra la evidencia y se recoge la decisión.
// Un 404 de DHL no prueba que la guía no exista: "sin guía" es una decisión de Dirección bajo riesgo declarado.
export function ReconciliarGuia({ orderId, onResuelto, consultar = consultarReconciliacion, resolver = resolverReconciliacion }: {
  orderId: string; onResuelto?: (mensaje: string) => void; consultar?: typeof consultarReconciliacion; resolver?: typeof resolverReconciliacion
}) {
  const [datos, setDatos] = useState<ConsultaReconciliacion | null>(null)
  const [tracking, setTracking] = useState('')
  const [motivo, setMotivo] = useState('')
  const [portal, setPortal] = useState(false)
  const [acepta, setAcepta] = useState(false)
  const [busy, setBusy] = useState<false | 'consultar' | Resolucion>(false)
  const [err, setErr] = useState<string | null>(null)
  const { opId, renew } = useOpId()

  const tn = tracking.trim()
  const consultarAhora = async () => {
    if (busy) return
    setBusy('consultar'); setErr(null)
    const r = await consultar(orderId, tn || undefined)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    setDatos(r.datos)
  }
  const resolverCon = async (resolucion: Resolucion) => {
    if (busy || !datos) return
    setBusy(resolucion); setErr(null)
    const r = await resolver(orderId, { resolucion, motivo: motivo.trim(), opId, tracking: tn || undefined, portalRevisado: portal, aceptaDuplicadoTardio: acepta })
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    renew()
    const res = r.datos.resultado
    onResuelto?.(resolucion === 'guia_confirmada'
      ? `Guía ${res.tracking ?? tn} registrada y pedido marcado como enviado.${r.datos.etiqueta === 'guardada' ? ' La etiqueta ya está disponible en Guías.' : ' La etiqueta no se pudo recuperar: imprímela desde MyDHL.'}${res.costo_pendiente ? ' El costo de la guía quedó pendiente de capturar.' : ''}`
      : 'Intento cerrado sin guía. El pedido sigue empacado y ya admite una guía nueva; antes de generarla el sistema volverá a buscar en DHL.')
  }

  const minutos = datos ? Math.round(datos.intento.horas * 60) : 0
  const porRef = datos?.consulta.por_referencia
  const hallazgos = datos?.guias_distintas ?? []
  const refIntento = datos?.intento.referencia ?? ''
  const motivoOk = motivo.trim().length >= 10
  const sinGuiaListo = !!datos && porRef?.resultado === 'sin_resultados' && hallazgos.length === 0 && minutos >= datos.reglas.minutos_minimos_sin_guia && portal && acepta && motivoOk
  const confirmarListo = !!datos && /^\d{10}$/.test(tn) && hallazgos.includes(tn) && datos.intento.con_snapshot && motivoOk
  const guias = [...(porRef?.encontradas ?? []), ...(datos?.consulta.por_tracking?.encontradas ?? [])].filter((g, i, arr) => arr.findIndex((x) => x.tracking === g.tracking) === i)

  return (
    <div style={box} data-testid="reconciliar-guia">
      <div style={{ fontSize: 13 }}>
        <Icon name="truck" /> La guía de este pedido quedó en <b>estado desconocido</b> con DHL: no se sabe si se creó. Hasta resolverlo no se puede generar otra ni cancelar el pedido.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={lbl}>Número de guía visto en el portal MyDHL (opcional, 10 dígitos)</label>
          <input style={fld} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Ej. 3143999482" inputMode="numeric" />
        </div>
        <button className="btn sm" type="button" disabled={busy !== false} onClick={() => void consultarAhora()} data-testid="reconciliar-consultar">{busy === 'consultar' ? 'Consultando…' : 'Consultar en DHL'}</button>
      </div>
      {datos && (
        <div style={{ marginTop: 10, fontSize: 13 }} data-testid="reconciliar-consulta">
          <div>Intento de hace <b>{minutos} min</b> · referencia <span className="mono">{refIntento}</span> · servicio <b>{datos.intento.servicio ?? '—'}</b>{!datos.intento.con_snapshot && <> · <span style={{ color: 'var(--danger)' }}>sin snapshot de la petición: aquí solo se puede cerrar sin guía</span></>}</div>
          <div style={{ marginTop: 4 }}>
            Búsqueda por referencia: {porRef?.resultado === 'sin_resultados' ? <b>DHL no devolvió ninguna guía</b> : porRef?.resultado === 'encontradas' ? <b style={{ color: 'var(--danger)' }}>DHL devolvió {porRef.encontradas.length} {porRef.encontradas.length === 1 ? 'guía' : 'guías'}</b> : <b style={{ color: 'var(--danger)' }}>DHL no respondió ({porRef?.detalle ?? 'error'}); vuelve a consultar</b>}
            {datos.consulta.por_tracking && <> · Por número {datos.consulta.por_tracking.tracking}: {datos.consulta.por_tracking.resultado === 'encontradas' ? <b>existe en DHL</b> : datos.consulta.por_tracking.resultado === 'sin_resultados' ? <b>DHL no la tiene</b> : <b style={{ color: 'var(--danger)' }}>sin respuesta</b>}</>}
          </div>
          {guias.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {guias.map((g) => (
                <li key={g.tracking} className="mono" style={{ fontSize: 12 }}>
                  {g.tracking} · {g.referencias.includes(refIntento) ? 'lleva la referencia del intento' : 'SIN la referencia del intento'} · servicio {g.producto ?? '?'} · CP {g.destino_cp ?? '?'} · {g.peso_total ?? '?'} kg · {g.piezas ?? '?'} pza · {g.eventos} eventos
                </li>
              ))}
            </ul>
          )}
          <div className="sysnote" style={{ marginTop: 8 }}><span>{datos.reglas.advertencia} Cerrar sin guía exige al menos {datos.reglas.minutos_minimos_sin_guia} minutos desde el intento, revisar el portal y aceptar que, si DHL la creó, aparecerá después como duplicado (el sistema la detectará al cotizar la siguiente guía).</span></div>
          <label style={lbl}>Motivo de la decisión (mínimo 10 caracteres)</label>
          <textarea style={{ ...fld, minHeight: 56 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué consultaste y qué viste en el portal" />
          <label style={{ ...lbl, fontWeight: 500, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={portal} onChange={(e) => setPortal(e.target.checked)} data-testid="reconciliar-portal" /> Revisé el portal MyDHL y no encontré una guía de este pedido</label>
          <label style={{ ...lbl, fontWeight: 500, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} data-testid="reconciliar-acepta" /> Acepto el riesgo de duplicado tardío si cierro sin guía</label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" type="button" disabled={!sinGuiaListo || busy !== false} onClick={() => void resolverCon('sin_guia')} data-testid="reconciliar-sin-guia" title={sinGuiaListo ? undefined : 'Requiere consulta sin hallazgos, 60 minutos, portal revisado, riesgo aceptado y motivo'}>
              {busy === 'sin_guia' ? 'Cerrando…' : 'DHL no creó guía: cerrar sin guía'}
            </button>
            <button className="btn sm" type="button" disabled={!confirmarListo || busy !== false} onClick={() => void resolverCon('guia_confirmada')} data-testid="reconciliar-confirmar" title={confirmarListo ? undefined : 'Requiere que el número tecleado aparezca en la consulta de DHL y un motivo'}>
              {busy === 'guia_confirmada' ? 'Registrando…' : 'Registrar la guía encontrada'}
            </button>
          </div>
        </div>
      )}
      {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{err}</span></div>}
    </div>
  )
}
