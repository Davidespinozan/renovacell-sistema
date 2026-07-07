// Modal de PAGO del Portal del Doctor (UI-first). Cobra un pedido por tarjeta o
// transferencia usando el proveedor intercambiable (data/payments/provider).
// Al confirmar, avisa al contenedor (onPaid) para actualizar el store.
import React, { useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { processPayment, type PayMethod, type PayResult } from '../../data/payments/provider'
import { startStripeCheckout } from '../../lib/stripe'

const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

export function PaymentModal({
  folio, amount, orderId, onPaid, onClose,
}: {
  folio: string
  amount: number
  orderId?: string
  onPaid: (r: PayResult) => void
  onClose: () => void
}) {
  const [method, setMethod] = useState<PayMethod>('tarjeta')
  const [card, setCard] = useState({ number: '', name: '', exp: '', cvc: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<PayResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cardOk = method !== 'tarjeta' || (card.number.replace(/\D/g, '').length >= 15 && card.name.trim().length > 2)

  const pay = async () => {
    setBusy(true); setError(null)
    try {
      // Si Stripe está habilitado y es pago con tarjeta, cobra de VERDAD (redirige
      // a la página de pago de Stripe). Si no está configurado, cae al flujo actual.
      if (method === 'tarjeta' && orderId) {
        const { redirected } = await startStripeCheckout(orderId)
        if (redirected) return // el navegador se va a Stripe; el webhook marca pagado
      }
      const r = await processPayment({
        orderRef: folio, amount, currency: 'MXN', method,
        card: method === 'tarjeta' ? { number: card.number, name: card.name } : undefined,
      })
      if (!r.ok) { setError(r.error ?? 'No se pudo procesar el pago.'); setBusy(false); return }
      onPaid(r)        // actualiza el pedido en el store
      setDone(r)
    } catch {
      setError('No se pudo procesar el pago. Intenta de nuevo.')
    }
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pago confirmado</h3>
              <p>
                Pagaste <b>{money(amount)}</b> del pedido <b>{folio}</b>
                {done.last4 ? <> con {done.brand} ···· {done.last4}</> : ' por transferencia'}.
                Tu pedido ya pasó a <b>preparación</b>.
              </p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Pagar pedido {folio}</h3>
                <div className="ms">Pago seguro · {money(amount)}</div>
              </div>
              <button className="mclose" type="button" onClick={onClose} disabled={busy}><Icon name="x" /></button>
            </div>
            <div className="mbody">
              <div className="seg" style={{ marginBottom: 4 }}>
                <button type="button" className={method === 'tarjeta' ? 'active' : undefined} onClick={() => setMethod('tarjeta')}>Tarjeta</button>
                <button type="button" className={method === 'transferencia' ? 'active' : undefined} onClick={() => setMethod('transferencia')}>Transferencia</button>
              </div>

              {method === 'tarjeta' ? (
                <>
                  <label style={{ ...label, marginTop: 16 }}>Número de tarjeta</label>
                  <input style={input} inputMode="numeric" placeholder="4242 4242 4242 4242" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} />
                  <label style={label}>Nombre en la tarjeta</label>
                  <input style={input} placeholder="Como aparece en la tarjeta" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} />
                  <div className="form-grid-2" style={{ marginTop: 0 }}>
                    <div>
                      <label style={label}>Vence</label>
                      <input style={input} placeholder="MM/AA" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} />
                    </div>
                    <div>
                      <label style={label}>CVC</label>
                      <input style={input} inputMode="numeric" placeholder="123" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)', marginTop: 16 }}>
                  <Icon name="receipt" />
                  <span>Transfiere <b>{money(amount)}</b> a la cuenta de Renovacell e indica el folio <b>{folio}</b> como referencia. Al confirmar, registramos tu pago.</span>
                </div>
              )}

              {error && (
                <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}>
                  <Icon name="x" /><span>{error}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
                <button className="btn" type="button" onClick={pay} disabled={busy || !cardOk} style={(busy || !cardOk) ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
                  <Icon name="check" /> {busy ? 'Procesando…' : `Pagar ${money(amount)}`}
                </button>
              </div>

              <p style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', marginTop: 12 }}>
                Cobro de demostración. En producción se procesa con Stripe; los datos de tu tarjeta nunca pasan por nuestros servidores.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
