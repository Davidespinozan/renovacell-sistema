// Modal de PAGO del Portal del Doctor (UI-first). Cobra un pedido por tarjeta o
// transferencia usando el proveedor intercambiable (data/payments/provider).
// Al confirmar, avisa al contenedor (onPaid) para actualizar el store.
import React, { useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { processPayment, type PayMethod, type PayResult } from '../../data/payments/provider'
import { startStripeCheckout } from '../../lib/stripe'
import { hasSupabase, supabase } from '../../lib/supabase'
import { notify } from '../../data/store/notificationsStore'

// Lee un archivo de imagen como data-URL (para mandar el comprobante a la función).
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file) })
}

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
  const [proof, setProof] = useState<string | null>(null) // comprobante de transferencia (data-URL)

  const cardOk = method !== 'tarjeta' || (card.number.replace(/\D/g, '').length >= 15 && card.name.trim().length > 2)

  const pay = async () => {
    setBusy(true); setError(null)

    // TRANSFERENCIA: no se cobra en línea. El doctor informa el pago y Dirección lo
    // confirma al recibir el dinero — el pedido NO se marca pagado aquí (antes se
    // marcaba pagado sin comprobante). Se avisa a Dirección para que lo confirme.
    if (method === 'transferencia') {
      // Con backend: la función servidor marca el pedido, guarda el comprobante y avisa
      // a Dirección (el doctor no puede insertar avisos por RLS). En demo: notify local.
      if (hasSupabase && orderId) {
        const { error: e } = await supabase.functions.invoke('report-transfer', { body: { orderId, reference: folio, proof } })
        if (e) { setError('No se pudo registrar tu transferencia. Intenta de nuevo.'); setBusy(false); return }
      } else {
        notify({ text: `Transferencia informada · pedido ${folio} · confírmala al recibirla`, roles: ['admin'], screen: 'av_fin' })
      }
      setDone({ ok: true, method: 'transferencia' } as PayResult)
      setBusy(false)
      return
    }

    try {
      // Con Stripe habilitado, cobra de VERDAD (redirige a su página). Si NO redirige
      // y estamos en producción, Stripe aún no está configurado → NO se finge el cobro.
      // En demo (sin backend) sí se simula para poder mostrar el flujo.
      if (orderId) {
        const { redirected } = await startStripeCheckout(orderId)
        if (redirected) return // el navegador se va a Stripe; el webhook marca pagado
        if (hasSupabase) {
          setError('El pago con tarjeta en línea aún no está disponible. Por favor usa Transferencia.')
          setBusy(false); return
        }
      }
      const r = await processPayment({ orderRef: folio, amount, currency: 'MXN', method, card: { number: card.number, name: card.name } })
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
              <div className="ck"><Icon name={done.method === 'transferencia' ? 'receipt' : 'check'} /></div>
              {done.method === 'transferencia' ? (
                <>
                  <h3>Transferencia registrada</h3>
                  <p>
                    Transfiere <b>{money(amount)}</b> con el folio <b>{folio}</b> como referencia.
                    En cuanto <b>confirmemos</b> tu pago, tu pedido pasa a preparación — te avisaremos.
                  </p>
                </>
              ) : (
                <>
                  <h3>Pago confirmado</h3>
                  <p>
                    Pagaste <b>{money(amount)}</b> del pedido <b>{folio}</b>
                    {done.last4 ? <> con {done.brand} ···· {done.last4}</> : ''}.
                    Tu pedido ya pasó a <b>preparación</b>.
                  </p>
                </>
              )}
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
                <>
                  <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)', marginTop: 16 }}>
                    <Icon name="receipt" />
                    <span>Transfiere <b>{money(amount)}</b> a la cuenta de Renovacell e indica el folio <b>{folio}</b> como referencia. <b>Cuando recibamos la transferencia, activamos tu pedido.</b></span>
                  </div>
                  <label style={{ display: 'block', marginTop: 12 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Adjunta el comprobante <span style={{ opacity: .7 }}>(opcional · agiliza la confirmación)</span></span>
                    <input type="file" accept="image/*" style={{ display: 'block', marginTop: 6, fontSize: 12.5 }}
                      onChange={async (e) => { const f = e.target.files?.[0]; if (f) setProof(await fileToDataUrl(f)) }} />
                    {proof && <span style={{ fontSize: 12, color: 'var(--green-deep)', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}><Icon name="check" style={{ width: 13, height: 13 }} /> Comprobante adjunto</span>}
                  </label>
                </>
              )}

              {error && (
                <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}>
                  <Icon name="x" /><span>{error}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
                <button className="btn" type="button" onClick={pay} disabled={busy || !cardOk} style={(busy || !cardOk) ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
                  <Icon name="check" /> {busy ? 'Procesando…' : method === 'transferencia' ? 'Ya realicé la transferencia' : `Pagar ${money(amount)}`}
                </button>
              </div>

              {method === 'tarjeta' && (
                <p style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', marginTop: 12 }}>
                  Tus datos de tarjeta se procesan de forma segura; no pasan por nuestros servidores.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
