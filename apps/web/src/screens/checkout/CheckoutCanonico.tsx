// MC-1 · Modal del checkout CANÓNICO compartido: revisar productos e importes (del servidor) → dirección de
// entrega (guardada, nueva o de legado, sin pasar por Perfil) → factura opcional → crear pedido → pagar ahora
// o después. Hoy lo abre Catálogo; MC-2 lo abrirá desde el Chat (el mismo componente, no un segundo checkout).
// Sin servidor (modo demo) usa el motor local que le pase quien monta.
import React, { useEffect, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { PaymentModal } from '../doctor/PaymentModal'
import { DeliveryLocationPicker } from '../../app/DeliveryLocationPicker'
import { FiscalFields } from '../../app/FiscalFields'
import { PerfilesFiscalesEditor } from '../../app/Cliente360Editores'
import { cliente360 as clienteFiscalPorDefecto, type PerfilFiscal } from '../../data/ops/customer360'
import { emptyFiscalProfile, isFiscalProfileComplete, type FiscalProfile } from '../../data/ops/fiscal'
import type { ShippingAddress } from '../../data/ops/shippingAddress'
import { textoProblemasCheckout, useCheckoutCanonico, type ConfigServidor, type EleccionEntrega, type LineaVista, type PedidoMin, type ResultadoPedido } from './checkoutMotor'

/** Motor local (solo modo demo, sin backend): líneas con su precio efectivo previsto y creación local. */
export interface MotorLocal {
  lineas: LineaVista[]
  total: number
  confirmar: (factura: boolean, entrega: EleccionEntrega, receptor: FiscalProfile | null) => Promise<ResultadoPedido>
}

export interface PropsCheckout {
  /** Domicilio de legado del doctor (si lo tiene): el selector lo ofrece como opción. */
  base: ShippingAddress | null
  /** Con servidor: el checkout canónico (revisión → confirmación). */
  servidor: ConfigServidor | null
  /** Sin servidor: motor local de demo. */
  local?: MotorLocal
  /** Renglones conocidos por quien monta (nombre × cantidad) mientras llega la revisión; sin importes. */
  previas?: Array<{ product_id: string; nombre: string; qty: number }>
  onPay: (orderId: string, r: { method: string; id: string }) => void
  onDone?: () => void
  onClose: () => void
  clienteFiscal?: typeof clienteFiscalPorDefecto
}

export function CheckoutCanonico({ base, servidor, local, previas = [], onPay, onDone, onClose, clienteFiscal = clienteFiscalPorDefecto }: PropsCheckout) {
  const conServidor = !!servidor
  const motor = useCheckoutCanonico(servidor)
  const [invoice, setInvoice] = useState(false)
  const [choice, setChoice] = useState<EleccionEntrega | null>(null)
  const [order, setOrder] = useState<PedidoMin | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [payNow, setPayNow] = useState(false)
  // Sin servidor: perfil fiscal local de demo.
  const [fiscal, setFiscal] = useState<FiscalProfile>(emptyFiscalProfile())
  const [showFiscalErr, setShowFiscalErr] = useState(false)
  const [creando, setCreando] = useState(false)
  const [errorPedido, setErrorPedido] = useState<string | null>(null)
  // C360-F3 · con servidor: perfiles fiscales canónicos (0..N); se elige uno (el predeterminado preseleccionado).
  const [perfiles, setPerfiles] = useState<PerfilFiscal[] | null>(null)
  const [perfilSel, setPerfilSel] = useState<string | null>(null)
  const cargarPerfiles = async () => {
    const r = await clienteFiscal.perfilesFiscales(null)
    const ps = r.ok ? r.data.perfiles : []
    setPerfiles(ps)
    setPerfilSel((sel) => (sel && ps.some((p) => p.id === sel) ? sel : ps.find((p) => p.es_predeterminado)?.id ?? ps[0]?.id ?? null))
  }
  useEffect(() => { if (conServidor && invoice && perfiles === null) void cargarPerfiles() }, [invoice])   // eslint-disable-line react-hooks/exhaustive-deps
  const fiscalOk = conServidor ? !!perfilSel : isFiscalProfileComplete(fiscal)

  const { lineas: lineasServidor, total: totalServidor } = motor.vista
  const lineas: LineaVista[] = conServidor
    ? (lineasServidor.length ? lineasServidor : previas.map((p) => ({ ...p, unitario: null, subtotal: null })))
    : local?.lineas ?? []
  const total = conServidor ? totalServidor : local?.total ?? 0
  // Avisos de la revisión que NO son la dirección (esa se elige aquí abajo): disponibilidad, precio, cuenta…
  const avisoRevision = conServidor && motor.revision && !motor.revision.listo && !motor.revision.order_id
    ? textoProblemasCheckout(motor.revision.problemas, servidor?.nombreDe, false) : ''

  const bloqueado = !choice?.address || creando || (invoice && !fiscalOk)
  const confirm = async () => {
    if (!choice?.address) return // el pedido es a domicilio: exige dirección de entrega
    if (invoice && !fiscalOk) { setShowFiscalErr(true); return } // HARD GATE
    if (creando) return
    setCreando(true); setErrorPedido(null)
    const r = conServidor
      ? await motor.confirmar(choice, invoice, invoice ? perfilSel : null)
      : local ? await local.confirmar(invoice, choice, invoice ? fiscal : null) : { ok: false as const, error: 'El checkout no está disponible.' }
    setCreando(false)
    // Si el servidor NO creó el pedido, el carrito se conserva: vaciarlo aquí
    // haría que el doctor pierda su selección por un pedido que no existe.
    if (!r.ok) { setErrorPedido(r.error); return }
    setOrder(r.order); setAviso(r.aviso ?? null)
    onDone?.() // solo con el pedido confirmado
  }

  // Paso de pago en línea (al elegir "Pagar ahora").
  if (order && payNow) {
    return (
      <PaymentModal
        folio={order.external_ref ?? order.id}
        amount={order.total ?? total ?? 0}
        orderId={order.id}
        onPaid={(r) => onPay(order.id, { method: r.method, id: r.id })}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Revisar pedido" data-testid="checkout-canonico">
        {order ? (
          <div className="mbody">
            <div className="success" data-testid="checkout-exito">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pedido creado</h3>
              <p>
                Tu pedido <b>{order.external_ref ?? 'nuevo'}</b> quedó registrado. Págalo ahora para que
                entre a preparación, o más tarde desde <b>Mis pedidos</b>.
              </p>
              {aviso && <p role="alert" style={{ color: 'var(--warn)', fontSize: 13 }}>{aviso}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Pagar después</button>
                <button className="btn" type="button" onClick={() => setPayNow(true)}>
                  <Icon name="receipt" /> Pagar ahora
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Revisar pedido</h3>
              </div>
              <button className="mclose" type="button" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
            </div>
            <div className="mbody">
              {lineas.map((l) => (
                <div key={l.product_id} className="coitem" data-testid="checkout-linea">
                  <span>{l.nombre} <span style={{ color: 'var(--ink-3)' }}>×{l.qty}</span>{l.unitario != null && l.qty > 1 && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {money(l.unitario)} c/u</span>}</span>
                  <span className="mono">{l.subtotal != null ? money(l.subtotal) : '—'}</span>
                </div>
              ))}

              <div className="cototal">
                <span>Total</span>
                <b data-testid="checkout-total">{total != null ? money(total) : motor.revisando ? 'Calculando…' : '—'}</b>
              </div>
              {conServidor && motor.errorRevision && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginTop: 6 }} data-testid="checkout-error-revision">{motor.errorRevision}</div>}
              {avisoRevision && <div role="status" className="ms" style={{ color: 'var(--warn)', marginTop: 6 }} data-testid="checkout-aviso">Antes de pedir: {avisoRevision}.</div>}

              <div className="eyebrow" style={{ marginTop: 16 }}>Dirección de entrega</div>
              <DeliveryLocationPicker legacyBase={base} onChange={setChoice} />

              <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} data-testid="checkout-factura" /> Solicitar factura (CFDI)
              </label>

              {invoice && (
                <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2, #fafafa)' }}>
                  <div className="eyebrow" style={{ margin: 0 }}>Datos fiscales para tu CFDI</div>
                  {conServidor ? (
                    perfiles === null ? <div className="ms" style={{ color: 'var(--ink-3)', marginTop: 8 }}>Cargando tus datos…</div> : (
                      <div style={{ marginTop: 8 }} data-testid="checkout-perfiles-fiscales">
                        <PerfilesFiscalesEditor customerId={null} perfiles={perfiles} editable cliente={clienteFiscal} onCambio={cargarPerfiles} seleccion={{ valor: perfilSel, onElegir: setPerfilSel }} />
                      </div>
                    )
                  ) : <FiscalFields value={fiscal} onChange={setFiscal} showErrors={showFiscalErr} />}
                  {!fiscalOk && <div className="ms" style={{ color: 'var(--warn)', marginTop: 8 }}>{conServidor ? 'Elige o agrega el perfil fiscal para tu factura.' : 'Completa tus datos fiscales para poder solicitar la factura.'}</div>}
                </div>
              )}

              {errorPedido && (
                <div role="alert" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }} data-testid="checkout-error">
                  <b>Tu pedido no se creó.</b> {errorPedido} Tu selección sigue en el carrito.
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" onClick={confirm} disabled={bloqueado} aria-busy={creando} style={bloqueado ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} data-testid="checkout-crear"><Icon name="check" /> {creando ? 'Creando pedido…' : 'Crear pedido'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
