// Cola de empaque: pedidos en estado "Empacado" (surtidos por Almacén), listos
// para enviar. Asignar envío por paquetería (carrier+guía) o chofer propio.
// Al asignar se crea el shipment y el pedido pasa a "En camino".
import { Vacio } from '../../app/EmptyState'
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate, money } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useShipments } from '../../data/hooks/useShipments'
import { markShipped } from '../../data/store/ordersStore'
import { getDrivers } from '../../data/mock/shipments'
import { quoteShipment, createShipmentReal, NOMBRE_PROVEEDOR, type RateQuote, type LabelResult, type ProveedorPaqueteria } from '../../data/shipping/provider'
import { orderAddress } from '../../data/ops/shippingAddress'
import { shipperFromCompany } from '../../data/shipping/shipper'
import { currentCompany } from '../../data/store/companyStore'
import { missingForShipment } from '../../data/shipping/validate'
import { cpSugerido, faltantesEntrega, receptorParaGuia } from '../../data/shipping/entregaGuia'
import type { LogisticsPackage, Receiver } from '../../data/shipping/model'
import type { ProductSafe } from '../../data/types'
import { BotonRemision } from './Remision'
import { useRole } from '../../auth/RoleContext'
import { CancelOrderModal } from '../../app/CancelOrderModal'
import { AvisoCancelacion, SolicitarCancelacion } from '../../app/Cancelacion'
import { solicitudDe, useSolicitudesCancelacion } from '../../data/ops/cancelacionSolicitud'
import { promesaDe, type EntregaPedido } from '../../data/ops/entrega'
import { listarEmpaques, medidasTexto, type Empaque } from '../../data/ops/empaques'

// Destinatario REAL del pedido: sale del snapshot autoritativo del pedido
// (shipping_meta.address + customer). NUNCA de mock ni con CP placeholder; si
// falta un dato obligatorio, la validación lo bloquea con el detalle exacto.
function receiverOf(order: OrderWithItems): Receiver {
  const meta = (order.shipping_meta ?? {}) as { customer?: { name?: string; phone?: string | null } | null }
  const address = orderAddress(order.shipping_meta, null) ?? { line1: '' }
  const name = meta.customer?.name ?? ''
  return { name, address: { ...address, phone: address.phone ?? meta.customer?.phone ?? '' } }
}

// ENT-3 · La entrega que se prometió al crear el pedido (tipo, paquetería, salida y llegada) manda en Empaque:
// ordena la cola por el día de salida y preselecciona el método; nunca se inventa otra fecha.
export function entregaDe(order: OrderWithItems): EntregaPedido | null {
  const m = order.shipping_meta && typeof order.shipping_meta === 'object' ? (order.shipping_meta as { entrega?: EntregaPedido | null }) : null
  return m?.entrega ?? null
}
export function ordenarPorSalida<T extends OrderWithItems>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    const ea = entregaDe(a)?.salida ?? '9999-12-31', eb = entregaDe(b)?.salida ?? '9999-12-31'
    return ea < eb ? -1 : ea > eb ? 1 : (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1
  })
}
export function metodoSugerido(e: EntregaPedido | null): Method {
  if (!e) return 'paqueteria'
  return e.tipo === 'recoge' || e.tipo === 'mostrador' ? 'recoge' : e.paqueteria === 'chofer' ? 'chofer' : 'paqueteria'
}
const hoyLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function EntregaPill({ e }: { e: EntregaPedido | null }) {
  if (!e) return null
  const hoy = hoyLocal()
  const atrasado = e.salida < hoy
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px', fontSize: 12.5 }} data-testid="cola-entrega">
      <span className={'pill ' + (atrasado ? 'p-dang' : e.salida === hoy ? 'p-warn' : 'p-neu')}>{atrasado ? 'Debió salir el ' + e.salida.slice(8, 10) + '/' + e.salida.slice(5, 7) : e.salida === hoy ? 'Sale hoy' : 'Sale ' + e.salida.slice(8, 10) + '/' + e.salida.slice(5, 7)}</span>
      <b>{e.texto}</b>
      <span style={{ color: 'var(--ink-3)' }}>· {promesaDe(e, hoy)}{e.flete ? ` · flete ${money(e.flete)}` : ''}</span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
  borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 6px',
}

