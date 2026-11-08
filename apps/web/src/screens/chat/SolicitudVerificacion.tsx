// VERIFICACIÓN POR WHATSAPP (2 nov 2026) · tarjeta en el chat del personal: lo que la IA juntó (nombre, cédula, correo,
// fotos que mandó) y los dos botones. Las fotos se revisan en la conversación misma (son mensajes del cliente).
import React, { useCallback, useEffect, useState } from 'react'
import { pedirTexto } from '../../app/dialogos'   // CALIDAD VISUAL · diálogos del sistema
import { verificacionWa as porDefecto, type ClienteVerificacionWa, type SolicitudAlta } from '../../data/ops/verificacionWa'

export function useSolicitudVerificacion(conversationId: string, cliente: ClienteVerificacionWa = porDefecto, onCambio?: () => void): React.ReactNode {
  const [s, setS] = useState<SolicitudAlta | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const cargar = useCallback(async () => { if (!conversationId) return; const r = await cliente.de(conversationId); if (r.ok) setS(r.data) }, [cliente, conversationId])   // sin conversación elegida no se pregunta
  useEffect(() => { setS(null); setMsg(null); void cargar() }, [cargar])
  if (msg?.ok) return <div className="pc-msg ok" role="status" data-testid="verif-msg">{msg.texto}</div>
  if (!s || s.estado !== 'pendiente') return msg ? <div className="pc-msg" role="alert">{msg.texto}</div> : null
  const aprobar = async () => {
    setOcupado(true); setMsg(null)
    const r = await cliente.aprobar(s.id)
    setOcupado(false)
    if (r.ok) { setMsg({ ok: true, texto: `${s.nombre} quedó verificado: ya tiene su cuenta, su WhatsApp quedó ligado y la IA ya le da sus precios por aquí.` }); onCambio?.() }
    else setMsg({ ok: false, texto: r.error })
  }
  const rechazar = async () => {
    const motivo = (await pedirTexto('¿Por qué no se puede verificar? (se le dirá al cliente)', 'la foto de la cédula no se ve completa'))
    if (!motivo?.trim()) return
    setOcupado(true)
    const r = await cliente.rechazar(s.id, motivo.trim())
    setOcupado(false)
    if (r.ok) { setMsg({ ok: true, texto: 'Se le avisó al cliente y puede mandar sus datos de nuevo.' }); onCambio?.() } else setMsg({ ok: false, texto: r.error })
  }
  return (
    <div className="pc-verif" data-testid="solicitud-verificacion" style={{ border: '2px solid var(--green-deep)', borderRadius: 12, padding: '10px 12px', margin: '8px 0', background: 'var(--ok-bg)' }}>
      <div style={{ fontWeight: 700 }}>🪪 Pide verificarse para comprar</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{s.nombre} · cédula {s.cedula} · {s.email}{s.especialidad ? ` · ${s.especialidad}` : ''}{s.ciudad ? ` · ${s.ciudad}` : ''}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
        {s.adjuntos.length ? `${s.adjuntos.length} foto(s) en la conversación: revísalas antes de aprobar.` : 'Todavía no manda foto de su cédula.'}
        {s.posible_cliente ? ' Puede que ya sea cliente: si es así, vincúlalo a su ficha en lugar de aprobar.' : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn sm" type="button" onClick={() => void aprobar()} disabled={ocupado} data-testid="verif-aprobar">{ocupado ? 'Aprobando…' : 'Aprobar y darle acceso'}</button>
        <button className="btn ghost sm" type="button" onClick={() => void rechazar()} disabled={ocupado} data-testid="verif-rechazar">No se puede verificar</button>
      </div>
      {msg && !msg.ok && <div className="pc-msg" role="alert" style={{ marginTop: 6 }}>{msg.texto}</div>}
    </div>
  )
}
