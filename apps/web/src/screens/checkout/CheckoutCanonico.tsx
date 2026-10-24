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
import { fleteTexto, opcionDe, promesaDe, requiereDireccion, requiereHorario, type HorarioElegido, type OpcionEntrega } from '../../data/ops/entrega'
import { HorarioEntregaPicker } from '../../app/HorarioEntregaPicker'
import { avisoInvalidada, claveDireccion, elegirOpcion, resumenDireccion, tarjetasEntrega, tituloModalidad, type Tarjeta } from './entregaUx'   // CX-V2-A/B

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

// CX-V2-B · estilos de la jerarquía (tokens del sistema; sin clases nuevas)
const SECCION: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }
const NOTA: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink-3)' }
const FILA: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: 'var(--ink-2)' }

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
  // CX-V2-A · regla de selección: se conserva la elección mientras siga siendo elegible; si deja de serlo se avisa y se
  // exige elegir de nuevo (nunca se cambia en silencio a recoger); sin elección previa, la única elegible o la sugerida.
  const [avisoEntrega, setAvisoEntrega] = useState<string | null>(null)
  const [verDireccion, setVerDireccion] = useState(false)   // CX-V2-B · selector de dirección desplegado
  const seccionDireccion = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!ops) return
    const r = elegirOpcion(ops, opcion)
    if (r.opcion !== opcion) setOpcion(r.opcion)
    if (r.invalidada) setAvisoEntrega(avisoInvalidada(r.invalidada, ops))
  }, [ops])   // eslint-disable-line react-hooks/exhaustive-deps
  const elegir = (id: string) => { setOpcion(id); setAvisoEntrega(null) }
  // CX-V2-A · las opciones y fletes se recalculan en el servidor cuando cambia la dirección (antes: solo al abrir y al confirmar).
  const claveDir = claveDireccion(choice)
  const revisadaCon = useRef<string | null>(null)   // dirección con la que ya revisó el servidor (la de apertura es la predeterminada)
  const dirRevision = motor.revision?.direccion?.location_id ? `loc:${motor.revision.direccion.location_id}` : motor.revision ? 'ninguna' : null
  useEffect(() => {
    if (!conServidor || dirRevision === null) return   // hasta que llegue la revisión de apertura
    if (revisadaCon.current === null) revisadaCon.current = dirRevision
    if (claveDir === 'ninguna' || claveDir === revisadaCon.current) return   // sin elección explícita el servidor ya usó la predeterminada
    revisadaCon.current = claveDir
    void motor.revisar({ address: choice?.address ?? null, locationId: choice?.locationId, opcion, horario: null })
  }, [claveDir, dirRevision])   // eslint-disable-line react-hooks/exhaustive-deps
  const necesitaDireccion = ops ? requiereDireccion(sel?.tipo) : true   // sin opciones (demo/fixtures) se exige dirección como antes
  const envio = ops ? (sel?.flete ?? null) : null
  // Total: el del servidor con envío cuando la revisión ya normalizó ESTA opción; si no, productos + flete de la opción (ambos del servidor).
  const totalConEnvio = ops && sel && motor.revision?.entrega?.opcion === sel.id && typeof motor.revision.total_con_envio === 'number'
    ? motor.revision.total_con_envio
    : total != null && envio != null ? total + envio : total
  const necesitaHorario = !!ops && requiereHorario(sel)
  const eleccion: EleccionEntrega = { address: choice?.address ?? null, locationId: choice?.locationId, opcion: ops ? opcion : null, horario: necesitaHorario ? horario : null }
  const conVolumen = lineas.some((l) => l.por_volumen)
  // CX-V2-B · solo las alternativas relevantes; la dirección aparece cuando hay entrega a domicilio en juego.
  const tarjetas: Tarjeta[] = ops ? tarjetasEntrega(ops, opcion, horario) : []
  // CX-V2-B hotfix · estados de carga ESTABLES: mientras llega la primera revisión se muestra un esqueleto (sin el selector
  // completo que luego desaparecería); al cambiar de dirección, las opciones quedan atenuadas y bloqueadas hasta que el
  // servidor responda por la dirección nueva; si la revisión falla, no se confirma con los datos anteriores.
  const cargandoInicial = conServidor && !motor.revision && !motor.errorRevision
  const dirPendiente = conServidor && claveDir !== 'ninguna' && revisadaCon.current !== null && claveDir !== revisadaCon.current
  const obsoleto = conServidor && !!ops && !cargandoInicial && (motor.revisando || dirPendiente || !!motor.errorRevision)   // con opciones en pantalla (lo que puede verse viejo)
  const pideDireccionEnTarjeta = tarjetas.some((t) => t.accion === 'direccion')
  const reintentar = () => { void motor.revisar({ address: choice?.address ?? null, locationId: choice?.locationId, opcion, horario: null }) }
  const desglose = !!ops && ((envio ?? 0) > 0 || conVolumen)
  const abrirDireccion = () => { setVerDireccion(true); setTimeout(() => seccionDireccion.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0) }

  const bloqueado = (necesitaDireccion && !choice?.address) || (!!ops && !sel) || (necesitaHorario && !horario) || creando || (invoice && !fiscalOk) || cargandoInicial || obsoleto
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
              {/* CX-V2-B · 1) resumen compacto de productos (el total va junto al botón, una sola vez) */}
              {lineas.map((l) => (
                <div key={l.product_id} className="coitem" data-testid="checkout-linea" style={{ fontSize: 13.5 }}>
                  <span>{l.nombre} <span style={{ color: 'var(--ink-3)' }}>×{l.qty}</span>{l.unitario != null && l.qty > 1 && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}> · {money(l.unitario)} c/u</span>}</span>
                  <span className="mono">{l.subtotal != null ? money(l.subtotal) : '—'}</span>
                </div>
              ))}
              {conServidor && motor.errorRevision && (
                <div role="alert" style={{ ...NOTA, color: 'var(--danger)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} data-testid="checkout-error-revision">
                  <span style={{ flex: 1 }}>{motor.errorRevision}</span>
                  <button className="btn ghost sm" type="button" onClick={reintentar} disabled={motor.revisando} data-testid="checkout-reintentar">Reintentar</button>
                </div>
              )}
              {avisoRevision && <div role="status" style={{ ...NOTA, color: 'var(--warn)', marginTop: 8 }} data-testid="checkout-aviso">Antes de pedir: {avisoRevision}.</div>}

              {/* CX-V2-B · 2) ¿Cómo quieres recibirlo? Solo lo que aplica a esta dirección y este pedido. */}
              {cargandoInicial && (
                <div data-testid="checkout-cargando" aria-busy="true" aria-live="polite" style={{ marginTop: 20 }}>
                  <div style={SECCION}>¿Cómo quieres recibirlo?</div>
                  <div style={{ display: 'grid', gap: 8 }}>{[0, 1].map((i) => <div key={i} style={{ height: 58, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2, #fafafa)' }} />)}</div>
                  <div style={{ ...SECCION, marginTop: 20 }}>Entregar en</div>
                  <div style={{ height: 46, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--surface-2, #fafafa)' }} />
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Calculando opciones de entrega…</span>
                </div>
              )}
              {!cargandoInicial && ops && (
                <div data-testid="checkout-entrega" aria-busy={obsoleto || undefined} style={{ marginTop: 20 }}>
                  <div style={SECCION}>¿Cómo quieres recibirlo?{obsoleto && !motor.errorRevision && <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 12 }} data-testid="checkout-actualizando"> · actualizando…</span>}</div>
                  {avisoEntrega && <div role="alert" style={{ ...NOTA, color: 'var(--warn)', margin: '0 0 8px' }} data-testid="checkout-entrega-aviso">{avisoEntrega}</div>}
                  <div role="radiogroup" aria-label="Forma de entrega" style={{ display: 'grid', gap: 8, opacity: obsoleto ? 0.5 : 1, pointerEvents: obsoleto ? 'none' : undefined, transition: 'opacity .15s' }}>
                    {tarjetas.map((t) => {
                      const on = opcion === t.id
                      return (
                        <label key={t.id} data-testid={`entrega-${t.id}`} aria-disabled={t.bloqueada || undefined}
                          style={{ display: 'block', padding: '12px 14px', borderRadius: 12, cursor: t.bloqueada ? 'default' : 'pointer',
                            border: on ? '1.5px solid var(--green-deep)' : t.bloqueada ? '1px dashed var(--line)' : '1px solid var(--line)',
                            background: on ? 'var(--ok-bg, #EAF4EC)' : t.bloqueada ? 'var(--surface-2, #fafafa)' : '#fff' }}
                          onClick={() => { if (!t.bloqueada) elegir(t.id) }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 24 }}>
                            {!t.bloqueada && <input type="radio" name="entrega" checked={on} onChange={() => elegir(t.id)} style={{ accentColor: 'var(--green-deep)', width: 18, height: 18, margin: 0, flex: 'none' }} />}
                            <b style={{ flex: 1, fontSize: 14, fontWeight: 600, color: t.bloqueada ? 'var(--ink-2)' : 'var(--ink)' }}>{t.titulo}</b>
                            <span className="mono" data-testid={`entrega-${t.id}-chip`} style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', color: t.bloqueada ? 'var(--ink-3)' : t.precio === 'Gratis' ? 'var(--green-deep)' : 'var(--ink)' }}>{t.precio}</span>
                          </span>
                          <span data-testid={`entrega-${t.id}-texto`} style={{ display: 'block', ...NOTA, marginTop: 3, paddingLeft: t.bloqueada ? 0 : 28 }}>{t.linea}</span>
                          {t.nota && <span data-testid={`entrega-${t.id}-nota`} style={{ display: 'block', ...NOTA, color: 'var(--ink-2)', marginTop: 2, paddingLeft: 28 }}>{t.nota}</span>}
                          {t.accion && (
                            <button className="btn ghost sm" type="button" style={{ marginTop: 10, marginLeft: t.bloqueada ? 0 : 28, minHeight: 36 }}
                              data-testid={t.accion === 'agregar' ? 'checkout-agregar' : 'checkout-agregar-direccion'}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (t.accion === 'agregar') onClose(); else abrirDireccion() }}>
                              {t.accion === 'agregar' ? 'Agregar productos' : 'Agregar dirección'}
                            </button>
                          )}
                        </label>
                      )
                    })}
                  </div>
                  {necesitaHorario && (
                    <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + (horario ? 'var(--line)' : 'var(--warn)'), borderRadius: 10, background: 'var(--surface-2, #fafafa)' }} data-testid="checkout-horario">
                      <div style={{ ...SECCION, margin: '0 0 8px', fontSize: 13 }}>¿A qué hora lo recibes? {!horario && <span style={{ fontWeight: 400, color: 'var(--warn)' }}>· elige un horario</span>}</div>
                      <HorarioEntregaPicker value={horario} onChange={setHorario} cargar={servidor?.cargarHorarios} compacto />
                    </div>
                  )}
                  {sel && sel.tipo !== 'recoge' && (
                    <div style={{ ...NOTA, marginTop: 8 }} data-testid="checkout-corte">
                      {ops.corte.antes_de_corte ? `Pedidos antes de las ${ops.corte.hora} salen el mismo día.` : `Después de las ${ops.corte.hora} sale el siguiente día hábil.`}
                    </div>
                  )}
                </div>
              )}

              {/* CX-V2-B · 3) dirección: solo cuando hay entrega a domicilio en juego; con "recoger" queda en una línea. El selector
                  sigue montado (conserva la dirección elegida y la predeterminada del doctor no se toca). */}
              {/* CX-V2-B hotfix · la dirección SIEMPRE se puede consultar o cambiar (también con "recoger"). Antes se ocultaba cuando
                  el selector reportaba null (ubicación predeterminada incompleta o varias sin predeterminada) y no había otra vía. */}
              <div ref={seccionDireccion} style={{ marginTop: 20, display: cargandoInicial || (!choice?.address && !verDireccion && pideDireccionEnTarjeta) ? 'none' : 'block' }} data-testid="checkout-direccion">
                <div style={SECCION}>{ops && sel?.tipo === 'recoge' ? 'Dirección para entrega a domicilio' : 'Entregar en'}</div>
                {ops && sel?.tipo === 'recoge' && <div style={{ ...NOTA, marginTop: -4, marginBottom: 6 }} data-testid="checkout-direccion-nota">No se usa para recoger en sucursal.</div>}
                {ops && choice?.address && !verDireccion && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }} data-testid="checkout-direccion-resumen">{resumenDireccion(choice.address)}</span>
                    <button className="btn ghost sm" type="button" style={{ minHeight: 36 }} onClick={() => setVerDireccion(true)} data-testid="checkout-direccion-cambiar">Cambiar</button>
                  </div>
                )}
                {ops && !choice?.address && !verDireccion && !necesitaDireccion && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px dashed var(--line)', borderRadius: 12, background: '#fff' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-2)' }} data-testid="checkout-direccion-pendiente">Elige a dónde te lo enviaríamos</span>
                    <button className="btn ghost sm" type="button" style={{ minHeight: 36 }} onClick={() => setVerDireccion(true)} data-testid="checkout-direccion-elegir">Elegir dirección</button>
                  </div>
                )}
                <div style={{ display: !ops || verDireccion || (!choice?.address && necesitaDireccion) ? 'block' : 'none' }} data-testid="checkout-direccion-selector">
                  <DeliveryLocationPicker legacyBase={base} onChange={setChoice} />
                  {ops && verDireccion && (
                    <div style={{ textAlign: 'right', marginTop: 6 }}><button className="btn ghost sm" type="button" onClick={() => setVerDireccion(false)} data-testid="checkout-direccion-listo">{choice?.address ? 'Listo' : 'Cerrar'}</button></div>
                  )}
                </div>
              </div>

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
              {/* CX-V2-B · 4) total final junto a la acción; desglose solo cuando aporta (envío con costo o precio por volumen) */}
              <div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--line)' }} data-testid="checkout-pie">
                {desglose && (
                  <div data-testid="checkout-desglose" style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                    <div style={FILA} data-testid="checkout-productos"><span>Productos</span><span className="mono">{total != null ? money(total) : '—'}</span></div>
                    {conVolumen && <div style={{ ...FILA, color: 'var(--green-deep)' }} data-testid="checkout-volumen"><span>Precio por volumen aplicado</span><span /></div>}
                    {sel && <div style={FILA} data-testid="checkout-envio"><span>Envío <span style={{ color: 'var(--ink-3)' }}>· {sel.paqueteria === 'dhl' || sel.paqueteria === 't1' ? sel.paqueteria.toUpperCase() : tituloModalidad(sel).toLowerCase()}</span></span><span className="mono">{fleteTexto(sel.flete, money)}</span></div>}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Total</div>
                    <b data-testid="checkout-total" style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', opacity: obsoleto ? 0.5 : 1 }}>{cargandoInicial ? 'Calculando…' : totalConEnvio != null ? money(totalConEnvio) : motor.revisando ? 'Calculando…' : '—'}</b>
                  </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" onClick={confirm} disabled={bloqueado} aria-busy={creando} style={bloqueado ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} data-testid="checkout-crear"><Icon name="check" /> {creando ? 'Creando pedido…' : 'Crear pedido'}</button>
              </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Capa>
  )
}
