// CS-1A.6 · Conciliación de cobros con tarjeta (CyberSource) para Dirección y Facturación, dentro de Revisión económica.
// Lista los intentos que requieren atención (enviado sin respuesta, autorizado sin captura, capturado sin asiento, desconocido),
// muestra estado bancario y contable sin datos sensibles, y ofrece las acciones de la Edge `cs-conciliar`: consultar (solo lectura),
// resolver (aplica lo que dice el proveedor), capturar / reversar (solo autorizadas sin captura) y contabilizar (captured).
// El operador NO puede marcar nada como capturado o contabilizado a mano: cada acción exige motivo y la evidencia la pone el proveedor.
// CS-1A.7 · un "Resultado desconocido" NUNCA se cierra solo (ni por tiempo ni por búsqueda vacía): el cierre sin cargo es una acción
// separada que exige ≥ 24 h, consulta al banco por id y referencia en ese momento, revisión declarada del Business Center, motivo y responsable.
import React, { useEffect, useState } from 'react'
import { CreditCard, RefreshCw, Search, Check, Undo2, BookCheck, ShieldAlert } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { listarIntentosAtencion as listarReal, listarEventos as eventosReal, conciliar as conciliarReal, ETIQUETA_ESTADO, HORAS_CIERRE_MANUAL, MOTIVO_MINIMO_CIERRE, horasParaCierre, type IntentoAdmin, type EventoIntento, type AccionConciliar } from '../../data/payments/cybersourceConciliar'

export interface DepsConciliacion { listar?: typeof listarReal; eventos?: typeof eventosReal; conciliar?: typeof conciliarReal }
const corto = (id: string | null) => (id ? `…${id.slice(-6)}` : '—')

