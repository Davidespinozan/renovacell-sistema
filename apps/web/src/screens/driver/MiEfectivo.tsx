// MI EFECTIVO (BLOQUE1, 20 nov 2026) · el chofer ve cuánto efectivo trae de sus cobros y debe entregar en la oficina.
import React, { useEffect, useState } from 'react'
import { money, fmtDate } from '../../lib/format'
import { efectivoChofer, type MiEfectivo as Dato } from '../../data/ops/efectivoChofer'

const api = efectivoChofer()

export function MiEfectivo({ recarga = 0 }: { recarga?: number }) {
  const [d, setD] = useState<Dato | null>(null)
  const [abierto, setAbierto] = useState(false)
  useEffect(() => { let vivo = true; void api.mio().then((r) => { if (vivo && r.ok) setD(r.data) }); return () => { vivo = false } }, [recarga])
  if (!d || (d.pendiente <= 0 && !d.ultima_entrega)) return null
  return (
    <div className={'card' + (d.pendiente > 0 ? ' mi-efectivo-pend' : '')} data-testid="mi-efectivo">
      <div className="lrow" style={{ padding: 0, border: 0 }}>
        <div>
          <div className="eyebrow" style={{ margin: 0 }}>Efectivo que traes</div>
          <div className="lt">{d.pendiente > 0 ? 'Entrégalo en la oficina al terminar tu ruta.' : `Última entrega: ${money(d.ultima_entrega!.contado)} el ${fmtDate(d.ultima_entrega!.at)}`}</div>
        </div>
        <b className="mono" style={{ fontSize: 20 }}>{money(d.pendiente)}</b>
      </div>
      {d.cobros.length > 0 && (
        <button className="rc-link" type="button" onClick={() => setAbierto((a) => !a)}>{abierto ? 'Ocultar cobros' : `Ver ${d.cobros.length} ${d.cobros.length === 1 ? 'cobro' : 'cobros'}`}</button>
      )}
      {abierto && d.cobros.map((c, i) => (
        <div key={i} className="lrow"><span className="mono">{c.folio || 'Pedido'}</span><span className="mono">{money(c.monto)}</span></div>
      ))}
    </div>
  )
}