export function Cola() {
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const [active, setActive] = useState<OrderWithItems | null>(null)
  // CANCELACIÓN · Dirección cancela directo; los demás la solicitan. Con una solicitud pendiente no se envía.
  const { role } = useRole()
  const esDireccion = role === 'admin'
  const solicitudes = useSolicitudesCancelacion()
  const [cancelando, setCancelando] = useState<OrderWithItems | null>(null)

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const queue = ordenarPorSalida(orders.filter((o) => o.status === 'packed'))   // ENT-3 · primero lo que debe salir antes

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Envíos · Por enviar</div>

      {queue.length === 0 ? (
        <Vacio icono="pkg" titulo="No hay pedidos empacados pendientes de envío." pista="Surte un pedido en Almacén para que llegue aquí." />
      ) : (
        queue.map((o) => { const sol = solicitudDe(solicitudes, o.id); return (
          <div key={o.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
              <span className="pill p-blue"><span className="d" /> Empacado</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(o.created_at)}</span>
            </div>
            <EntregaPill e={entregaDe(o)} />
            {o.items.map((it) => (
              <div key={it.id} className="coitem">
                <span>{byId[it.product_id ?? '']?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{it.qty}</span></span>
                <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
              </div>
            ))}
            {sol && <AvisoCancelacion solicitud={sol} esDireccion={esDireccion} />}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
              <button className="btn" type="button" onClick={() => setActive(o)} disabled={!!sol} title={sol ? 'Hay una cancelación por resolver' : undefined}>
                <Icon name="truck" /> Asignar envío
              </button>
              <BotonRemision order={o} className="btn ghost" />
              {!sol && (esDireccion
                ? <button className="btn ghost" type="button" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => setCancelando(o)} data-testid="btn-cancelar-pedido">Cancelar pedido</button>
                : <span style={{ marginLeft: 'auto' }}><SolicitarCancelacion orderId={o.id} folio={o.external_ref ?? o.id} className="btn ghost" /></span>)}
            </div>
          </div>
        ) })
      )}
      {cancelando && <CancelOrderModal orderId={cancelando.id} folio={cancelando.external_ref ?? cancelando.id} requireReason actor="Administración" onClose={() => setCancelando(null)} />}

      {active && <AsignarModal order={active} onClose={() => setActive(null)} />}
    </div>
  )
}

type Method = 'paqueteria' | 'chofer' | 'recoge'
/** Errores del seam (proveedor sin llaves) en palabras; lo demás pasa tal cual. */
export function mensajeProveedor(m: string): string {
  if (m === 't1_not_configured') return 'T1 Envíos no está configurado en el servidor (faltan las llaves de la API). Cotiza con DHL o pide a Dirección activar T1.'
  if (m === 'shipping_not_configured') return 'DHL no está configurado en el servidor (faltan las llaves). Pide a Dirección activarlo.'
  return m
}

