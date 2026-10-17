// Levantar pedido A NOMBRE de un doctor (Ventas sobre su cartera, o Dirección).
// Crea un pedido contra pedido idéntico a uno del Portal → cae solo en Almacén →
// Preparar pedidos. Respeta el stock (mismo tope que el catálogo del doctor).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { money } from '../../lib/format'
import { hasSupabase, supabase } from '../../lib/supabase'
import { FiscalFields, FiscalSummary } from '../../app/FiscalFields'
import { customerFiscal, upsertCustomerFiscal } from '../../data/store/customersStore'
import { emptyFiscalProfile, isFiscalProfileComplete, normalizeFiscalProfile, type FiscalProfile } from '../../data/ops/fiscal'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useLots } from '../../data/hooks/useLots'
import { useOrders } from '../../data/hooks/useOrders'
import { useVolumePrices } from '../../data/hooks/useVolumePrices'
import { effectiveUnitPrice, volumeSavings, volumePromoLabel } from '../../data/ops/volumePricing'
import { stockByProduct, stockInfoFor } from '../../data/ops/stock'
import { DeliveryLocationPicker, type DeliveryChoice } from '../../app/DeliveryLocationPicker'
import { DomicilioClientePicker, type DomicilioElegido } from '../../app/DomicilioClientePicker'
import { SelectorEntrega, eleccionCompleta } from '../../app/SelectorEntrega'
import { promesaDe, requiereDireccion, opcionDe, type EleccionEntregaServidor, type OpcionesEntrega } from '../../data/ops/entrega'
import { clientOf } from '../../data/mock/profiles'
import type { ShippingAddress } from '../../data/ops/shippingAddress'
import { useRole } from '../../auth/RoleContext'
import type { MotivoFallo } from '../../data/store/ordersStore'

// SEC-C4-FISCAL-3-FE · UNA operación de alta = un identificador estable (id + folio) que se reutiliza en cada reintento
// de la MISMA solicitud. Tras un resultado incierto se reenvía la solicitud ORIGINAL congelada (nunca un id nuevo);
// un conflicto no se elude con otro id. El servidor decide si el pedido existe (crear_pedido_con_receptor / crear_pedido).
type Solicitud = Omit<Parameters<ReturnType<typeof useOrders>['createOrder']>[0], 'operacion'>
interface Intento { op: { id: string; folio: string }; huella: string; solicitud: Solicitud; incierto: boolean }
const nuevaOperacion = () => ({
  id: globalThis.crypto?.randomUUID?.() ?? `o-${Math.random().toString(16).slice(2)}`,
  folio: `S${Date.now().toString().slice(-6)}`,
})
// Huella de lo que se pide (sin el texto libre de quien captura): mismos renglones, cuenta, envío, factura y receptor.
const huellaDe = (s: Solicitud) => JSON.stringify([
  [...s.lines].map((l) => `${l.product_id}:${l.qty}`).sort(), s.doctor_id ?? null, s.customer_id ?? null, s.location_id ?? null,
  s.shipping ?? null, s.invoice_requested, s.invoice_requested && s.receiver ? normalizeFiscalProfile(s.receiver) : null,
  s.entrega ?? null,   // ENT-2 · cómo se entrega (opción, flete ajustado y motivo)
])

