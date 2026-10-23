// MC-1 · Modal del checkout CANÓNICO compartido: revisar productos e importes (del servidor) → dirección de
// entrega (guardada, nueva o de legado, sin pasar por Perfil) → factura opcional → crear pedido → pagar ahora
// o después. Hoy lo abre Catálogo; MC-2 lo abrirá desde el Chat (el mismo componente, no un segundo checkout).
// Sin servidor (modo demo) usa el motor local que le pase quien monta.
// MC-2 · Se monta en un portal sobre <body>: encima de cualquier superficie (también del cajón del chat, que sigue
// montado debajo). Escape, el fondo y la X cierran SOLO el checkout; el foco queda atrapado en el diálogo y vuelve
// a quien lo abrió; el scroll del fondo se bloquea y se restaura tal como estaba.
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { PaymentModal } from '../doctor/PaymentModal'
import { DeliveryLocationPicker } from '../../app/DeliveryLocationPicker'
import { FiscalFields } from '../../app/FiscalFields'
import { PerfilesFiscalesEditor } from '../../app/Cliente360Editores'
import { cliente360 as clienteFiscalPorDefecto, type PerfilFiscal } from '../../data/ops/customer360'
import { emptyFiscalProfile, isFiscalProfileComplete, type FiscalProfile } from '../../data/ops/fiscal'
import type { ShippingAddress } from '../../data/ops/shippingAddress'
import { clientOf } from '../../data/mock/profiles'
import { DOCTOR_ID } from '../../data/mock/orders'
import { hasSupabase, currentUserId } from '../../lib/supabase'
import { textoProblemasCheckout, useCheckoutCanonico, type ConfigServidor, type EleccionEntrega, type LineaVista, type PedidoMin, type ResultadoPedido } from './checkoutMotor'
import { MOTIVO_ENTREGA, fleteTexto, opcionDe, promesaDe, requiereDireccion, requiereHorario, type HorarioElegido, type OpcionEntrega } from '../../data/ops/entrega'
import { HorarioEntregaPicker } from '../../app/HorarioEntregaPicker'

/** Motor local (solo modo demo, sin backend): líneas con su precio efectivo previsto y creación local. */
export interface MotorLocal {
  lineas: LineaVista[]
  total: number
  confirmar: (factura: boolean, entrega: EleccionEntrega, receptor: FiscalProfile | null) => Promise<ResultadoPedido>
}

/** Domicilio de LEGADO del doctor en sesión (si lo tiene registrado): el selector lo ofrece como opción. */
export function domicilioLegadoDelDoctor(): ShippingAddress | null {
  const ci = clientOf(hasSupabase ? currentUserId() : DOCTOR_ID)
  return ci.address && ci.address !== '—' ? { line1: ci.address, city: ci.city !== '—' ? ci.city : '', phone: ci.phone } : null
}

const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** MC-2 · Diálogo sobre <body>: Escape (fase de captura, no llega al cajón del chat), trampa de foco, foco de
 *  vuelta a quien abrió y bloqueo del scroll del fondo restaurando el valor previo. */