export function ConciliacionTarjeta({ deps }: { deps?: DepsConciliacion }) {
  const listar = deps?.listar ?? listarReal, eventos = deps?.eventos ?? eventosReal, conciliar = deps?.conciliar ?? conciliarReal
  const [intentos, setIntentos] = useState<IntentoAdmin[] | null>(null)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [bitacora, setBitacora] = useState<EventoIntento[]>([])
  const [motivo, setMotivo] = useState('')
  const [bcRevisado, setBcRevisado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'error'; texto: string; hallazgo?: Record<string, unknown> } | null>(null)

  const cargar = async () => { const r = await listar(); if (r.ok) { setIntentos(r.intentos); setError('') } else { setIntentos([]); setError(r.mensaje) } }
  useEffect(() => { void cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const abrir = async (id: string) => { setAbierto(id); setResultado(null); setMotivo(''); setBcRevisado(false); setBitacora(await eventos(id)) }

  const accion = async (acc: AccionConciliar, id: string) => {
    if (acc !== 'consultar' && acc !== 'contabilizar' && motivo.trim().length < 5) { setResultado({ tipo: 'error', texto: 'Escribe el motivo (mínimo 5 caracteres).' }); return }
    if (acc === 'cerrar_manual') {
      if (motivo.trim().length < MOTIVO_MINIMO_CIERRE) { setResultado({ tipo: 'error', texto: `El cierre manual exige un motivo de al menos ${MOTIVO_MINIMO_CIERRE} caracteres.` }); return }
      if (!bcRevisado) { setResultado({ tipo: 'error', texto: 'Confirma que revisaste el Business Center de CyberSource y no existe ninguna transacción de este intento.' }); return }
      if (!window.confirm('Cerrar SIN CARGO este intento. Se consultará al banco por identificador y por referencia en este momento; si aparece cualquier transacción NO se cerrará. Quedarás como responsable en la bitácora. ¿Continuar?')) return
    }
    if ((acc === 'capturar' || acc === 'reversar') && !window.confirm(acc === 'capturar' ? 'Capturar la autorización en el banco. ¿Continuar?' : 'Reversar la autorización en el banco (libera el cargo retenido). ¿Continuar?')) return
    setOcupado(true); setResultado(null)
    const r = await conciliar(acc, id, motivo.trim() || undefined, acc === 'cerrar_manual' ? { business_center_revisado: true } : undefined)
    setOcupado(false)
    if (r.ok) setResultado({ tipo: 'ok', texto: `${ETIQUETA_ESTADO[r.data.estado] ?? r.data.estado}${r.data.message ? ' · ' + r.data.message : ''}${r.data.sugerencia ? ' · sugerencia: ' + r.data.sugerencia.accion + ' (' + r.data.sugerencia.motivo + ')' : ''}`, hallazgo: r.data.hallazgo })
    else setResultado({ tipo: 'error', texto: `${r.message}${r.estado ? ' (estado: ' + r.estado + ')' : ''}`, hallazgo: r.hallazgo })
    await cargar(); setBitacora(await eventos(id))
  }

  return (
    <div className="card" data-testid="conciliacion-tarjeta">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <CreditCard size={18} />
        <div className="eyebrow" style={{ margin: 0 }}>Cobros con tarjeta · conciliación</div>
        <span className={'pill ' + (intentos && intentos.length ? 'p-warn' : 'p-ok')} style={{ marginLeft: 'auto' }} data-testid="ct-contador">{intentos ? `${intentos.length} por atender` : '…'}</span>
        <button type="button" className="btn ghost sm" onClick={() => void cargar()} data-testid="ct-recargar"><RefreshCw size={14} /> Actualizar</button>
      </div>
      {error && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{error}</span></div>}
      {intentos && intentos.length === 0 && !error && <div style={{ color: 'var(--ink-3)', fontSize: 13, marginTop: 10 }} data-testid="ct-vacio">Sin cobros con tarjeta pendientes de conciliación.</div>}
      {intentos && intentos.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {intentos.map((i) => (
            <div key={i.id} data-testid="ct-intento" data-estado={i.status} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <b>{i.folio ?? i.order_id.slice(0, 8)}</b>
                <span className="pill p-warn">{ETIQUETA_ESTADO[i.status] ?? i.status}</span>
                <span>{money(i.amount)}</span>
                {i.ambiente === 'test' && <span className="pill" style={{ fontSize: 10 }}>SANDBOX</span>}
                <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>pago {corto(i.cs_payment_id)} · {i.cs_payment_status ?? 'sin estado bancario'} · asiento {i.entry_id ? 'sí' : 'no'} · desde {fmtDate(i.status_at)}</span>
                <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => void abrir(i.id)} data-testid="ct-abrir">{abierto === i.id ? 'Cerrar' : 'Revisar'}</button>
              </div>
              {abierto === i.id && (
                <div style={{ marginTop: 10 }} data-testid="ct-detalle">
                  {i.error_safe && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Último error: {i.error_safe}</div>}
                  {i.reconcile_note && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Conciliación: {i.reconcile_note}</div>}
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 8 }}>Motivo de la acción</label>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se concilia (queda en la bitácora)" style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10 }} data-testid="ct-motivo" />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void accion('consultar', i.id)} data-testid="ct-consultar"><Search size={14} /> Consultar al banco</button>
                    {['authz_sent', 'unknown_requires_reconciliation', 'authorized', 'captured'].includes(i.status) && <button type="button" className="btn sm" disabled={ocupado} onClick={() => void accion('resolver', i.id)} data-testid="ct-resolver"><Check size={14} /> Resolver con lo que diga el banco</button>}
                    {i.status === 'authorized' && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void accion('capturar', i.id)} data-testid="ct-capturar"><BookCheck size={14} /> Capturar</button>}
                    {i.status === 'authorized' && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void accion('reversar', i.id)} data-testid="ct-reversar"><Undo2 size={14} /> Reversar autorización</button>}
                    {i.status === 'captured' && <button type="button" className="btn sm" disabled={ocupado} onClick={() => void accion('contabilizar', i.id)} data-testid="ct-contabilizar"><BookCheck size={14} /> Contabilizar</button>}
                  </div>
                  {i.status === 'unknown_requires_reconciliation' && (() => {
                    const h = horasParaCierre(i); const faltan = h == null ? null : Math.max(0, HORAS_CIERRE_MANUAL - h); const procede = faltan != null && faltan <= 0
                    return (
                      <div style={{ marginTop: 10, border: '1px dashed var(--line)', borderRadius: 10, padding: 10 }} data-testid="ct-cierre-manual">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700 }}><ShieldAlert size={14} /> Cierre manual sin cargo</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                          Una búsqueda vacía o el tiempo transcurrido no demuestran que no hubo cargo: la reserva se conserva hasta que una persona cierre con evidencia.
                          Requiere {HORAS_CIERRE_MANUAL} h desde el envío al banco, consulta por identificador y referencia en ese momento sin transacciones, revisión del Business Center, motivo (mínimo {MOTIVO_MINIMO_CIERRE} caracteres) y responsable.
                        </div>
                        <div style={{ fontSize: 12, marginTop: 6 }} data-testid="ct-cierre-horas">{procede ? 'Plazo cumplido: el cierre puede solicitarse.' : faltan == null ? 'Sin fecha de envío registrada.' : `Disponible en ${Math.ceil(faltan)} h.`}</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 6 }}>
                          <input type="checkbox" checked={bcRevisado} onChange={(e) => setBcRevisado(e.target.checked)} data-testid="ct-bc-revisado" />
                          Revisé el Business Center de CyberSource y no existe ninguna transacción de este intento
                        </label>
                        <button type="button" className="btn ghost sm" disabled={ocupado || !procede} onClick={() => void accion('cerrar_manual', i.id)} data-testid="ct-cerrar-manual" style={{ marginTop: 6 }}><ShieldAlert size={14} /> Cerrar sin cargo (manual)</button>
                      </div>
                    )
                  })()}
                  {resultado && <div className="sysnote" style={{ marginTop: 8, ...(resultado.tipo === 'error' ? { background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' } : {}) }} data-testid="ct-resultado"><span>{resultado.texto}{resultado.hallazgo && <> · banco: auth {String((resultado.hallazgo.autorizacion as { estado?: string })?.estado ?? '?')}, captura {String((resultado.hallazgo.captura as { estado?: string })?.estado ?? '?')}, reversa {String((resultado.hallazgo.reversa as { estado?: string })?.estado ?? '?')}</>}</span></div>}
                  <div style={{ marginTop: 10, fontSize: 12 }} data-testid="ct-bitacora">
                    <b>Bitácora</b>
                    {bitacora.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>Sin eventos.</div> : bitacora.map((e) => (
                      <div key={e.id} style={{ color: 'var(--ink-3)' }}>{fmtDate(e.created_at)} · {e.from_status ?? '∅'} → <b>{e.to_status}</b>{e.actor_role ? ` · ${e.actor_role}` : ''}{e.detalle?.evidencia ? ` · ${String(e.detalle.evidencia)}` : ''}{e.detalle?.error ? ` · ${String(e.detalle.error)}` : ''}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