// Levantar pedido "a nombre de" un DOCTOR (portal/legacy) o un CUSTOMER comercial (sin Auth).
// Exactamente uno de doctor|customer. Customer-only ⇒ doctor_id NULL + customer_id + snapshot.
export function NuevoPedido({ doctor, customer, placedBy, onClose, initialCart, onCreado }: {
  doctor?: { id: string; name: string }
  customer?: { id: string; name: string; phone?: string | null }
  placedBy: string
  onClose: () => void
  /** ENT-POS · carrito que ya armó el Punto de venta (product_id → cantidad): el pedido con entrega arranca con él. */
  initialCart?: Record<string, number>
  onCreado?: () => void
}) {
  const isCustomer = !!customer
  // SEC-C4-B5 · DATOS FISCALES DEL PEDIDO ≠ PERFIL FISCAL PERMANENTE DEL CLIENTE.
  // Solo Dirección consulta y actualiza el perfil permanente desde aquí. Los demás (Ventas) capturan el receptor
  // SOLO para este pedido: no se lee el expediente fiscal de la cuenta ni se escribe en él; el servidor lo congela
  // en el pedido EN LA MISMA TRANSACCIÓN que lo crea (crear_pedido_con_receptor) y lo valida. Elegir una cuenta no da
  // acceso a su perfil fiscal.
  const { role } = useRole()
  const fiscalPermanente = role === 'admin'
  const target = customer ?? doctor!
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { createOrder } = useOrders()
  const { data: volRules } = useVolumePrices()
  const stockMap = useMemo(() => stockByProduct(lots), [lots])
  const sellable = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p) && p.sellable !== false), [products])
  // Precio unitario efectivo previsto = LEAST(base, volumen). El servidor (crear_pedido) es la autoridad.
  const effOf = (p: { id: string; price: number | null }, qty: number): number | null => effectiveUnitPrice(p.price, volRules, p.id, qty)

  // Domicilio base SOLO aplica al flujo doctor (perfil legacy). Customer captura dirección one-off.
  const ci = !isCustomer && doctor ? clientOf(doctor.id) : null
  const baseAddr: ShippingAddress | null = ci && ci.address && ci.address !== '—'
    ? { line1: ci.address, city: ci.city !== '—' ? ci.city : '', phone: ci.phone }
    : null

  const [cart, setCart] = useState<Record<string, number>>(() => initialCart ?? {})
  const [invoice, setInvoice] = useState(false)
  const [choice, setChoice] = useState<DeliveryChoice | null>(null)   // flujo doctor
  const [custDom, setCustDom] = useState<DomicilioElegido | null>(null) // flujo customer: domicilio guardado, otro o nuevo
  // ENT-2 · entrega elegida por el vendedor (id de la opción del servidor; flete ajustado con motivo si lo cambia).
  const [entrega, setEntrega] = useState<EleccionEntregaServidor | null>(null)
  const [opsEntrega, setOpsEntrega] = useState<OpcionesEntrega | null>(null)
  const [promesa, setPromesa] = useState<{ texto: string; promesa: string; flete: number } | null>(null)
  const [folio, setFolio] = useState<string | null>(null)
  const [repetido, setRepetido] = useState(false)                 // el servidor confirmó un envío anterior del mismo pedido
  const shipping = isCustomer ? (custDom?.address ?? null) : (choice?.address ?? null)
  const locationId = isCustomer ? custDom?.locationId ?? null : choice?.locationId ?? null
  const tipoEntrega = opcionDe(opsEntrega, entrega?.opcion)?.tipo ?? null
  const entregaNecesitaDireccion = opsEntrega ? requiereDireccion(tipoEntrega) : true   // sin opciones (demo) se exige dirección como antes
  const entregaLista = hasSupabase ? eleccionCompleta(entrega, opsEntrega) : true

  // Perfil fiscal (CFDI): AUTORIDAD = customers.meta.fiscal (master). Se precarga y se puede editar.
  const [fiscal, setFiscal] = useState<FiscalProfile>(emptyFiscalProfile())
  const [fiscalCustomerId, setFiscalCustomerId] = useState<string | null>(null)
  const [fiscalLoaded, setFiscalLoaded] = useState(false)
  const [editingFiscal, setEditingFiscal] = useState(false)
  const [showFiscalErr, setShowFiscalErr] = useState(false)
  const [savingFiscal, setSavingFiscal] = useState(false)
  // El pedido solo "se creó" cuando el servidor lo confirmó. Mientras tanto el
  // botón queda ocupado, para que un segundo clic no mande otro pedido.
  const [creando, setCreando] = useState(false)
  const [errorPedido, setErrorPedido] = useState<{ msg: string; motivo: MotivoFallo } | null>(null)
  const enviando = useRef(false)                 // candado SÍNCRONO: un doble clic no alcanza a mandar dos solicitudes
  const intento = useRef<Intento | null>(null)   // la operación en curso (su id se conserva entre reintentos)
  const fiscalOk = isFiscalProfileComplete(fiscal)

  useEffect(() => {
    if (!invoice || fiscalLoaded) return
    ;(async () => {
      if (!fiscalPermanente) {
        setEditingFiscal(true)                         // captura para el pedido: formulario en blanco, sin lecturas
      } else if (hasSupabase && isCustomer && customer?.id) {
        setFiscalCustomerId(customer.id)
        const { data } = await supabase.from('customers').select('meta').eq('id', customer.id).maybeSingle()
        const m = customerFiscal(data as { meta: unknown } | null); setFiscal(m); setEditingFiscal(!isFiscalProfileComplete(m))
      } else if (hasSupabase && doctor?.id) {
        const { data: cust } = await supabase.from('customers').select('id, meta').eq('profile_id', doctor.id).maybeSingle()
        if (cust?.id) setFiscalCustomerId(cust.id)
        let m = customerFiscal(cust as { meta: unknown } | null)
        if (!m.rfc) {
          const { data: prof } = await supabase.from('profiles').select('meta').eq('id', doctor.id).maybeSingle()
          const legacy = (prof?.meta as { fiscal?: unknown } | null)?.fiscal
          if (legacy) m = normalizeFiscalProfile(legacy)
        }
        setFiscal(m); setEditingFiscal(!isFiscalProfileComplete(m))
      } else {
        setEditingFiscal(true)
      }
      setFiscalLoaded(true)
    })()
  }, [invoice, fiscalLoaded, fiscalPermanente])

  const add = (id: string) => setCart((c) => {
    const info = stockInfoFor(stockMap, id)
    const max = info.tracked ? info.qty : 0
    const next = (c[id] ?? 0) + 1
    return next > max ? c : { ...c, [id]: next }
  })
  const dec = (id: string) => setCart((c) => {
    const q = (c[id] ?? 0) - 1
    if (q <= 0) { const { [id]: _d, ...rest } = c; return rest }
    return { ...c, [id]: q }
  })

  const lines = Object.entries(cart).map(([id, qty]) => ({ p: sellable.find((x) => x.id === id), qty })).filter((l) => l.p)
  const total = lines.reduce((s, l) => s + (effOf(l.p!, l.qty) ?? l.p!.price ?? 0) * l.qty, 0)
  const savings = lines.reduce((s, l) => s + volumeSavings(l.p!.price, volRules, l.p!.id, l.qty), 0)

  const solicitudActual = (): Solicitud => ({
    lines: lines.map((l) => ({ product_id: l.p!.id, qty: l.qty, unit_price: effOf(l.p!, l.qty) ?? l.p!.price })),
    total,
    invoice_requested: invoice,
    placedBy,
    shipping,
    receiver: invoice ? normalizeFiscalProfile(fiscal) : null,   // sin factura no viaja receptor (D-F3)
    ...(hasSupabase && entrega ? { entrega } : {}),   // ENT-2 · la entrega viaja con el pedido (una transacción)
    ...(isCustomer
      ? { customer_id: customer!.id, customer: { name: customer!.name, phone: customer!.phone ?? null }, location_id: locationId }
      : { doctor_id: doctor!.id, location_id: locationId }),
  })
  const pendienteIncierto = intento.current?.incierto ?? false
  const bloqueado = errorPedido?.motivo === 'conflicto'

  const enviar = async (it: Intento) => {
    intento.current = it
    setCreando(true); setErrorPedido(null)
    try {
      const r = await createOrder({ ...it.solicitud, operacion: it.op })
      if (r.ok) {
        intento.current = null; setRepetido(!!r.repetido)
        const e = (r.order.shipping_meta as { entrega?: { texto?: string; flete?: number; tipo?: string; salida?: string; llega_desde?: string; llega_hasta?: string; recoge?: { lugar: string; horario: string } } } | null)?.entrega
        if (e?.texto && e.tipo && e.salida && e.llega_desde && e.llega_hasta) setPromesa({ texto: e.texto, flete: Number(e.flete ?? 0), promesa: promesaDe({ tipo: e.tipo as 'recoge', salida: e.salida, llega_desde: e.llega_desde, llega_hasta: e.llega_hasta, recoge: e.recoge }, opsEntrega?.corte.hoy) })
        setFolio(r.order.external_ref ?? it.op.folio); onCreado?.(); return
      }
      const motivo: MotivoFallo = r.incierto ? 'incierto' : (r.motivo ?? (r.ambiguous ? 'incierto' : 'rechazo'))
      // Incierto: se congela la solicitud ORIGINAL y su id; el siguiente clic la reenvía tal cual.
      // Fiscal: el servidor no creó nada; se corrige el receptor y el siguiente envío es una operación nueva.
      intento.current = motivo === 'fiscal' ? null : { ...it, incierto: motivo === 'incierto' }
      if (motivo === 'fiscal') { setShowFiscalErr(true); setEditingFiscal(true) }
      setErrorPedido({ msg: r.error, motivo })
    } finally {
      setCreando(false); enviando.current = false
    }
  }

  const crear = async () => {
    if (enviando.current || bloqueado) return
    const previo = intento.current
    if (previo?.incierto) { enviando.current = true; await enviar(previo); return }   // MISMA operación, mismo contenido
    if (lines.length === 0 || (entregaNecesitaDireccion && !shipping) || !entregaLista) return
    if (invoice && !fiscalOk) { setShowFiscalErr(true); setEditingFiscal(true); return } // HARD GATE
    enviando.current = true
    if (invoice && fiscalPermanente && fiscalCustomerId && editingFiscal) {
      setSavingFiscal(true)
      const res = await upsertCustomerFiscal(fiscalCustomerId, fiscal)
      setSavingFiscal(false)
      if (!res.ok) { enviando.current = false; window.alert(res.error ?? 'No se pudieron guardar los datos fiscales.'); return }
    }
    const solicitud = solicitudActual()
    const huella = huellaDe(solicitud)
    // Mismo contenido que un intento anterior ya resuelto sin pedido (rechazo, sesión) ⇒ mismo id; si cambió ⇒ id nuevo.
    await enviar({ op: previo && previo.huella === huella ? previo.op : nuevaOperacion(), huella, solicitud, incierto: false })
  }
  const formCambio = pendienteIncierto && intento.current ? huellaDe(solicitudActual()) !== intento.current.huella : false
  const deshabilitado = bloqueado || creando || savingFiscal || (!pendienteIncierto && (lines.length === 0 || (entregaNecesitaDireccion && !shipping) || !entregaLista || (invoice && !fiscalOk)))
  const flete = hasSupabase && entrega ? (entrega.flete ?? opcionDe(opsEntrega, entrega.opcion)?.flete ?? 0) : 0

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {folio ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Plus size={26} /></div>
              <h3>{repetido ? 'Pedido confirmado' : 'Pedido creado'}</h3>
              <p>El pedido <b>{folio}</b> para <b>{target.name}</b> quedó como <b>contra pedido</b> y ya aparece en Almacén → Preparar pedidos.</p>
              {promesa && <p data-testid="np-promesa" style={{ fontSize: 13.5 }}><b>{promesa.texto}</b>{promesa.flete > 0 ? ` · flete ${money(promesa.flete)}` : ' · sin flete'}<br />{promesa.promesa}</p>}
              {repetido && <p className="ms" data-testid="np-repetido" style={{ color: 'var(--ink-3)' }}>Ya había quedado registrado en el envío anterior; no se creó otro.</p>}
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div><h3>Levantar pedido</h3><div className="ms">A nombre de {target.name}{isCustomer ? ' · cliente comercial' : ''}</div></div>
              <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
            </div>
            <div className="mbody">
              <div style={{ display: 'grid', gap: 8, maxHeight: '46vh', overflow: 'auto' }}>
                {sellable.map((p) => {
                  const qty = cart[p.id] ?? 0
                  const stock = stockInfoFor(stockMap, p.id)
                  const out = !stock.tracked || stock.qty <= 0
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 12, opacity: out ? 0.55 : 1 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                          {qty > 0 && (effOf(p, qty) ?? 0) < (p.price ?? 0) ? <b style={{ color: 'var(--green-deep)' }}>{money(effOf(p, qty))}</b> : money(p.price)}{out ? ' · Agotado' : stock.status === 'low' ? ` · Quedan ${stock.qty}` : ''}
                        </div>
                        {(() => { const promo = volumePromoLabel(p.price, volRules, p.id); return promo ? <div style={{ fontSize: 11, color: 'var(--green-deep)', fontWeight: 600 }}>{promo}</div> : null })()}
                      </div>
                      {qty > 0 && <button className="btn ghost sm" type="button" onClick={() => dec(p.id)}><Minus size={14} /></button>}
                      {qty > 0 && <span className="mono" style={{ minWidth: 18, textAlign: 'center' }}>{qty}</span>}
                      <button className="btn sm" type="button" disabled={out} style={out ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => add(p.id)}><Plus size={14} /></button>
                    </div>
                  )
                })}
              </div>

              {savings > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12.5, color: 'var(--green-deep)', fontWeight: 600 }}><span>Descuento por volumen</span><span>−{money(savings)}</span></div>}
              {flete > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12.5 }} data-testid="np-flete"><span>Flete</span><span className="mono">{money(flete)}</span></div>}
              <div className="cototal" style={{ marginTop: 14 }}><span>Total</span><b data-testid="np-total">{money(total + flete)}</b></div>

              <div className="eyebrow" style={{ marginTop: 14 }}>Dirección de entrega{opsEntrega && !entregaNecesitaDireccion ? <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}> · opcional para esta entrega</span> : null}</div>
              {isCustomer
                ? <DomicilioClientePicker customerId={customer!.id} onChange={setCustDom} />
                : <DeliveryLocationPicker doctorId={doctor!.id} legacyBase={baseAddr} allowManage={false} onChange={setChoice} />}

              {hasSupabase && (
                <>
                  <div className="eyebrow" style={{ marginTop: 14 }}>Entrega</div>
                  <SelectorEntrega subtotal={total} cp={shipping?.cp ?? null} value={entrega} onChange={(e, ops) => { setEntrega(e); setOpsEntrega(ops) }} />
                </>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} /> Solicitar factura (CFDI)
              </label>
              {invoice && (
                <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2, #fafafa)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="eyebrow" style={{ margin: 0 }}>{fiscalPermanente ? 'Datos fiscales del cliente' : 'Datos fiscales para este pedido'}</div>
                    {fiscalPermanente && fiscalOk && !editingFiscal && <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setEditingFiscal(true)}>Editar</button>}
                  </div>
                  {!fiscalPermanente && <div className="ms" style={{ color: 'var(--ink-3)', marginTop: 6 }} data-testid="np-fiscal-solo-pedido">Se guardan solo en este pedido. El perfil fiscal del cliente no se consulta ni se modifica.</div>}
                  {!fiscalLoaded ? (
                    <div className="ms" style={{ color: 'var(--ink-3)', marginTop: 8 }}>Cargando…</div>
                  ) : editingFiscal ? (
                    <FiscalFields value={fiscal} onChange={setFiscal} showErrors={showFiscalErr} />
                  ) : (
                    <FiscalSummary value={fiscal} />
                  )}
                  {!fiscalOk && <div className="ms" style={{ color: 'var(--warn)', marginTop: 8 }}>Completa los datos fiscales para poder solicitar la factura.</div>}
                </div>
              )}

              {errorPedido && (
                <div role="alert" data-testid={`np-error-${errorPedido.motivo}`} style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: errorPedido.motivo === 'incierto' ? 'var(--warn-bg, var(--danger-bg))' : 'var(--danger-bg)', color: errorPedido.motivo === 'incierto' ? 'var(--warn, var(--danger))' : 'var(--danger)', fontSize: 13 }}>
                  <b>{errorPedido.motivo === 'incierto' ? 'No se pudo confirmar el pedido.' : errorPedido.motivo === 'conflicto' ? 'No se creó un pedido nuevo.' : errorPedido.motivo === 'fiscal' ? 'El pedido no se creó: revisa los datos fiscales.' : 'El pedido no se creó.'}</b> {errorPedido.msg}
                  {formCambio && <div data-testid="np-reenvio-original" style={{ marginTop: 6 }}>Se reenviará el pedido ORIGINAL; los cambios que hiciste después no se aplican hasta confirmarlo.</div>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" disabled={deshabilitado} style={deshabilitado ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={crear}>{savingFiscal ? 'Guardando…' : creando ? 'Creando pedido…' : pendienteIncierto ? 'Reintentar envío' : 'Crear pedido'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
