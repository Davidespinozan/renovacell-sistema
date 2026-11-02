// LINK DE PAGO (2 nov 2026) · mientras no haya tarjeta en línea, el doctor pide un link de BanBajío: su vendedor lo genera
// y se lo manda (WhatsApp, correo y aquí). Cuando ya está, aquí mismo aparece el botón para abrirlo.
import React, { useEffect, useState } from 'react'
import { CreditCard, ExternalLink } from 'lucide-react'
import { linksPago as clientePorDefecto, type ClienteLinksPago, type LinkPago } from '../../data/ops/linksPago'

export function LinkPagoTarjeta({ orderId, cliente = clientePorDefecto }: { orderId: string; cliente?: ClienteLinksPago }) {
  const [l, setL] = useState<LinkPago | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void cliente.dePedido(orderId).then((r) => setL(r.ok ? r.data : null)) }, [cliente, orderId])
  if (l === undefined) return null
  if (l?.estado === 'pagado') return null
  const pedir = async () => { setBusy(true); setError(null); const r = await cliente.solicitar(orderId); setBusy(false); if (r.ok) setL(r.data); else setError(r.error) }
  return (
    <div className="sysnote" style={{ marginTop: 10, display: 'block' }} data-testid="link-pago-tarjeta">
      {l?.estado === 'enviado' && l.url ? (
        <>
          <b style={{ display: 'block' }}><CreditCard size={14} /> Tu link de pago con tarjeta está listo</b>
          <span style={{ display: 'block', margin: '4px 0 8px' }}>Es de BanBajío, el banco de Renovacell. En cuanto se refleje el pago te avisamos.</span>
          <a className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer" data-testid="link-pago-abrir"><ExternalLink size={14} /> Pagar con tarjeta</a>
        </>
      ) : l?.estado === 'solicitado' ? (
        <span data-testid="link-pago-pedido"><b>Ya pediste tu link de pago con tarjeta.</b> Tu asesor te lo manda en unos minutos (en horario) por WhatsApp y por correo; también aparecerá aquí.</span>
      ) : (
        <>
          <b style={{ display: 'block' }}><CreditCard size={14} /> ¿Prefieres pagar con tarjeta?</b>
          <span style={{ display: 'block', margin: '4px 0 8px' }}>Te mandamos un link de pago seguro de BanBajío por el total de tu pedido.</span>
          <button type="button" className="btn ghost sm" onClick={() => void pedir()} disabled={busy} data-testid="link-pago-pedir">{busy ? 'Pidiendo…' : 'Pedir link de pago'}</button>
        </>
      )}
      {error && <div style={{ color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </div>
  )
}
