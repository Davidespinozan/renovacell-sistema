// CANCELACIÓN · piezas compartidas: "Solicitar cancelación" (vendedor, almacén, empaque, facturación), el aviso de una
// solicitud pendiente sobre el pedido (con Aprobar / Rechazar para Dirección) y la lista de pendientes de Dirección.
// La autoridad es el servidor (solicitar_cancelacion / resolver_solicitud_cancelacion / cancelar_pedido).
import React, { useState } from 'react'
import { Icon } from './icons'
import { fmtDate, money } from '../lib/format'
import { ROL_SOLICITA, resolverSolicitud, solicitarCancelacion, useSolicitudesCancelacion, type SolicitudCancelacion } from '../data/ops/cancelacionSolicitud'
import { useAllOrders } from '../data/hooks/useOrders'

const campo: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', backgroundColor: 'var(--cp-surface)', marginTop: 6 }
const MOTIVOS = ['El cliente ya no lo quiere', 'Pedido duplicado', 'Producto dañado o faltante', 'Error de captura']

export function SolicitarCancelacion({ orderId, folio, className = 'btn ghost sm' }: { orderId: string; folio: string; className?: string }) {
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enviar = async () => {
    if (ocupado || motivo.trim().length < 5) return
    setOcupado(true); setError(null)
    const r = await solicitarCancelacion(orderId, motivo)
    setOcupado(false)
    if (!r.ok) { setError(r.mensaje); return }
    setAbierto(false); setMotivo('')
  }
  return (
    <>
      <button type="button" className={className} style={{ color: 'var(--danger)' }} onClick={() => setAbierto(true)} data-testid="btn-solicitar-cancelacion">Solicitar cancelación</button>
      {abierto && (
        <div className="overlay" onClick={() => setAbierto(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="mhead"><div><h3>Solicitar cancelación</h3><div className="ms">Pedido {folio} · la decide Dirección</div></div>
              <button className="mclose" type="button" onClick={() => setAbierto(false)}><Icon name="x" /></button></div>
            <div className="mbody">
              <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>Mientras Dirección decide, el pedido no se puede enviar.</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 2px' }}>
                {MOTIVOS.map((m) => <button key={m} type="button" className={'fchip' + (motivo === m ? ' on' : '')} onClick={() => setMotivo(m)}>{m}</button>)}
              </div>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} placeholder="Motivo de la cancelación" aria-label="Motivo de la cancelación" style={{ ...campo, resize: 'vertical' }} data-testid="motivo-cancelacion" />
              {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button type="button" className="btn ghost" onClick={() => setAbierto(false)}>Cancelar</button>
                <button type="button" className="btn" disabled={ocupado || motivo.trim().length < 5} onClick={() => void enviar()} data-testid="enviar-solicitud-cancelacion">{ocupado ? 'Enviando…' : 'Enviar a Dirección'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Franja sobre el pedido: "Cancelación solicitada por …". Dirección la resuelve ahí mismo. */
export function AvisoCancelacion({ solicitud, esDireccion }: { solicitud: SolicitudCancelacion; esDireccion: boolean }) {
  const [rechazando, setRechazando] = useState(false)
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolver = async (aprobar: boolean) => {
    if (ocupado) return
    setOcupado(true); setError(null)
    const r = await resolverSolicitud(solicitud.id, aprobar, aprobar ? null : nota)
    setOcupado(false)
    if (!r.ok) setError(r.mensaje)
  }
  return (
    <div className="sysnote" role="status" data-testid="aviso-cancelacion" style={{ display: 'block', background: 'var(--danger-bg)', borderColor: 'transparent', color: 'var(--ink)', marginTop: 10 }}>
      <div><b>Cancelación solicitada por {ROL_SOLICITA[solicitud.requester_role] ?? solicitud.requester_role}</b> · {fmtDate(solicitud.created_at)}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{solicitud.reason}</div>
      {esDireccion ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
          <button type="button" className="btn sm" style={{ background: 'var(--danger)' }} disabled={ocupado} onClick={() => void resolver(true)} data-testid="aprobar-cancelacion">Aprobar y cancelar</button>
          {!rechazando ? <button type="button" className="btn ghost sm" onClick={() => setRechazando(true)} data-testid="rechazar-cancelacion">No cancelar</button> : (<>
            <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Por qué no se cancela" aria-label="Por qué no se cancela" style={{ ...campo, marginTop: 0, width: 'auto', flex: 1, minWidth: 180, padding: '7px 10px' }} />
            <button type="button" className="btn ghost sm" disabled={ocupado || !nota.trim()} onClick={() => void resolver(false)} data-testid="confirmar-rechazo-cancelacion">Confirmar</button>
          </>)}
        </div>
      ) : <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>Dirección decide. Mientras, no se envía.</div>}
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

/** Dirección: las solicitudes por resolver, arriba de Ventas (cada una con su pedido). */
export function SolicitudesCancelacionPendientes() {
  const lista = useSolicitudesCancelacion()
  const { data: orders } = useAllOrders()
  if (lista.length === 0) return null
  return (
    <div className="card" data-testid="solicitudes-cancelacion">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <b>Cancelaciones por decidir</b><span className="pill p-dang">{lista.length}</span>
      </div>
      {lista.map((s) => {
        const o = orders.find((x) => x.id === s.order_id)
        return (
          <div key={s.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
            <div style={{ fontSize: 13.5 }}><span className="mono">{o?.external_ref ?? 'Pedido'}</span>{o?.total != null ? <span style={{ color: 'var(--ink-3)' }}> · {money(Number(o.total))}</span> : null}</div>
            <AvisoCancelacion solicitud={s} esDireccion />
          </div>
        )
      })}
    </div>
  )
}
