// COBRO AL ENTREGAR (19 nov 2026) · en la puerta: cuánto se debe, cuánto cobró y cómo. No bloquea la entrega (a veces
// no se cobra: crédito o ya pagado); lo que cobre queda en el libro de dinero de Dirección a su nombre.
import React, { useEffect, useRef, useState } from 'react'
import { cobroEntrega as crear, type EstadoCobro } from '../../data/ops/cobroEntrega'
import { newOpId } from '../../data/ops/w1Command'
import { money } from '../../lib/format'

export function CobroEntrega({ shipmentId, cliente: inyectado }: { shipmentId: string; cliente?: ReturnType<typeof crear> }) {
  const api = useRef(inyectado ?? crear()).current
  const [e, setE] = useState<EstadoCobro | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [monto, setMonto] = useState('')
  const [ref, setRef] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const op = useRef(newOpId())   // mismo id en cada reintento: sin señal, reintentar NUNCA cobra doble
  useEffect(() => {
    let vivo = true
    void api.estado(shipmentId).then((r) => { if (!vivo) return; if (r.ok) { setE(r.data); setMonto(r.data.saldo > 0 ? String(r.data.saldo) : '') } else setError(r.error) })
    return () => { vivo = false }
  }, [api, shipmentId])
  if (!e) return error ? <div className="cobro-ent cobro-ent--err" data-testid="cobro-error">{error}</div> : null
  if (e.cancelado) return <div className="cobro-ent cobro-ent--err" data-testid="cobro-cancelado">Pedido cancelado: no cobres ni entregues. Avisa a Almacén.</div>
  if (e.saldo <= 0) return <div className="cobro-ent cobro-ent--ok" data-testid="cobro-pagado">{hecho ?? 'Pagado: no cobres nada.'}</div>
  const cobrar = async (metodo: 'efectivo' | 'transferencia') => {
    const n = Number(monto.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(n) || n <= 0) { setError('Escribe cuánto cobraste.'); return }
    setOcupado(true); setError(null)
    const r = await api.registrar(shipmentId, metodo, n, ref.trim() || null, op.current)
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    op.current = newOpId()
    setHecho(`Cobraste ${money(n)} en ${metodo}.${r.data.saldo > 0 ? ` Aún debe ${money(r.data.saldo)}.` : ' Quedó pagado.'}`)
    setE({ ...e, saldo: Math.max(0, r.data.saldo), cobrado: (e.cobrado ?? 0) + n })
    setMonto(r.data.saldo > 0 ? String(r.data.saldo) : ''); setRef('')
  }
  return (
    <div className="cobro-ent" data-testid="cobro-entrega">
      <div className="cobro-ent-h"><b>Cobrar {money(e.saldo)}</b>{e.credito && <small>Tiene crédito autorizado: cobra solo si el cliente quiere pagar.</small>}</div>
      {hecho && <div className="cobro-ent--ok" data-testid="cobro-hecho">{hecho}</div>}
      <label className="cobro-ent-campo">¿Cuánto cobraste?
        <input inputMode="decimal" value={monto} onChange={(ev) => setMonto(ev.target.value)} aria-label="Monto cobrado" data-testid="cobro-monto" />
      </label>
      <input className="cobro-ent-ref" value={ref} onChange={(ev) => setRef(ev.target.value)} placeholder="Referencia de la transferencia (opcional)" aria-label="Referencia" maxLength={80} />
      <div className="cobro-ent-botones">
        <button type="button" className="btn" disabled={ocupado} onClick={() => void cobrar('efectivo')} data-testid="cobro-efectivo">{ocupado ? 'Guardando…' : 'Cobré en efectivo'}</button>
        <button type="button" className="btn ghost" disabled={ocupado} onClick={() => void cobrar('transferencia')} data-testid="cobro-transferencia">Cobré por transferencia</button>
      </div>
      {error && <div className="cobro-ent--err" role="alert" data-testid="cobro-error">{error}</div>}
    </div>
  )
}
