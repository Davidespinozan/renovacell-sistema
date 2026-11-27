// Cola de empaque: pedidos en estado "Empacado" (surtidos por Almacén), listos
// para enviar. Asignar envío por paquetería (carrier+guía) o chofer propio.
// Al asignar se crea el shipment y el pedido pasa a "En camino".
import { clienteDePedido } from '../../data/mock/profiles'   // nombre del cliente junto al folio
import { Vacio } from '../../app/EmptyState'
import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate, money } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useShipments } from '../../data/hooks/useShipments'
import { markShipped } from '../../data/store/ordersStore'
import { getDrivers, driverName } from '../../data/mock/shipments'
import { envioVigente } from '../../data/ops/seguimiento'
import { quoteShipment, createShipmentReal, NOMBRE_PROVEEDOR, type RateQuote, type LabelResult, type ProveedorPaqueteria } from '../../data/shipping/provider'

// PAQ-SIMPLE · con qué se hace la guía: DHL (API), Estafeta (manual por ahora) o T1 (agregador).
// PAQ-AUTOBÚS (24 nov 2026) · ETN, Unidos de Sinaloa y Norte de Sinaloa: guía manual, igual que Estafeta.
type GuiaCon = ProveedorPaqueteria | PaqManual
const GUIAS_CON: GuiaCon[] = ['dhl', 'estafeta', 'etn', 'tus', 'tns', 't1']
const NOMBRE_GUIA: Record<GuiaCon, string> = { ...NOMBRE_PROVEEDOR, estafeta: 'Estafeta (guía manual)', etn: 'ETN (manual)', tus: 'Unidos de Sinaloa (manual)', tns: 'Norte de Sinaloa (manual)' }
import { orderAddress } from '../../data/ops/shippingAddress'
import { shipperFromCompany } from '../../data/shipping/shipper'
import { currentCompany } from '../../data/store/companyStore'
import { missingForShipment } from '../../data/shipping/validate'
import { cpSugerido, faltantesEntrega, receptorParaGuia } from '../../data/shipping/entregaGuia'
import type { LogisticsPackage, Receiver } from '../../data/shipping/model'
import type { ProductSafe } from '../../data/types'
import { BotonRemision } from './Remision'
import { useRole, useRoleOpcional } from '../../auth/RoleContext'
import { CancelOrderModal } from '../../app/CancelOrderModal'
import { AvisoCancelacion, SolicitarCancelacion } from '../../app/Cancelacion'
import { solicitudDe, useSolicitudesCancelacion } from '../../data/ops/cancelacionSolicitud'
import { NOMBRE_PAQUETERIA, estimadaDe, promesaDe, resumenPaqueteria, salidaDePedido, type EntregaPedido } from '../../data/ops/entrega'
import { useCorteEntrega } from '../../data/hooks/useCorteEntrega'
import { sinServiciosExcluidos } from '../../../../../supabase/functions/_shared/cotizarEnvio'   // PAQ-SIMPLE · la MISMA lista de servicios prohibidos que el servidor
import { PAQ_MANUALES, esPaqManual, registrarGuiaManual, urlRastreoEstafeta, validarCostoGuia, validarGuiaManual, type PaqManual } from '../../data/shipping/estafeta'
import { listarEmpaques, medidasTexto, type Empaque } from '../../data/ops/empaques'
import { cantidadVista } from '../../lib/cajas'
import { envioDePaquete, extrasDe, extrasSinGuia, lugarDe, nombrePaqueteriaExtra, pedidoDePaquete, type EnvioExtra } from '../../data/ops/enviosExtra'   // ENVÍOS EXTRA

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
  // HORA DE SALIDA (26 nov 2026): dentro del mismo día, primero lo que sale más temprano (horario del chofer / corte).
  const clave = (o: T) => salidaDePedido(entregaDe(o), '0000-00-00')?.orden ?? '9999-12-31T23:59'
  return [...lista].sort((a, b) => {
    const ea = clave(a), eb = clave(b)
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
  const corte = useCorteEntrega()
  // HORA DE SALIDA (26 nov 2026): el día Y la hora (horario reservado del chofer o corte de paquetería).
  const s = salidaDePedido(e, hoy, corte)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px', fontSize: 12.5 }} data-testid="cola-entrega">
      {s && <span className={'pill ' + (s.cuando === 'atrasado' ? 'p-dang' : s.cuando === 'hoy' ? 'p-warn' : 'p-neu')} data-testid="pedido-salida">{s.etiqueta}</span>}
      <b>{e.tipo === 'foraneo' && e.paqueteria ? NOMBRE_PAQUETERIA[e.paqueteria] ?? e.texto : e.texto}</b>
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
  const { data: shipments = [], dispatchShipment } = useShipments()
  const [active, setActive] = useState<OrderWithItems | null>(null)
  // CANCELACIÓN · Dirección cancela directo; los demás la solicitan. Con una solicitud pendiente no se envía.
  const { role, user } = useRole()
  // Ya asignado a un chofer y esperando salida: se despacha desde aquí (no se vuelve a asignar: eso duplicaba el envío).
  const [despachando, setDespachando] = useState<string | null>(null)
  const [errDespacho, setErrDespacho] = useState<Record<string, string>>({})
  const despachar = async (o: OrderWithItems, shipmentId: string, driverId: string) => {
    setDespachando(o.id); setErrDespacho((m) => ({ ...m, [o.id]: '' }))
    const folio = o.external_ref ?? o.id
    const d = await dispatchShipment(shipmentId, user?.name ?? 'Almacén', folio)
    const e = d.ok ? await markShipped(o.id, { method: 'chofer', driver: driverName(driverId), driver_id: driverId }) : d
    setDespachando(null)
    if (!e.ok) setErrDespacho((m) => ({ ...m, [o.id]: d.ok ? `La carga salió, pero el pedido NO pasó a En camino. ${e.error}` : `NO se despachó. ${e.error}` }))
  }
  const esDireccion = role === 'admin'
  const solicitudes = useSolicitudesCancelacion()
  const [cancelando, setCancelando] = useState<OrderWithItems | null>(null)

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  // ENVÍOS EXTRA · también se queda el pedido cuyo principal ya salió pero tiene envíos extra sin guía
  const queue = ordenarPorSalida(orders.filter((o) => o.status === 'packed' || (o.status === 'shipped' && extrasSinGuia(o, shipments).length > 0)))   // ENT-3 · primero lo que debe salir antes
  const [extraActivo, setExtraActivo] = useState<{ order: OrderWithItems; extra: EnvioExtra } | null>(null)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow crumb">Envíos · Por enviar</div>

      {queue.length === 0 ? (
        <Vacio icono="pkg" titulo="No hay pedidos empacados pendientes de envío." pista="Surte un pedido en Almacén para que llegue aquí." />
      ) : (
        queue.map((o) => { const sol = solicitudDe(solicitudes, o.id); return (
          <div key={o.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
              <b style={{ fontSize: 14 }}>{clienteDePedido(o).name}</b>
              {o.status === 'shipped' ? <span className="pill p-green"><span className="d" /> Principal enviado</span> : <span className="pill p-blue"><span className="d" /> Empacado</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(o.created_at)}</span>
            </div>
            <EntregaPill e={entregaDe(o)} />
            {o.items.map((it) => (
              <div key={it.id} className="coitem">
                <span>{byId[it.product_id ?? '']?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{cantidadVista(byId[it.product_id ?? ''], it.qty)}</span></span>{/* CAJAS-MEDIOS */}
                <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
              </div>
            ))}
            {extrasDe(o).length > 0 && (
              <div data-testid="cola-extras" style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>{extrasDe(o).length === 1 ? '1 envío extra' : `${extrasDe(o).length} envíos extra`} · una guía por cada uno{o.status !== 'shipped' ? ' (el principal lleva lo demás)' : ''}</div>
                {extrasDe(o).map((x) => { const env = envioDePaquete(shipments, o.id, x.paquete); return (
                  <div key={x.paquete} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} data-testid={`cola-extra-${x.paquete}`}>
                    <span style={{ flex: 1, minWidth: 200, fontSize: 13 }}>
                      <b>Extra {x.paquete} · {lugarDe(x.address)}{nombrePaqueteriaExtra(x.paqueteria) ? ` · ${nombrePaqueteriaExtra(x.paqueteria)}` : ''}</b>{x.contacto ? ` · recibe ${x.contacto}` : ''}
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>{x.lineas.map((l) => `${byId[l.product_id]?.name ?? l.nombre ?? 'Producto'} ×${cantidadVista(byId[l.product_id], l.qty)}`).join(' · ')}</span>
                    </span>
                    {env ? <span className="pill p-green"><span className="d" /> Guía {env.carrier ?? ''} <span className="mono">{env.tracking_number}</span></span>
                      : <button className="btn sm" type="button" disabled={!!sol} onClick={() => setExtraActivo({ order: o, extra: x })} data-testid={`cola-extra-guia-${x.paquete}`}><Icon name="truck" /> Generar guía</button>}
                  </div>
                ) })}
              </div>
            )}
            {sol && <AvisoCancelacion solicitud={sol} esDireccion={esDireccion} />}
            {o.status === 'packed' && (() => { const env = envioVigente(shipments, o.id); return env && env.status === 'por_despachar' && env.driver_id ? (
              <div className="sysnote" style={{ marginTop: 10 }} data-testid="cola-asignado">
                <Icon name="truck" /><span>Asignado a <b>{driverName(env.driver_id)}</b> · por despachar. Cuando le entregues la carga, despáchala.</span>
              </div>
            ) : null })()}
            {errDespacho[o.id] && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{errDespacho[o.id]}</div>}
            {o.status === 'packed' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
              {(() => { const env = envioVigente(shipments, o.id); return env && env.status === 'por_despachar' && env.driver_id ? (
                <button className="btn" type="button" disabled={!!sol || despachando === o.id} onClick={() => void despachar(o, env.id, env.driver_id!)} data-testid="cola-despachar">
                  <Icon name="truck" /> {despachando === o.id ? 'Despachando…' : 'Ya le entregué la carga: despachar'}
                </button>
              ) : (
                <button className="btn" type="button" onClick={() => setActive(o)} disabled={!!sol} title={sol ? 'Hay una cancelación por resolver' : undefined}>
                  <Icon name="truck" /> Asignar envío
                </button>
              ) })()}
              <BotonRemision order={o} className="btn ghost" />
              {!sol && (esDireccion
                ? <button className="btn ghost" type="button" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => setCancelando(o)} data-testid="btn-cancelar-pedido">Cancelar pedido</button>
                : <span style={{ marginLeft: 'auto' }}><SolicitarCancelacion orderId={o.id} folio={o.external_ref ?? o.id} className="btn ghost" /></span>)}
            </div>}
          </div>
        ) })
      )}
      {cancelando && <CancelOrderModal orderId={cancelando.id} folio={cancelando.external_ref ?? cancelando.id} requireReason actor="Administración" onClose={() => setCancelando(null)} />}

      {active && <AsignarModal order={active} onClose={() => setActive(null)} />}
      {extraActivo && <AsignarModal order={pedidoDePaquete(extraActivo.order, extraActivo.extra)} paquete={extraActivo.extra.paquete} onClose={() => setExtraActivo(null)} />}
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

export function AsignarModal({ order, onClose, paquete = 0 }: { order: OrderWithItems; onClose: () => void
  /** ENVÍOS EXTRA · 1..n = guía de un envío extra: solo paquetería, al domicilio del extra, sin cambiar el estado del pedido. */
  paquete?: number }) {
  const { createShipment, dispatchShipment } = useShipments()
  // AUXILIAR DE ALMACÉN (rol packing): empaca y despacha; la guía de paquetería la genera Almacén (Alberto). El servidor
  // también se la niega (Edge shipping), aquí solo se explica en vez de ofrecer un botón que fallaría.
  const sesion = useRoleOpcional()
  const puedeGuia = sesion?.role !== 'packing'
  const entregaPedido = useMemo(() => entregaDe(order), [order])
  const sugerido = metodoSugerido(entregaPedido)
  const [method, setMethod] = useState<Method>(paquete > 0 ? 'paqueteria' : sugerido)   // ENT-3 · lo que se vendió manda; Empaque puede cambiarlo a sabiendas
  // PAQ-SIMPLE (23 nov 2026) · con qué se genera la guía: la paquetería que se vendió (DHL o Estafeta) viene preseleccionada;
  // Almacén puede cambiarla. T1 cotiza varias paqueterías a la vez. Estafeta, por ahora, es guía MANUAL (sin API).
  const [proveedor, setProveedor] = useState<GuiaCon>(entregaPedido?.paqueteria === 't1' ? 't1' : esPaqManual(entregaPedido?.paqueteria) ? entregaPedido!.paqueteria as PaqManual : 'dhl')
  const manual: PaqManual | null = esPaqManual(proveedor) ? proveedor : null   // PAQ-AUTOBÚS · paquetería sin API: guía a mano
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
  // PAQ-SIMPLE · Almacén elige el servicio de DHL (cualquiera de los permitidos, sin motivo); al cliente se le prometió una fecha.
  const prometido = resumenPaqueteria(entregaPedido, hoyLocal())
  // Estafeta (guía manual): número de guía, costo opcional y fecha estimada (de inicio, la prometida).
  const [guiaManual, setGuiaManual] = useState({ guia: '', costo: '', fecha: entregaPedido?.llega_hasta ?? '' })
  const [busy, setBusy] = useState<false | 'quote' | 'label' | 'chofer'>(false)
  const [result, setResult] = useState<LabelResult | null>(null)
  // Chofer asignado: el envío queda "por despachar". Si la carga se le entrega en este momento, se despacha aquí
  // mismo (mismo paso que Despacho); si no, queda en el manifiesto. Antes el modal cerraba y el despacho se olvidaba:
  // el chofer veía "Esperando que Almacén te despache" con la carga ya en la mano.
  const [asignado, setAsignado] = useState<{ shipmentId: string; driverId: string; chofer: string } | null>(null)
  const [despachado, setDespachado] = useState(false)
  const doneChofer = asignado != null
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
      if (manual) return
      const r0 = await quoteShipment(shipperInfo.config, receiver, pkg, orderRef, proveedor as ProveedorPaqueteria, order.id)
      const r = proveedor === 'dhl' ? sinServiciosExcluidos(r0) : r0   // PAQ-SIMPLE · ECONOMY SELECT nunca se ofrece
      setRates(r); setRateId(r[0]?.id ?? '')
    } catch (e) { setError(mensajeProveedor((e as Error).message) || 'No se pudo cotizar.') }
    setBusy(false)
  }

  const generarGuia = async () => {
    const rate = rates?.find((r) => r.id === rateId)
    if (!rate || busy || manual) return
    if (missing.length) return
    setBusy('label'); setError(null)
    try {
      const { label } = await createShipmentReal({
        order_id: order.id, orderRef, idempotencyKey: paquete > 0 ? `${order.id}:p${paquete}:${rate.id}` : `${order.id}:${rate.id}`,
        shipper: shipperInfo.config, receiver, pkg, rate, provider: proveedor as ProveedorPaqueteria, ...(paquete > 0 ? { paquete } : {}),
      })
      // DHL persiste el shipment server-side (idempotente). Solo el mock inserta en cliente.
      if (label.provider === 'mock' || !label.provider) {
        await createShipment({
          order_id: order.id, carrier: label.carrier, tracking_number: label.tracking,
          label_url: label.labelUrl, driver_id: null, estimated_delivery_at: label.estimatedDeliveryAt, status: 'in_transit', ...(paquete > 0 ? { paquete } : {}),
        })
      }
      // Guía de AMBIENTE DE PRUEBAS (DHL o T1 en sandbox): no es un envío real. El pedido NO se marca enviado (eso le manda
      // al cliente "va en camino" con un número de rastreo que no existe); se muestra la guía para la prueba y nada más.
      if (label.ambiente === 'test') {
        setResult(label)
        setError(`Guía de PRUEBAS (${label.carrier}): no es un envío real y el pedido NO se marcó como enviado. Pide a Dirección activar la paquetería en producción.`)
        setBusy(false)
        return
      }
      // ENVÍOS EXTRA · la guía de un extra no cambia el pedido (su aviso al cliente lo manda el servidor con esta guía)
      if (paquete > 0) { setResult(label); setBusy(false); return }
      const enviado = await markShipped(order.id, { method: 'paqueteria', carrier: label.carrier, tracking: label.tracking, label_url: label.labelUrl })
      // La guía YA existe aunque el pedido no haya cambiado de estado: se muestra
      // siempre, para que el operador no pierda el número de rastreo, y se le dice
      // exactamente qué fue lo que no quedó.
      setResult(label)
      if (!enviado.ok) setError(`La guía ${label.tracking} sí se generó, pero el pedido NO se marcó como enviado. ${enviado.error}`)
    } catch (e) { setError(mensajeProveedor((e as Error).message) || 'No se pudo generar la guía. El pedido NO se marcó como enviado.') }
    setBusy(false)
  }

  // PAQ-SIMPLE · Estafeta MANUAL: se registra la guía hecha en el portal de Estafeta y sigue el flujo normal (En camino).
  const guardarGuiaEstafeta = async () => {
    if (busy) return
    if (!manual) return
    const nombre = PAQ_MANUALES[manual]
    const g = validarGuiaManual(manual, guiaManual.guia)
    if (!g.ok) { setError(g.error); return }
    const c = validarCostoGuia(guiaManual.costo)
    if (!c.ok) { setError(c.error); return }
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(guiaManual.fecha) ? guiaManual.fecha : entregaPedido?.llega_hasta ?? null
    setBusy('label'); setError(null)
    const r = await registrarGuiaManual({ paqueteria: manual, orderId: order.id, guia: g.guia, costo: c.costo, llegaFecha: fecha, registradoPor: sesion?.user?.name ?? null, ...(paquete > 0 ? { paquete } : {}) }, createShipment)
    if (!r.ok) { setBusy(false); setError(`No se guardó la guía de ${nombre}. ${r.error}`); return }
    const label: LabelResult = { provider: manual as LabelResult['provider'], carrier: nombre, service: 'guía manual', tracking: g.guia, labelUrl: '', amount: c.costo ?? 0, etaDays: 0, estimatedDeliveryAt: r.shipment.estimated_delivery_at ?? '' }
    if (paquete > 0) { setResult(label); setBusy(false); return }   // ENVÍOS EXTRA · el pedido no cambia
    const enviado = await markShipped(order.id, { method: 'paqueteria', carrier: nombre, tracking: g.guia })
    setResult(label)
    if (!enviado.ok) setError(`La guía ${g.guia} sí quedó registrada, pero el pedido NO se marcó como enviado. ${enviado.error}`)
    setBusy(false)
  }

  const asignarChofer = async () => {
    if (!driverId || busy) return   // AUDITORÍA · sin doble toque (la base además exige un solo envío vivo por pedido)
    const drv = getDrivers().find((d) => d.id === driverId)
    setBusy('chofer'); setError(null)
    const r = await createShipment({
      order_id: order.id, carrier: null, tracking_number: null, driver_id: driverId,
      // La estimada sale de lo que se le PROMETIÓ al cliente (horario o día de llegada); solo sin promesa, +2 días.
      estimated_delivery_at: estimadaDe(entregaPedido) ?? new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'por_despachar',
    })
    setBusy(false)
    if (!r.ok) { setError(`No se asignó el chofer. ${r.error}`); return }
    // R-62: NO marcamos el pedido "En camino" aquí (sigue en el almacén, por_despachar). El
    // chofer y el manifiesto ya lo ven por el shipment. El pedido pasa a "enviado" al DESPACHAR
    // el manifiesto (Despacho), para no falsear el Tablero mostrando en tránsito lo que sigue
    // en el estante.
    setAsignado({ shipmentId: r.shipment.id, driverId, chofer: drv?.name ?? 'el chofer' })
  }

  // Igual que Despacho: primero el envío y, solo si quedó, el pedido pasa a "enviado".
  const despacharAhora = async () => {
    if (!asignado) return
    setBusy('chofer'); setError(null)
    const d = await dispatchShipment(asignado.shipmentId, sesion?.user?.name ?? 'Almacén', orderRef)
    if (!d.ok) { setBusy(false); setError(`La carga NO quedó despachada. ${d.error}`); return }
    const e = await markShipped(order.id, { method: 'chofer', driver: asignado.chofer, driver_id: asignado.driverId })
    setBusy(false)
    if (!e.ok) { setError(`La carga quedó despachada, pero el pedido NO pasó a En camino. ${e.error}`); return }
    setDespachado(true)
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
                <b>{order.external_ref}</b> va por <b>{result.carrier} · {result.service}</b>.{result.ambiente === 'test' && <> <span className="pill p-warn" data-testid="guia-sandbox">{result.carrier} · ambiente de pruebas: no es un envío real</span></>}
                Guía <b className="mono">{result.tracking}</b>{result.estimatedDeliveryAt ? <> · entrega estimada {fmtDate(result.estimatedDeliveryAt)}</> : null}.
                {!error && result.ambiente !== 'test' && <> El doctor ya la ve en su seguimiento.</>}
              </p>
              {error && <div className="sysnote" style={{ marginTop: 10, background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }} data-testid="guia-aviso">{error}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
                {esPaqManual(result.provider) && result.provider !== 'estafeta'
                  ? <span className="pill p-green" data-testid="guia-manual-ok"><span className="d" /> Guía {result.carrier} registrada</span>
                  : result.provider === 'estafeta'
                  ? <a className="btn" href={urlRastreoEstafeta(result.tracking)} target="_blank" rel="noreferrer" data-testid="estafeta-rastreo"><Icon name="truck" /> Ver rastreo en Estafeta</a>
                  : <a className="btn" href={result.labelUrl} target="_blank" rel="noreferrer"><Icon name="download" /> Imprimir etiqueta</a>}
                <button className="btn ghost" type="button" onClick={onClose}>Listo</button>
              </div>
            </div>
          </div>
        ) : doneRecoge ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Listo para recoger</h3>
              <p><b>{order.external_ref}</b> queda listo en sucursal. Cuando el cliente pase por él, márcalo como entregado en <b>Pedidos → Para recoger</b>.</p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : doneChofer ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              {despachado ? (
                <>
                  <h3>Carga despachada</h3>
                  <p><b>{order.external_ref}</b> salió con <b>{asignado?.chofer}</b>. Le aparece para que confirme que la recibió.</p>
                  <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
                </>
              ) : (
                <>
                  <h3>Chofer asignado</h3>
                  <p><b>{order.external_ref}</b> quedó <b>por despachar</b> con {asignado?.chofer}. ¿Ya le entregaste la carga? Despáchala ahora; si sale después, queda en su manifiesto de <b>Despacho</b>.</p>
                  {error && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }} data-testid="despachar-ahora-error">{error}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
                    <button className="btn" type="button" disabled={busy === 'chofer'} onClick={() => void despacharAhora()} data-testid="despachar-ahora"><Icon name="truck" /> {busy === 'chofer' ? 'Despachando…' : 'Ya le entregué la carga: despachar'}</button>
                    <button className="btn ghost" type="button" disabled={busy === 'chofer'} onClick={onClose}>Sale después</button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>{paquete > 0 ? `Envío extra ${paquete}` : 'Asignar envío'} · {order.external_ref}</h3>
                <div className="ms">{paquete > 0 ? `Guía de paquetería a ${lugarDe(receiver.address as EnvioExtra['address'])}. El envío principal no cambia.` : 'Genera la guía con la paquetería o asígnalo a un chofer propio.'}</div>
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
              {paquete === 0 && <div className="seg" style={{ marginBottom: 16 }}>
                <button type="button" className={method === 'paqueteria' ? 'active' : undefined} onClick={() => setMethod('paqueteria')}>
                  <Icon name="truck" /> Paquetería
                </button>
                <button type="button" className={method === 'chofer' ? 'active' : undefined} onClick={() => setMethod('chofer')}>
                  <Icon name="usercheck" /> Chofer propio
                </button>
                <button type="button" className={method === 'recoge' ? 'active' : undefined} onClick={() => setMethod('recoge')} data-testid="metodo-recoge">
                  <Icon name="pkg" /> Recoge en sucursal
                </button>
              </div>}

              {method === 'recoge' ? (
                <>
                  <p style={{ fontSize: 13.5 }}>El cliente pasa por su pedido: no se genera guía ni se asigna chofer. Al marcarlo queda <b>listo para recoger</b>.</p>
                  {error && <div style={{ fontSize: 12.5, color: 'var(--dang, #dc2626)', marginTop: 10 }}>{error}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                    <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                    <button className="btn" type="button" onClick={listoParaRecoger} disabled={busy !== false} data-testid="btn-listo-recoger"><Icon name="check" /> Listo para recoger</button>
                  </div>
                </>
              ) : method === 'paqueteria' && !puedeGuia ? (
                <div className="sysnote" style={{ alignItems: 'flex-start' }} data-testid="guia-de-almacen">
                  <Icon name="truck" />
                  <span><b>La guía la genera Almacén.</b> Deja la caja empacada y lista; este pedido sigue en «Por enviar» para que Alberto genere e imprima la guía.</span>
                </div>
              ) : method === 'paqueteria' ? (
                <>
                  {/* T1 · con qué se genera la guía: DHL directo o T1 Envíos (varias paqueterías en una cotización) */}
                  <div style={{ marginBottom: 12 }} data-testid="proveedor-guia">
                    <label style={labelStyle}>Generar la guía con</label>
                    <div className="seg">
                      {GUIAS_CON.map((pv) => (
                        <button key={pv} type="button" className={proveedor === pv ? 'active' : undefined} onClick={() => { setProveedor(pv); setRates(null); setError(null) }} data-testid={`proveedor-${pv}`}>{NOMBRE_GUIA[pv]}</button>
                      ))}
                    </div>
                    {prometido && (
                      <div style={{ fontSize: 12.5, marginTop: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--ok-bg)' }} data-testid="paqueteria-vendida">
                        <b>Se vendió: {prometido}.</b> {proveedor === 'dhl' ? 'Elige el servicio de DHL que llegue a tiempo.' : proveedor === 'estafeta' ? 'Haz la guía en el portal de Estafeta y regístrala aquí.' : manual ? `Lleva el paquete a ${PAQ_MANUALES[manual]} y registra aquí el número de guía.` : ''}
                      </div>
                    )}
                    {entregaPedido?.paqueteria && entregaPedido.paqueteria !== 'chofer' && entregaPedido.paqueteria !== proveedor && (
                      <div style={{ fontSize: 11.5, color: 'var(--warn)', marginTop: 4 }}>Se vendió con {NOMBRE_PAQUETERIA[entregaPedido.paqueteria] ?? entregaPedido.paqueteria}; estás generando con otra paquetería.</div>
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

                  {manual ? (
                    <div style={{ display: 'grid', gap: 10 }} data-testid="estafeta-manual">
                      <label style={labelStyle}>Guía manual de {PAQ_MANUALES[manual]}</label>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: -6 }}>{manual === 'estafeta' ? 'Genera la guía en el portal de Estafeta con este destino y registra aquí el número.' : `Documenta el paquete en ${PAQ_MANUALES[manual]} con este destino y registra aquí el número de guía.`} El cliente la ve en su seguimiento.</div>
                      <input style={f2} aria-label={`Número de guía de ${PAQ_MANUALES[manual]}`} placeholder={manual === 'estafeta' ? 'Número de guía (22 caracteres) o código de rastreo (10 dígitos)' : 'Número de guía'} maxLength={30}
                        value={guiaManual.guia} onChange={(e) => setGuiaManual({ ...guiaManual, guia: e.target.value })} data-testid="estafeta-guia" />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>Costo (opcional)
                          <input style={{ ...f2, marginTop: 4 }} inputMode="decimal" aria-label="Costo de la guía" placeholder="$" value={guiaManual.costo} onChange={(e) => setGuiaManual({ ...guiaManual, costo: e.target.value })} data-testid="estafeta-costo" />
                        </label>
                        <label style={{ fontSize: 12, color: 'var(--ink-3)' }}>Llega (estimado)
                          <input style={{ ...f2, marginTop: 4 }} type="date" aria-label="Fecha estimada de entrega" value={guiaManual.fecha} onChange={(e) => setGuiaManual({ ...guiaManual, fecha: e.target.value })} data-testid="estafeta-fecha" />
                        </label>
                      </div>
                      {error && <div style={{ fontSize: 12.5, color: 'var(--danger)' }} data-testid="estafeta-error">{error}</div>}
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                        <button className="btn" type="button" onClick={() => void guardarGuiaEstafeta()} disabled={busy === 'label' || !guiaManual.guia.trim()} data-testid="estafeta-guardar">
                          {busy === 'label' ? 'Guardando…' : <><Icon name="check" /> Guardar guía y enviar</>}
                        </button>
                      </div>
                    </div>
                  ) : (
                  <>
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
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>Entrega en {r.etaDays} {r.etaDays === 1 ? 'día' : 'días'}</span>
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
                    <button className="btn" type="button" onClick={asignarChofer} disabled={!driverId || !!busy} style={!driverId ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                      <Icon name="check" /> {busy === 'chofer' ? 'Asignando…' : 'Asignar a chofer'}
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