export function AsignarModal({ order, onClose }: { order: OrderWithItems; onClose: () => void }) {
  const { createShipment } = useShipments()
  const entregaPedido = useMemo(() => entregaDe(order), [order])
  const sugerido = metodoSugerido(entregaPedido)
  const [method, setMethod] = useState<Method>(sugerido)   // ENT-3 · lo que se vendió manda; Empaque puede cambiarlo a sabiendas
  // T1 · proveedor de la guía: lo que se vendió (DHL o T1) sugiere; Empaque puede cambiarlo. T1 cotiza varias paqueterías a la vez.
  const [proveedor, setProveedor] = useState<ProveedorPaqueteria>(entregaPedido?.paqueteria === 't1' ? 't1' : 'dhl')
  const [doneRecoge, setDoneRecoge] = useState(false)
  const [driverId, setDriverId] = useState('')

  // Paquetería: datos reales del pedido/empresa → validar → cotizar → guía.
  // El pedido manda. Si su domicilio no trae C.P. estructurado o teléfono utilizable (domicilios en texto libre),
  // empaque los captura SOLO para esta guía; el C.P. detectado en el texto es una sugerencia, no un valor por defecto.
  const destino = useMemo(() => receiverOf(order), [order])
  const faltaEntrega = useMemo(() => faltantesEntrega(destino), [destino])
  const sugerenciaCp = useMemo(() => (faltaEntrega.cp ? cpSugerido(destino) : null), [destino, faltaEntrega.cp])
  const [entrega, setEntrega] = useState({ cp: '', phone: '' })
  const receiver = useMemo(() => receptorParaGuia(destino, entrega), [destino, entrega])
  const shipperInfo = useMemo(() => shipperFromCompany(currentCompany()), [])
  // Paquete FÍSICO final: se captura en empaque. SIN defaults silenciosos (vacío
  // hasta que el operador lo mida). pieces por defecto 1 (bulto único).
  const [parcel, setParcel] = useState({ weightKg: '', lengthCm: '', widthCm: '', heightCm: '', pieces: '1' })
  // EMP-1 · empaque del catálogo: elegirlo llena las medidas (el peso final se captura siempre). "Otra medida" = a mano.
  const [empaques, setEmpaques] = useState<Empaque[] | null>(null)
  const [empaqueId, setEmpaqueId] = useState<string>('')
  useEffect(() => { let vivo = true; (async () => { const r = await listarEmpaques(); if (vivo) setEmpaques(r.ok ? r.data : []) })(); return () => { vivo = false } }, [])
  const elegirEmpaque = (id: string) => {
    setEmpaqueId(id); setRates(null)
    const e = empaques?.find((x) => x.id === id)
    if (e) setParcel((p) => ({ ...p, lengthCm: String(e.largo_cm), widthCm: String(e.ancho_cm), heightCm: String(e.alto_cm), weightKg: p.weightKg || (e.peso_kg ? String(e.peso_kg) : '') }))
  }
  const [rates, setRates] = useState<RateQuote[] | null>(null)
  const [rateId, setRateId] = useState('')
  const [busy, setBusy] = useState<false | 'quote' | 'label' | 'chofer'>(false)
  const [result, setResult] = useState<LabelResult | null>(null)
  const [doneChofer, setDoneChofer] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pkg: LogisticsPackage = {
    weightKg: Number(parcel.weightKg), lengthCm: Number(parcel.lengthCm),
    widthCm: Number(parcel.widthCm), heightCm: Number(parcel.heightCm), pieces: Number(parcel.pieces),
  }
  const orderRef = order.external_ref ?? order.id
  // Faltantes exactos (remitente + destinatario + paquete). Bloquea si hay alguno.
  const missing = missingForShipment({ shipper: shipperInfo.config, receiver, pkg })

  const cotizar = async () => {
    setError(null)
    if (missing.length) return
    setBusy('quote'); setRates(null); setRateId('')
    try {
      const r = await quoteShipment(shipperInfo.config, receiver, pkg, orderRef, proveedor)
      setRates(r); setRateId(r[0]?.id ?? '')
    } catch (e) { setError(mensajeProveedor((e as Error).message) || 'No se pudo cotizar.') }
    setBusy(false)
  }

  const generarGuia = async () => {
    const rate = rates?.find((r) => r.id === rateId)
    if (!rate || busy) return
    if (missing.length) return
    setBusy('label'); setError(null)
    try {
      const { label } = await createShipmentReal({
        order_id: order.id, orderRef, idempotencyKey: `${order.id}:${rate.id}`,
        shipper: shipperInfo.config, receiver, pkg, rate, provider: proveedor,
      })
      // DHL persiste el shipment server-side (idempotente). Solo el mock inserta en cliente.
      if (label.provider === 'mock' || !label.provider) {
        await createShipment({
          order_id: order.id, carrier: label.carrier, tracking_number: label.tracking,
          label_url: label.labelUrl, driver_id: null, estimated_delivery_at: label.estimatedDeliveryAt, status: 'in_transit',
        })
      }
      const enviado = await markShipped(order.id, { method: 'paqueteria', carrier: label.carrier, tracking: label.tracking, label_url: label.labelUrl })
      // La guía YA existe aunque el pedido no haya cambiado de estado: se muestra
      // siempre, para que el operador no pierda el número de rastreo, y se le dice
      // exactamente qué fue lo que no quedó.
      setResult(label)
      if (!enviado.ok) setError(`La guía ${label.tracking} sí se generó, pero el pedido NO se marcó como enviado. ${enviado.error}`)
    } catch (e) { setError(mensajeProveedor((e as Error).message) || 'No se pudo generar la guía. El pedido NO se marcó como enviado.') }
    setBusy(false)
  }

  const asignarChofer = async () => {
    if (!driverId) return
    const drv = getDrivers().find((d) => d.id === driverId)
    setBusy('chofer'); setError(null)
    const r = await createShipment({
      order_id: order.id, carrier: null, tracking_number: null, driver_id: driverId,
      estimated_delivery_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'por_despachar',
    })
    setBusy(false)
    if (!r.ok) { setError(`No se asignó el chofer. ${r.error}`); return }
    // R-62: NO marcamos el pedido "En camino" aquí (sigue en el almacén, por_despachar). El
    // chofer y el manifiesto ya lo ven por el shipment. El pedido pasa a "enviado" al DESPACHAR
    // el manifiesto (Despacho), para no falsear el Tablero mostrando en tránsito lo que sigue
    // en el estante. (drv se usa solo para el mensaje de confirmación de abajo.)
    void drv
    setDoneChofer(true)
  }

  // ENT-3 · Recoger en sucursal / mostrador: no hay guía ni chofer; el pedido queda "listo para recoger" (enviado) y se
  // entrega al cliente desde Seguimiento cuando pase por él.
  const listoParaRecoger = async () => {
    setBusy('chofer'); setError(null)
    const r = await markShipped(order.id, { method: 'recoge', carrier: null, tracking: null })
    setBusy(false)
    if (!r.ok) { setError(`No se marcó como listo para recoger. ${r.error}`); return }
    setDoneRecoge(true)
  }
  const f2: React.CSSProperties = { ...inputStyle }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Guía generada</h3>
              <p>
                <b>{order.external_ref}</b> va por <b>{result.carrier} · {result.service}</b>.{result.ambiente === 'test' && <> <span className="pill p-warn" data-testid="guia-sandbox">T1 · ambiente de pruebas: no es un envío real</span></>}
                Guía <b className="mono">{result.tracking}</b> · entrega estimada {fmtDate(result.estimatedDeliveryAt)}.
                El doctor ya la ve en su seguimiento.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
                <a className="btn" href={result.labelUrl} target="_blank" rel="noreferrer"><Icon name="download" /> Imprimir etiqueta</a>
                <button className="btn ghost" type="button" onClick={onClose}>Listo</button>
              </div>
            </div>
          </div>
        ) : doneRecoge ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Listo para recoger</h3>
              <p><b>{order.external_ref}</b> queda listo en sucursal. Cuando el cliente pase por él, márcalo como entregado en <b>Seguimiento</b>.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : doneChofer ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Chofer asignado</h3>
              <p><b>{order.external_ref}</b> quedó <b>por despachar</b> con chofer propio. Aparece en su manifiesto; pasará a <b>En camino</b> cuando se despache la carga.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Asignar envío · {order.external_ref}</h3>
                <div className="ms">Genera la guía con la paquetería o asígnalo a un chofer propio.</div>
              </div>
              <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
            </div>
            <div className="mbody">
              {entregaPedido && (
                <div className="sysnote" style={{ marginBottom: 12, alignItems: 'flex-start' }} data-testid="asignar-entrega">
                  <Icon name="pkg" />
                  <span><b>Se vendió como:</b> {entregaPedido.texto} · {promesaDe(entregaPedido, hoyLocal())}{entregaPedido.flete ? ` · flete cobrado ${money(entregaPedido.flete)}` : ''}.
                    {method !== sugerido && <span style={{ color: 'var(--warn)' }}> Estás eligiendo otro método: el cliente espera lo prometido.</span>}</span>
                </div>
              )}
              <div className="seg" style={{ marginBottom: 16 }}>
                <button type="button" className={method === 'paqueteria' ? 'active' : undefined} onClick={() => setMethod('paqueteria')}>
                  <Icon name="truck" /> Paquetería
                </button>
                <button type="button" className={method === 'chofer' ? 'active' : undefined} onClick={() => setMethod('chofer')}>
                  <Icon name="usercheck" /> Chofer propio
                </button>
                <button type="button" className={method === 'recoge' ? 'active' : undefined} onClick={() => setMethod('recoge')} data-testid="metodo-recoge">
                  <Icon name="pkg" /> Recoge en sucursal
                </button>
              </div>

              {method === 'recoge' ? (
                <>
                  <p style={{ fontSize: 13.5 }}>El cliente pasa por su pedido: no se genera guía ni se asigna chofer. Al marcarlo queda <b>listo para recoger</b>.</p>
                  {error && <div style={{ fontSize: 12.5, color: 'var(--dang, #dc2626)', marginTop: 10 }}>{error}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                    <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                    <button className="btn" type="button" onClick={listoParaRecoger} disabled={busy !== false} data-testid="btn-listo-recoger"><Icon name="check" /> Listo para recoger</button>
                  </div>
                </>
              ) : method === 'paqueteria' ? (
                <>
                  {/* T1 · con qué se genera la guía: DHL directo o T1 Envíos (varias paqueterías en una cotización) */}
                  <div style={{ marginBottom: 12 }} data-testid="proveedor-guia">
                    <label style={labelStyle}>Generar la guía con</label>
                    <div className="seg">
                      {(['dhl', 't1'] as ProveedorPaqueteria[]).map((pv) => (
                        <button key={pv} type="button" className={proveedor === pv ? 'active' : undefined} onClick={() => { setProveedor(pv); setRates(null); setError(null) }} data-testid={`proveedor-${pv}`}>{NOMBRE_PROVEEDOR[pv]}</button>
                      ))}
                    </div>
                    {entregaPedido?.paqueteria && entregaPedido.paqueteria !== 'chofer' && entregaPedido.paqueteria !== proveedor && (
                      <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 4 }}>Se vendió con {NOMBRE_PROVEEDOR[entregaPedido.paqueteria]}; estás generando con otro proveedor.</div>
                    )}
                  </div>
                  {/* Destino/Origen REALES (snapshot del pedido + config de empresa) */}
                  <div className="sysnote" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
                    <Icon name="truck" />
                    <span>
                      <b>Destino:</b> {receiver.name || '—'} · {receiver.address.line1 || '—'}{receiver.address.cp ? `, C.P. ${receiver.address.cp}` : ''}{receiver.address.city ? `, ${receiver.address.city}` : ''}.<br />
                      <b>Origen:</b> {shipperInfo.config.city || '—'}{shipperInfo.config.cp ? ` (C.P. ${shipperInfo.config.cp})` : ''}.
                    </span>
                  </div>

                  {missing.length > 0 && (
                    <div className="sysnote" style={{ marginBottom: 14, alignItems: 'flex-start', background: 'var(--warn-bg, #fff7ed)', border: '1px solid var(--warn, #f59e0b)' }}>
                      <Icon name="bell" />
                      <span>
                        <b>Falta información para generar la guía.</b> Captúrala antes de cotizar (no se usan valores por defecto):
                        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
                      </span>
                    </div>
                  )}

                  {(faltaEntrega.cp || faltaEntrega.phone) && (
                    <div style={{ marginBottom: 14 }} data-testid="entrega-guia">
                      <label style={labelStyle}>Datos de entrega para la guía</label>
                      <div style={{ display: 'grid', gridTemplateColumns: faltaEntrega.cp && faltaEntrega.phone ? '1fr 1.4fr' : '1fr', gap: 8 }}>
                        {faltaEntrega.cp && (
                          <input style={f2} inputMode="numeric" maxLength={5} aria-label="Código postal de entrega" placeholder="C.P. de entrega (5 dígitos)"
                            value={entrega.cp} onChange={(e) => { setEntrega({ ...entrega, cp: e.target.value.replace(/\D/g, '').slice(0, 5) }); setRates(null) }} />
                        )}
                        {faltaEntrega.phone && (
                          <input style={f2} inputMode="tel" maxLength={20} aria-label="Teléfono de entrega" placeholder="Teléfono de quien recibe (10 dígitos)"
                            value={entrega.phone} onChange={(e) => { setEntrega({ ...entrega, phone: e.target.value }); setRates(null) }} />
                        )}
                      </div>
                      {sugerenciaCp && entrega.cp !== sugerenciaCp && (
                        <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} data-testid="usar-cp-sugerido"
                          onClick={() => { setEntrega({ ...entrega, cp: sugerenciaCp }); setRates(null) }}>Usar el C.P. {sugerenciaCp} que aparece en el domicilio</button>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>El domicilio del pedido no trae estos datos por separado. Se usan solo para esta guía; no cambian el pedido.</div>
                    </div>
                  )}

                  {empaques && empaques.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>Empaque</label>
                      <select style={inputStyle} value={empaqueId} onChange={(e) => elegirEmpaque(e.target.value)} data-testid="empaque-select" aria-label="Empaque">
                        <option value="">Elige la hielera o caja…</option>
                        {empaques.map((e) => <option key={e.id} value={e.id}>{e.nombre} · {medidasTexto(e)}{e.nota ? ` · ${e.nota}` : ''}</option>)}
                        <option value="otro">Otra medida (a mano)</option>
                      </select>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>Al elegirlo se llenan las medidas; pesa la caja final y captura el peso.</div>
                    </div>
                  )}
                  <label style={labelStyle}>Paquete final (medido en empaque)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600, marginBottom: 3 }}>
                    <span>Peso (kg)</span><span>Largo (cm)</span><span>Ancho (cm)</span><span>Alto (cm)</span><span>Piezas</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
                    <input style={f2} type="number" min="0.1" step="0.1" aria-label="Peso en kilogramos" value={parcel.weightKg} onChange={(e) => { setParcel({ ...parcel, weightKg: e.target.value }); setRates(null) }} placeholder="kg" />
                    <input style={f2} type="number" min="1" aria-label="Largo en centímetros" value={parcel.lengthCm} onChange={(e) => { setParcel({ ...parcel, lengthCm: e.target.value }); setRates(null) }} placeholder="largo" />
                    <input style={f2} type="number" min="1" aria-label="Ancho en centímetros" value={parcel.widthCm} onChange={(e) => { setParcel({ ...parcel, widthCm: e.target.value }); setRates(null) }} placeholder="ancho" />
                    <input style={f2} type="number" min="1" aria-label="Alto en centímetros" value={parcel.heightCm} onChange={(e) => { setParcel({ ...parcel, heightCm: e.target.value }); setRates(null) }} placeholder="alto" />
                    <input style={f2} type="number" min="1" step="1" aria-label="Número de piezas" value={parcel.pieces} onChange={(e) => { setParcel({ ...parcel, pieces: e.target.value }); setRates(null) }} placeholder="piezas" />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>Peso (kg), medidas en cm (largo × ancho × alto) y número de piezas de la caja final.</div>

                  {error && <div style={{ fontSize: 12.5, color: 'var(--dang, #dc2626)', marginTop: 10 }}>{error}</div>}

                  {!rates ? (
                    <button className="btn" type="button" style={{ width: '100%', marginTop: 16 }} onClick={cotizar} disabled={busy === 'quote' || missing.length > 0} title={missing.length ? 'Completa los datos faltantes' : undefined}>
                      {busy === 'quote' ? 'Cotizando…' : <><Icon name="truck" /> Cotizar envío</>}
                    </button>
                  ) : (
                    <>
                      <label style={{ ...labelStyle, marginTop: 16 }}>Tarifas disponibles</label>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {rates.map((r) => (
                          <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', border: '1px solid ' + (rateId === r.id ? 'var(--green)' : 'var(--line)'), borderRadius: 11, cursor: 'pointer', background: rateId === r.id ? 'var(--ok-bg)' : '#fff' }}>
                            <input type="radio" name="rate" checked={rateId === r.id} onChange={() => setRateId(r.id)} />
                            <span style={{ flex: 1 }}>
                              <b>{r.carrier}</b> · {r.service}
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>Entrega en {r.etaDays} día(s)</span>
                            </span>
                            <b className="mono">{money(r.amount)}</b>
                          </label>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
                        <button className="btn ghost" type="button" onClick={() => setRates(null)}>Recotizar</button>
                        <button className="btn" type="button" onClick={generarGuia} disabled={busy === 'label' || !rateId} style={busy === 'label' ? { opacity: .6 } : undefined}>
                          {busy === 'label' ? 'Generando guía…' : <><Icon name="check" /> Generar guía</>}
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <label style={labelStyle}>Chofer</label>
                  <select style={inputStyle} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {getDrivers().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                    <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                    <button className="btn" type="button" onClick={asignarChofer} disabled={!driverId} style={!driverId ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                      <Icon name="check" /> Asignar a chofer
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