function Capa({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const caja = useRef<HTMLDivElement | null>(null)
  const cerrar = useRef(onClose); cerrar.current = onClose
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const primero = caja.current?.querySelector<HTMLElement>(ENFOCABLES)
    ;(primero ?? caja.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cerrar.current(); return }
      if (e.key !== 'Tab' || !caja.current) return
      const f = Array.prototype.slice.call(caja.current.querySelectorAll<HTMLElement>(ENFOCABLES)) as HTMLElement[]
      if (!f.length) { e.preventDefault(); return }
      const i = f.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      if (previo && previo.isConnected) previo.focus()
    }
  }, [])
  return createPortal(
    <div className="overlay" onClick={(e) => { e.stopPropagation(); onClose() }} data-testid="checkout-capa">
      <div ref={caja} tabIndex={-1} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  )
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
  const [opcion, setOpcion] = useState<string | null>(null)   // ENT-0 · id de la opción de entrega elegida (servidor)
  const [horario, setHorario] = useState<HorarioElegido | null>(null)   // ENT-H · horario de entrega local elegido (solo chofer)
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
  // El carrito ya es un pedido (p. ej. confirmado en otra pestaña): se informa y NO se ofrece confirmar de nuevo.
  const yaPedido = conServidor && !order && motor.revision?.order_id ? motor.revision.order_id : null
  // Avisos de la revisión que NO son la dirección (esa se elige aquí abajo): disponibilidad, precio, cuenta…
  const avisoRevision = conServidor && motor.revision && !motor.revision.listo && !motor.revision.order_id
    ? textoProblemasCheckout(motor.revision.problemas, servidor?.nombreDe, false) : ''

  // ENT-0 · ENTREGA: el servidor manda las opciones permitidas (flete por regla, promesa con el corte de las 15:30) y la
  // sugerida; aquí solo se elige. El flete que se muestra es el de la opción del servidor; al confirmar se revisa de nuevo.
  const ops = conServidor ? motor.revision?.entrega_opciones ?? null : null
  const hoy = ops?.corte.hoy ?? null
  const sel: OpcionEntrega | null = opcionDe(ops, opcion)
  useEffect(() => {
    if (!ops) return
    if (sel && sel.permitido && sel.disponible) return
    setOpcion(ops.sugerida ?? ops.opciones.find((o) => o.permitido && o.disponible)?.id ?? null)
  }, [ops])   // eslint-disable-line react-hooks/exhaustive-deps
  const necesitaDireccion = ops ? requiereDireccion(sel?.tipo) : true   // sin opciones (demo/fixtures) se exige dirección como antes
  const envio = ops ? (sel?.flete ?? null) : null
  const totalConEnvio = total != null && envio != null ? total + envio : total
  const necesitaHorario = !!ops && requiereHorario(sel)
  const eleccion: EleccionEntrega = { address: choice?.address ?? null, locationId: choice?.locationId, opcion: ops ? opcion : null, horario: necesitaHorario ? horario : null }

  const bloqueado = (necesitaDireccion && !choice?.address) || (!!ops && !sel) || (necesitaHorario && !horario) || creando || (invoice && !fiscalOk)
  const confirm = async () => {
    if (necesitaDireccion && !choice?.address) return // a domicilio: exige dirección de entrega (recoger no)
    if (ops && !sel) return
    if (necesitaHorario && !horario) return   // ENT-H · la entrega local exige horario
    if (invoice && !fiscalOk) { setShowFiscalErr(true); return } // HARD GATE
    if (creando || yaPedido) return
    setCreando(true); setErrorPedido(null)
    const r = conServidor
      ? await motor.confirmar(eleccion, invoice, invoice ? perfilSel : null)
      : local ? await local.confirmar(invoice, choice ?? { address: null }, invoice ? fiscal : null) : { ok: false as const, error: 'El checkout no está disponible.' }
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
    <Capa onClose={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Revisar pedido" data-testid="checkout-canonico">
        {yaPedido ? (
          <div className="mbody">
            <div className="success" data-testid="checkout-ya-pedido">
              <div className="ck"><Icon name="check" /></div>
              <h3>Este carrito ya es un pedido</h3>
              <p>Tu pedido ya quedó registrado. Consulta su estado y págalo desde <b>Mis pedidos</b>.</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center' }}>
                <button className="btn" type="button" onClick={onClose}>Entendido</button>
              </div>
            </div>
          </div>
        ) : order ? (
          <div className="mbody">
            <div className="success" data-testid="checkout-exito">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pedido creado</h3>
              <p>
                Tu pedido <b>{order.external_ref ?? 'nuevo'}</b> quedó registrado. Págalo ahora para que
                entre a preparación, o más tarde desde <b>Mis pedidos</b>.
              </p>
              {order.entrega && (
                <p data-testid="checkout-promesa" style={{ fontSize: 13.5 }}>
                  <b>{order.entrega.texto}</b>{order.entrega.flete > 0 ? ` · envío ${money(order.entrega.flete)}` : ' · sin costo de envío'}<br />
                  {promesaDe(order.entrega, hoy)}
                </p>
              )}
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

              {ops && sel && (
                <div className="coitem" data-testid="checkout-envio">
                  <span>Envío <span style={{ color: 'var(--ink-3)' }}>· {sel.texto}</span></span>
                  <span className="mono">{fleteTexto(sel.flete, money)}</span>
                </div>
              )}
              <div className="cototal">
                <span>Total</span>
                <b data-testid="checkout-total">{totalConEnvio != null ? money(totalConEnvio) : motor.revisando ? 'Calculando…' : '—'}</b>
              </div>
              {conServidor && motor.errorRevision && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginTop: 6 }} data-testid="checkout-error-revision">{motor.errorRevision}</div>}
              {avisoRevision && <div role="status" className="ms" style={{ color: 'var(--warn)', marginTop: 6 }} data-testid="checkout-aviso">Antes de pedir: {avisoRevision}.</div>}

              <div className="eyebrow" style={{ marginTop: 16 }}>Dirección de entrega</div>
              <DeliveryLocationPicker legacyBase={base} onChange={setChoice} />

              {ops && (
                <div data-testid="checkout-entrega">
                  <div className="eyebrow" style={{ marginTop: 16 }}>¿Cómo lo recibes?</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {ops.opciones.filter((o) => o.permitido || o.motivo !== 'SOLO_PERSONAL').map((o) => {
                      const on = opcion === o.id
                      const puede = o.permitido && o.disponible
                      return (
                        <label key={o.id} className="addr-opt" data-testid={`entrega-${o.id}`} aria-disabled={!puede}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 11, background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: puede ? 'pointer' : 'not-allowed', opacity: puede ? 1 : 0.55 }}
                          onClick={() => { if (puede) setOpcion(o.id) }}>
                          <input type="radio" name="entrega" checked={on} disabled={!puede} onChange={() => setOpcion(o.id)} />
                          <span style={{ flex: 1 }}>
                            <b style={{ display: 'block', fontSize: 13 }}>{o.texto} <span className="mono" style={{ fontWeight: 600, color: o.flete ? 'var(--ink-2)' : 'var(--green-deep)', marginLeft: 6 }}>{fleteTexto(o.flete, money)}</span></b>
                            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                              {puede ? (requiereHorario(o) ? (on && horario ? `Llega ${horario.fecha === hoy ? 'hoy' : 'el ' + horario.fecha.slice(8, 10) + '/' + horario.fecha.slice(5, 7)} a las ${horario.inicio}` : 'Eliges un horario de media hora') : promesaDe(o, hoy)) : !o.disponible ? 'Próximamente' : MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'No aplica para este pedido'}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  {necesitaHorario && (
                    <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + (horario ? 'var(--line)' : 'var(--warn)'), borderRadius: 10, background: 'var(--surface-2, #fafafa)' }} data-testid="checkout-horario">
                      <div className="eyebrow" style={{ margin: '0 0 8px' }}>¿A qué hora lo recibes? {!horario && <span style={{ fontWeight: 400, color: 'var(--warn)' }}>· elige un horario</span>}</div>
                      <HorarioEntregaPicker value={horario} onChange={setHorario} cargar={servidor?.cargarHorarios} compacto />
                    </div>
                  )}
                  <div className="ms" style={{ color: 'var(--ink-3)', marginTop: 6 }} data-testid="checkout-corte">
                    {sel?.tipo === 'recoge' ? `${ops.recoge.lugar} · ${ops.recoge.horario}` : ops.corte.antes_de_corte ? `Los pedidos que entran antes de las ${ops.corte.hora} salen el mismo día.` : `Después de las ${ops.corte.hora} los pedidos salen el siguiente día hábil.`}
                  </div>
                </div>
              )}

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
    </Capa>
  )
}
