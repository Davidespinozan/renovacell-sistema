// CS-1A.5 · Confirmación del cobro con tarjeta tras la autenticación 3DS. Envía UNA sola solicitud de pago por intento (guardas
// contra doble montaje y doble clic), y muestra el estado que decide el servidor: "Pago confirmado" SOLO cuando el intento está
// `posted` (asiento registrado). Recargar o cerrar el modal nunca dispara un segundo cargo: al volver, solo se consulta el estado.
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { csPago as csPagoReal, type RespPago } from '../../data/payments/cybersourcePago'

export type FasePago = 'procesando' | 'confirmado' | 'rechazado' | 'pendiente' | 'autorizado_sin_captura' | 'recuperable' | 'consultando'
export interface DepsPago { csPago?: typeof csPagoReal }

const TEXTO: Record<FasePago, string> = {
  consultando: 'Consultando el estado de tu pago…',
  procesando: 'Procesando tu pago con el banco… no cierres esta ventana.',
  confirmado: 'Pago confirmado y registrado.',
  rechazado: 'Tu banco rechazó el pago.',
  pendiente: 'Pago pendiente de verificación. No vuelvas a intentar: te avisamos en cuanto se resuelva.',
  autorizado_sin_captura: 'Tu banco autorizó el pago, pero la captura quedó pendiente de confirmación. No se realizará otro cargo.',
  recuperable: 'No se envió ningún cargo.',
}
const faseDe = (estado: string): FasePago =>
  estado === 'posted' ? 'confirmado' : estado === 'declined' ? 'rechazado' : estado === 'authorized' ? 'autorizado_sin_captura'
  : estado === 'captured' || estado === 'unknown_requires_reconciliation' || estado === 'authz_sent' ? 'pendiente' : 'recuperable'

// Un intento solo se envía UNA vez por sesión del navegador, aunque el componente se monte dos veces (StrictMode) o se recargue el modal.
const enviados = new Set<string>()
export function _reiniciarEnviadosPago(): void { enviados.clear() }

export function ConfirmacionPago({ attemptId, token, amount, onFin, deps }: {
  attemptId: string
  /** Token transitorio en memoria; null si se está recuperando un intento ya enviado (solo consulta). */
  token: string | null
  amount: number
  onFin?: (f: FasePago, r?: RespPago) => void
  deps?: DepsPago
}) {
  const cs = deps?.csPago ?? csPagoReal
  const [fase, setFase] = useState<FasePago>(token && !enviados.has(attemptId) ? 'procesando' : 'consultando')
  const [detalle, setDetalle] = useState('')
  const [resp, setResp] = useState<RespPago | null>(null)
  const corriendo = useRef(false)

  useEffect(() => {
    if (corriendo.current) return
    corriendo.current = true
    let vivo = true
    ;(async () => {
      const yaEnviado = enviados.has(attemptId)
      let r
      if (token && !yaEnviado) { enviados.add(attemptId); setFase('procesando'); r = await cs.pagar(attemptId, token) }
      else { setFase('consultando'); r = await cs.estado(attemptId) }
      if (!vivo) return
      if (!r.ok) {
        if (r.error === 'importe_cambio') { setFase('recuperable'); setDetalle(`${r.message} Saldo vigente: ${money(r.saldo_vigente ?? 0)}.`); enviados.delete(attemptId); onFin?.('recuperable'); return }
        if (r.error === 'en_proceso') { setFase('pendiente'); setDetalle(r.message); onFin?.('pendiente'); return }
        if (r.error === 'token_invalido' || r.error === 'estado_invalido' || r.error === 'datos_incompletos' || r.error === 'not_configured') { setFase('recuperable'); setDetalle(r.message); enviados.delete(attemptId); onFin?.('recuperable'); return }
        // error tras enviar (red): no se sabe si el banco cobró → consultar, nunca reenviar
        const e = await cs.estado(attemptId)
        if (!vivo) return
        if (e.ok) { setResp(e.data); const f = faseDe(e.data.estado); setFase(f); setDetalle(e.data.message ?? ''); onFin?.(f, e.data); return }
        setFase('pendiente'); setDetalle('No pudimos confirmar el resultado con el banco. Consulta tu pedido más tarde; no se enviará otro cargo.'); onFin?.('pendiente'); return
      }
      setResp(r.data); const f = faseDe(r.data.estado); setFase(f); setDetalle(r.data.detalle ?? r.data.message ?? ''); onFin?.(f, r.data)
    })().catch(() => { if (vivo) { setFase('pendiente'); setDetalle('No pudimos confirmar el resultado. Consulta tu pedido más tarde; no se enviará otro cargo.'); onFin?.('pendiente') } })
    return () => { vivo = false; corriendo.current = false }
  }, [attemptId, token])   // eslint-disable-line react-hooks/exhaustive-deps

  const icono = fase === 'confirmado' ? 'check' : fase === 'rechazado' ? 'x' : fase === 'recuperable' ? 'x' : 'clock'
  const tono = fase === 'confirmado' ? { background: 'var(--ok-bg)', borderColor: 'var(--ok-line)', color: 'var(--green-deep)' }
             : fase === 'rechazado' || fase === 'recuperable' ? { background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' } : {}
  return (
    <div data-testid="cpago" data-fase={fase}>
      <div className="sysnote" style={{ marginTop: 12, ...tono }}>
        <Icon name={icono} />
        <span><b>{TEXTO[fase]}</b>{detalle && <> {detalle}</>}{fase === 'confirmado' && resp && <> Importe: <b>{money(amount)}</b>{resp.payment_status === 'paid' && <> · pedido pagado</>}</>}</span>
      </div>
    </div>
  )
}
