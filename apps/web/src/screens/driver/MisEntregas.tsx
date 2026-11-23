// CHOFER: solo SUS entregas (driver_id = chofer logueado). Marca entregado con la
// FIRMA de quien recibe (23 nov 2026: antes era foto). Al confirmar, envío y pedido pasan a Entregado (cierra el ciclo).
import { Vacio } from '../../app/EmptyState'
import { Phone, Navigation } from 'lucide-react'
import { useMemo, useState } from 'react'
// Orden de la ruta elegido por el chofer, persistido por chofer (sobrevive recargas del día).
import { Icon } from '../../app/icons'
import { fmtDate, money } from '../../lib/format'
import { telParaMarcar } from '../../lib/telefono'
import { CobroEntrega } from './CobroEntrega'
import { MiEfectivo } from './MiEfectivo'
import { useRastreoRuta, usePantallaEncendida, leerPantallaEncendida, guardarPantallaEncendida } from '../../data/hooks/useRastreoRuta'   // CHOFER EN EL MAPA
import { ubicacionChofer, ubicacionAhora } from '../../data/ops/ubicacionChofer'   // BLOQUE1 · efectivo que trae el chofer
import { uploadPrivate, signedProofUrl } from '../../lib/uploads'
import { FirmaEntrega } from './FirmaEntrega'   // FIRMA DE ENTREGA (23 nov 2026) · en lugar de la foto
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { entregar } from '../../data/ops/entregar'
import { entregaDelPedido, promesaDe } from '../../data/ops/entrega'
import { hoyNegocio } from '../../data/periodo'
import { driverIdByEmail, driverName } from '../../data/mock/shipments'
import { clienteDePedido, deliveryOf } from '../../data/mock/profiles'
import { useRole } from '../../auth/RoleContext'
import { cantidadVista } from '../../lib/cajas'

const INCIDENT_TYPES = ['Cliente ausente', 'Dirección incorrecta', 'Pedido rechazado', 'No se pudo contactar', 'Otro']
// Problemas al CONTAR la carga (antes de salir a reparto): distintos de las incidencias de entrega.
const LOAD_INCIDENT_TYPES = ['Faltan piezas', 'Producto equivocado', 'Caja dañada', 'Otro']

export function MisEntregas() {
  const { data: shipments, reportIncident, confirmLoad } = useShipments()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { user, vistaPrevia } = useRole()
  const driverId = driverIdByEmail(user?.email)

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])
  const orderById = useMemo(() => {
    const m: Record<string, (typeof orders)[number] | undefined> = {}
    orders.forEach((o) => (m[o.id] = o))
    return m
  }, [orders])

  const [firmas, setFirmas] = useState<Record<string, File | null>>({}) // FIRMA DE ENTREGA · firma lista (PNG local)
  const [uploading, setUploading] = useState<Record<string, boolean>>({}) // guardando la firma / entregando
  const [upErr, setUpErr] = useState<Record<string, boolean>>({}) // la subida falló (reintentar)
  const [cargando, setCargando] = useState<Record<string, boolean>>({}) // confirmando la carga (sin doble toque)
  const [received, setReceived] = useState<Record<string, string>>({})
  const [incType, setIncType] = useState<Record<string, string>>({})
  const [incNote, setIncNote] = useState<Record<string, string>>({})
  const [noPhoto, setNoPhoto] = useState<Record<string, string>>({}) // motivo para entregar sin firma (mala señal)
  const [loadOpen, setLoadOpen] = useState<Record<string, boolean>>({}) // form de problema con la carga abierto
  const [loadType, setLoadType] = useState<Record<string, string>>({})
  const [loadNote, setLoadNote] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)

  // El aviso dice lo que el SERVIDOR confirmó. Un fallo se queda más tiempo en
  // pantalla (y además aparece en la franja global, que no se va sola).
  const avisar = (ok: boolean, texto: string) => {
    setToast(texto)
    window.setTimeout(() => setToast(null), ok ? 2600 : 7000)
  }

  const reportInc = async (shipmentId: string, folio: string) => {
    const r = await reportIncident(shipmentId, incType[shipmentId] ?? INCIDENT_TYPES[0], incNote[shipmentId]?.trim() || null, folio)
    avisar(r.ok, r.ok ? `Incidencia reportada: ${folio}` : `La incidencia de ${folio} NO se registró. ${r.error}`)
  }

  // Problema al contar la carga (faltan piezas / producto equivocado): avisa a Almacén
  // para que corrija ANTES de que el chofer salga a reparto — no confirmar a ciegas.
  const reportLoad = async (shipmentId: string, folio: string) => {
    const r = await reportIncident(shipmentId, loadType[shipmentId] ?? LOAD_INCIDENT_TYPES[0], loadNote[shipmentId]?.trim() || null, folio, { toWarehouse: true })
    // El formulario solo se cierra si el reporte quedó: si no, el chofer conserva lo que escribió.
    if (r.ok) setLoadOpen((m) => ({ ...m, [shipmentId]: false }))
    avisar(r.ok, r.ok ? `Problema de carga reportado a Almacén: ${folio}` : `El problema de ${folio} NO se reportó. ${r.error}`)
  }

  // Ver la prueba de una entrega YA cerrada (foto en bucket privado → URL firmada temporal).
  const verPrueba = async (path: string | null) => {
    const url = await signedProofUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
    else setToast('No se pudo abrir la prueba (revisa tu señal).')
  }

  // Entregar SIN firma cuando no se pudo guardar por mala señal: exige un motivo y lo deja en
  // el registro (received_by) para que Almacén/Dirección reclamen la evidencia después.
  const deliverNoPhoto = async (shipmentId: string, orderId: string, folio: string, who: string, motivo: string) => {
    const r = await entregar(shipmentId, orderId, null, `${who} (sin firma: ${motivo})`)
    if (r.ok) marcarLugar(shipmentId)
    avisar(r.ok, r.ok ? `Entrega registrada sin firma: ${folio}` : `La entrega de ${folio} NO quedó registrada. ${r.error}`)
  }

  // Solo con chofer resuelto: si driverId es null (aún cargando) no se listan
  // envíos —evita que un envío sin chofer (driver_id null) entre por null===null.
  // DUEÑO (23 nov 2026) · trabajando como Chofer, el dueño ve TODAS las entregas en ruta (no solo las de un chofer).
  const comoDueno = vistaPrevia === 'driver'
  const myAll = comoDueno ? shipments.filter((s) => !!s.driver_id) : driverId ? shipments.filter((s) => s.driver_id === driverId) : []
  // Un envío cancelado (pedido cancelado o guía anulada) sale de la ruta: ya no se entrega.
  const mine = myAll.filter((s) => s.status !== 'delivered' && s.status !== 'cancelado')
  const entregadas = myAll.filter((s) => s.status === 'delivered')
  // CHOFER EN EL MAPA · en ruta = alguna entrega ya salió (despachada, en camino o con incidencia).
  const enRuta = mine.some((s) => ['despachado', 'out_for_delivery', 'incident'].includes(s.status ?? ''))
  const rastreo = useRastreoRuta(enRuta)
  const [pantalla, setPantalla] = useState(leerPantallaEncendida)
  const pantallaSoportada = usePantallaEncendida(enRuta && pantalla)
  // Piezas a bordo = suma de unidades de los pedidos pendientes en su ruta.
  const piezasABordo = mine.reduce((s, sh) => {
    const o = orderById[sh.order_id]
    return s + (o ? o.items.filter((it) => it.unit_price != null).reduce((t, it) => t + it.qty, 0) : 0)
  }, 0)
  const incidencias = mine.filter((s) => s.incident && !s.incident.resolved).length

  // ORDEN de la ruta elegido por el chofer (él conoce su ciudad mejor que un
  // algoritmo simple). Se guarda por chofer en el navegador para que sobreviva
  // recargas del día. La optimización automática por cercanía queda para cuando
  // haya API key de Maps (necesita coordenadas; hoy solo tenemos direcciones).
  const KEY = `rnc-ruta-${driverId ?? 'anon'}`
  const [routeOrder, setRouteOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[] } catch { return [] }
  })
  // Orden efectivo: respeta lo elegido, agrega paradas nuevas al final y descarta
  // las que ya se entregaron o se reasignaron.
  const orderedIds = useMemo(() => {
    const ids = mine.map((s) => s.id)
    const kept = routeOrder.filter((id) => ids.includes(id))
    const nuevos = ids.filter((id) => !kept.includes(id))
    return [...kept, ...nuevos]
  }, [routeOrder, mine])
  const orderedMine = useMemo(
    () => orderedIds.map((id) => mine.find((s) => s.id === id)).filter((s): s is (typeof mine)[number] => Boolean(s)),
    [orderedIds, mine],
  )
  const persistOrder = (seq: string[]) => {
    setRouteOrder(seq)
    try { localStorage.setItem(KEY, JSON.stringify(seq)) } catch { /* almacenamiento no disponible */ }
  }
  const move = (id: string, dir: -1 | 1) => {
    const seq = [...orderedIds]
    const i = seq.indexOf(id); const j = i + dir
    if (i < 0 || j < 0 || j >= seq.length) return
    ;[seq[i], seq[j]] = [seq[j], seq[i]]
    persistOrder(seq)
  }
  // Mover la parada al inicio o al fin en UN toque (en el celular, subir la parada 8 al 1
  // con flechitas eran 7 toques). Más cómodo que arrastrar en pantalla táctil.
  const moveEnd = (id: string, edge: 'top' | 'bottom') => {
    const rest = orderedIds.filter((x) => x !== id)
    persistOrder(edge === 'top' ? [id, ...rest] : [...rest, id])
  }
  // Etiqueta de una parada (cliente + dirección) para la lista de la ruta.
  const stopInfo = (s: (typeof mine)[number]) => {
    const o = orderById[s.order_id]
    if (!o) return null
    const d = deliveryOf(o)
    return { name: d.name, addr: d.addr, folio: o.external_ref ?? '' }
  }

  // Ruta completa en Google Maps, EN EL ORDEN del chofer. Sin origen → usa su
  // ubicación actual. Direcciones en texto (no requiere API key).
  const routeStops = orderedMine
    .map((s) => { const o = orderById[s.order_id]; return o ? deliveryOf(o).addr : null })
    .filter((a): a is string => a != null && a.replace(/[, ]/g, '').length > 0)
  const routeUrl = (() => {
    if (routeStops.length === 0) return null
    const dest = routeStops[routeStops.length - 1]
    const wp = routeStops.slice(0, -1)
    const base = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest)
    return wp.length ? base + '&waypoints=' + wp.map(encodeURIComponent).join('%7C') : base
  })()

  // CHOFER EN EL MAPA · dónde se entregó (prueba de entrega). Nunca frena la entrega: si no hay GPS, no se guarda.
  const marcarLugar = (shipmentId: string) => { void ubicacionAhora().then((p) => { if (p) void ubicacionChofer().registrar({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, tipo: 'entrega', shipmentId }) }) }
  // FIRMA DE ENTREGA · primero se guarda la firma (bucket privado); solo si quedó guardada se marca entregado.
  // Con mala señal falla, y aparece «Entregar sin firma» con motivo obligatorio.
  const deliver = async (shipmentId: string, orderId: string, folio: string) => {
    const firma = firmas[shipmentId]
    if (!firma) return
    setUpErr((e) => ({ ...e, [shipmentId]: false }))
    setUploading((u) => ({ ...u, [shipmentId]: true }))
    const path = await uploadPrivate(firma, 'proofs')
    if (!path) { setUploading((u) => ({ ...u, [shipmentId]: false })); setUpErr((e) => ({ ...e, [shipmentId]: true })); return }
    const r = await entregar(shipmentId, orderId, path, received[shipmentId]?.trim() || null)
    setUploading((u) => ({ ...u, [shipmentId]: false }))
    if (r.ok) marcarLugar(shipmentId)
    avisar(r.ok, r.ok ? `Entrega confirmada: ${folio}` : `La entrega de ${folio} NO quedó registrada. ${r.error}`)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">{comoDueno ? 'Todas las rutas' : `Mi ruta · ${driverName(driverId)}`}</div>

      {/* CHOFER EN EL MAPA · aviso honesto de que se comparte la ubicación (solo en ruta) */}
      {enRuta && rastreo === 'activo' && (
        <div className="rastreo-aviso" data-testid="rastreo-activo">
          📍 La oficina ve tu ubicación mientras estás en ruta. {pantallaSoportada && pantalla ? 'La pantalla se queda encendida hasta que termines.' : 'Deja esta pantalla abierta.'}
          {pantallaSoportada && <> <button type="button" className="rc-link" onClick={() => { const v = !pantalla; guardarPantallaEncendida(v); setPantalla(v) }} data-testid="rastreo-pantalla">{pantalla ? 'Dejar que se apague' : 'Mantener encendida'}</button></>}
        </div>
      )}
      {enRuta && rastreo === 'denegado' && <div className="rastreo-aviso rastreo-mal" data-testid="rastreo-denegado">📍 Activa la ubicación para esta página: toca el candado junto a la dirección (o Ajustes → Ubicación del navegador) y elige «Permitir».</div>}
      {enRuta && rastreo === 'no_disponible' && <div className="rastreo-aviso rastreo-mal">📍 No se pudo leer tu ubicación. Revisa que el GPS del teléfono esté encendido.</div>}

      {/* Resumen de la ruta (asignada por Empaque al elegir chofer) */}
      {/* pp-kpis3: en móvil las tres caben en una fila compacta (antes 2+1, la tercera a lo ancho). */}
      <div className="grid sigs pp-kpis3">
        <div className="card sig"><div className="chip"><Icon name="truck" /></div><div className="v">{mine.length}</div><div className="k">En tu ruta</div><div className="s">{piezasABordo} {piezasABordo === 1 ? 'pieza' : 'piezas'} por entregar</div></div>
        <div className="card sig"><div className="chip"><Icon name="check" /></div><div className="v">{entregadas.length}</div><div className="k">Entregadas</div><div className="s">de tu ruta</div></div>
        <div className={'card sig' + (incidencias ? ' dang' : '')}><div className="chip"><Icon name="clock" /></div><div className="v">{incidencias}</div><div className="k">Con incidencia</div><div className="s">requieren atención</div></div>
      </div>

      <MiEfectivo recarga={entregadas.length} />

      {orderedMine.length > 1 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="eyebrow" style={{ margin: 0 }}>Orden de tu ruta</div>
            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>Acomódalas como te convenga · se guarda</span>
          </div>
          <div style={{ padding: '0 10px 10px' }}>
            {orderedMine.map((s, i) => {
              const info = stopInfo(s)
              if (!info) return null
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', borderBottom: i < orderedMine.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span className="mono" style={{ width: 22, height: 22, borderRadius: 7, background: 'var(--green-deep)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flex: 'none' }}>{i + 1}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.addr}</div>
                  </div>
                  {(() => {
                    const first = i === 0, last = i === orderedMine.length - 1
                    const b: React.CSSProperties = { minWidth: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, padding: 0 }
                    return (
                      <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                        <button type="button" className="btn ghost sm" aria-label="Mover al inicio" title="Al inicio" disabled={first} style={{ ...b, ...(first ? { opacity: 0.3 } : {}) }} onClick={() => moveEnd(s.id, 'top')}>⤒</button>
                        <button type="button" className="btn ghost sm" aria-label="Subir" disabled={first} style={{ ...b, ...(first ? { opacity: 0.3 } : {}) }} onClick={() => move(s.id, -1)}>▲</button>
                        <button type="button" className="btn ghost sm" aria-label="Bajar" disabled={last} style={{ ...b, ...(last ? { opacity: 0.3 } : {}) }} onClick={() => move(s.id, 1)}>▼</button>
                        <button type="button" className="btn ghost sm" aria-label="Mover al fin" title="Al fin" disabled={last} style={{ ...b, ...(last ? { opacity: 0.3 } : {}) }} onClick={() => moveEnd(s.id, 'bottom')}>⤓</button>
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {routeUrl && (
        <a className="btn" href={routeUrl} target="_blank" rel="noreferrer" style={{ justifyContent: 'center' }}>
          <Icon name="truck" /> Abrir ruta completa en Google Maps ({routeStops.length} parada{routeStops.length === 1 ? '' : 's'})
        </a>
      )}

      {mine.length === 0 ? (
        <Vacio icono="truck" titulo="No tienes entregas asignadas pendientes." pista="Cuando Almacén te asigne una ruta, aparecerá aquí." />
      ) : (
        orderedMine.map((s) => {
          const order = orderById[s.order_id]
          if (!order) return null
          const client = clienteDePedido(order)
          const deliv = deliveryOf(order) // dirección/teléfono de ENTREGA (del pedido; respaldo al perfil)
          const items = order.items.filter((it) => it.unit_price != null)
          return (
            <div key={s.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
                {s.incident && !s.incident.resolved
                  ? <span className="pill p-dang">Incidencia: {s.incident.type}</span>
                  : s.status === 'por_despachar'
                    ? <span className="pill p-neu">Por despachar</span>
                    : s.status === 'despachado'
                      ? <span className="pill p-warn">Confirma tu carga</span>
                      : <span className="pill p-blue"><span className="d" /> En reparto</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }} data-testid="chofer-promesa">
                  {/* Lo que se le prometió al cliente (día y horario) manda; la estimada del envío es respaldo. */}
                  {(() => { const e = entregaDelPedido(order.shipping_meta); return e ? promesaDe(e, hoyNegocio()) : s.estimated_delivery_at ? `Estimada ${fmtDate(s.estimated_delivery_at)}` : '' })()}
                </span>
              </div>

              {/* CALIDAD VISUAL (7 nov) · para usarse con una mano en la calle: quién y dónde en grande, y dos botones de 52 px
                  (Llamar · Navegar) en vez de enlaces chicos. */}
              <div className="parada">
                <div className="parada-cliente">{client.name}{client.clinic ? <small>{client.clinic}</small> : null}</div>
                <div className="parada-dir">{deliv.addr}</div>
                <div className="parada-prod">{/* CAJAS-MEDIOS */}{items.map((it) => `${prodName[it.product_id ?? ''] ?? 'Producto'} ×${cantidadVista(products.find((p) => p.id === it.product_id), it.qty)}`).join(' · ')}</div>
                {/* AUDITORÍA CHOFER · antes de tocar la puerta: ¿está pagado o hay que cobrar? */}
                <div className={'parada-pago ' + (order.payment_status === 'paid' ? 'parada-pago--ok' : 'parada-pago--cobrar')} data-testid="parada-pago">
                  {order.payment_status === 'paid' ? 'Pagado · solo entregar'
                    : order.payment_status === 'parcial' ? 'Pago incompleto · cobra el saldo abajo al entregar'
                    : `Por cobrar${order.total != null ? ` · ${money(order.total)}` : ''}${(() => { const c = (order.shipping_meta as { cobro_al_recibir?: string } | null)?.cobro_al_recibir; return c === 'tarjeta' ? ' con terminal' : c === 'efectivo' ? ' en efectivo' : c === 'transferencia' ? ' por transferencia' : '' })()} · regístralo abajo al entregar`}
                </div>
                <div className="parada-botones">
                  {telParaMarcar(deliv.phone) && <a className="btn ghost" href={`tel:${telParaMarcar(deliv.phone)}`} aria-label={`Llamar al ${deliv.phone}`}><Phone size={18} /> Llamar</a>}
                  <a className="btn ghost" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(deliv.addr)}`} target="_blank" rel="noreferrer"><Navigation size={18} /> Navegar</a>
                </div>
              </div>

              {s.status === 'por_despachar' ? (
                <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
                  <Icon name="clock" /><span>Esperando que Almacén te <b>despache la carga</b>. En cuanto la entreguen, confírmala aquí.</span>
                </div>
              ) : s.status === 'despachado' ? (
                <div>
                  <div className="sysnote" style={{ marginBottom: 10 }}>
                    <Icon name="truck" /><span>Almacén despachó tu carga{s.dispatched_by ? ` (autorizó ${s.dispatched_by})` : ''}. Cuenta tus paquetes y confirma que los recibiste.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" type="button" disabled={!!cargando[s.id]} onClick={async () => {
                      setCargando((c) => ({ ...c, [s.id]: true }))
                      const r = await confirmLoad(s.id, driverName(driverId), order.external_ref ?? order.id)
                      setCargando((c) => ({ ...c, [s.id]: false }))
                      avisar(r.ok, r.ok ? `Carga confirmada: ${order.external_ref ?? ''}` : `No quedó confirmada la carga. ${r.error ?? 'Intenta de nuevo.'}`)
                    }}>
                      <Icon name="check" /> Confirmar que recibí mi carga
                    </button>
                    <button className="btn ghost" type="button" onClick={() => setLoadOpen((m) => ({ ...m, [s.id]: !m[s.id] }))}>
                      <Icon name="x" /> Reportar problema con la carga
                    </button>
                  </div>
                  {loadOpen[s.id] && (
                    <div className="field-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                      <select
                        value={loadType[s.id] ?? LOAD_INCIDENT_TYPES[0]}
                        onChange={(e) => setLoadType((m) => ({ ...m, [s.id]: e.target.value }))}
                        style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 13.5, backgroundColor: 'var(--cp-surface)' }}
                      >
                        {LOAD_INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input
                        value={loadNote[s.id] ?? ''}
                        onChange={(e) => setLoadNote((m) => ({ ...m, [s.id]: e.target.value }))}
                        placeholder="Detalle (ej. faltan 2 cajas del producto X)"
                        style={{ flex: 1, minWidth: 160, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)' }}
                      />
                      <button className="btn sm" type="button" onClick={() => reportLoad(s.id, order.external_ref ?? order.id)}>Avisar a Almacén</button>
                    </div>
                  )}
                </div>
              ) : (
              <>
              {/* UX MODERNO · Fase 3 (auditoría: "cerrar una entrega cuesta demasiado"): tres pasos en orden, botones grandes. */}
              <ol className="entrega-pasos">
                <li className={received[s.id]?.trim() ? 'hecho' : undefined}>
                  <span className="entrega-n" aria-hidden>{received[s.id]?.trim() ? <Icon name="check" /> : 1}</span>
                  <input className="entrega-quien" value={received[s.id] ?? ''} aria-label="Quién recibió"
                    onChange={(e) => setReceived((r) => ({ ...r, [s.id]: e.target.value }))} placeholder="¿Quién recibe? (nombre)" />
                </li>
                <li className={firmas[s.id] ? 'hecho entrega-firma' : 'entrega-firma'}>
                  <span className="entrega-n" aria-hidden>{firmas[s.id] ? <Icon name="check" /> : 2}</span>
                  <FirmaEntrega deshabilitada={!!uploading[s.id]} onCambio={(f) => setFirmas((m) => ({ ...m, [s.id]: f }))} />
                </li>
                {order.payment_status !== 'paid' && (
                  <li className="entrega-cobro">
                    <span className="entrega-n" aria-hidden>$</span>
                    <CobroEntrega shipmentId={s.id} con={(order.shipping_meta as { cobro_al_recibir?: string } | null)?.cobro_al_recibir ?? null} />
                  </li>
                )}
                <li>
                  <span className="entrega-n" aria-hidden>3</span>
                  {(() => {
                    // FIRMA DE ENTREGA · nombre + firma; la firma se guarda al tocar el botón y solo entonces se cierra.
                    const ready = Boolean(firmas[s.id]) && Boolean(received[s.id]?.trim()) && !uploading[s.id]
                    return (
                      <button className="btn entrega-ok" type="button" disabled={!ready} onClick={() => deliver(s.id, order.id, order.external_ref ?? order.id)} data-testid="entrega-marcar">
                        <Icon name="check" /> {uploading[s.id] ? 'Guardando firma…' : 'Marcar entregado'}
                      </button>
                    )
                  })()}
                </li>
              </ol>
              {upErr[s.id] && (
                <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 8, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Icon name="x" /> No se pudo guardar la firma (revisa tu señal). Vuelve a tocar «Marcar entregado», o si ya entregaste, ciérrala registrando el motivo.</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input
                      value={noPhoto[s.id] ?? ''}
                      onChange={(e) => setNoPhoto((m) => ({ ...m, [s.id]: e.target.value }))}
                      placeholder="Motivo (obligatorio): ej. sin señal en la zona"
                      style={{ flex: 1, minWidth: 180, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)', color: 'var(--ink)' }}
                    />
                    {(() => {
                      const ok = Boolean(noPhoto[s.id]?.trim()) && Boolean(received[s.id]?.trim())
                      return (
                        <button className="btn sm" type="button" disabled={!ok} style={!ok ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                          onClick={() => deliverNoPhoto(s.id, order.id, order.external_ref ?? order.id, received[s.id]!.trim(), noPhoto[s.id]!.trim())}>
                          Entregar sin firma
                        </button>
                      )
                    })()}
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.85 }}>Requiere el nombre de quién recibió (arriba) y un motivo. Queda registrado para que Almacén/Dirección pidan la evidencia después.</span>
                </div>
              )}

              <details style={{ marginTop: 10 }}>
                <summary className="btn ghost parada-incidencia">¿Problema con la entrega? Reportar incidencia</summary>
                <div className="field-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <select
                    value={incType[s.id] ?? INCIDENT_TYPES[0]}
                    onChange={(e) => setIncType((m) => ({ ...m, [s.id]: e.target.value }))}
                    style={{ padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 13.5, backgroundColor: 'var(--cp-surface)' }}
                  >
                    {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    value={incNote[s.id] ?? ''}
                    onChange={(e) => setIncNote((m) => ({ ...m, [s.id]: e.target.value }))}
                    placeholder="Nota (opcional)"
                    style={{ flex: 1, minWidth: 160, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)' }}
                  />
                  <button className="btn ghost sm" type="button" onClick={() => reportInc(s.id, order.external_ref ?? order.id)}>Enviar incidencia</button>
                </div>
              </details>
              </>
              )}
            </div>
          )
        })
      )}

      {entregadas.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 16px 8px' }}>
            <div className="eyebrow" style={{ margin: 0 }}>Entregas cerradas ({entregadas.length})</div>
          </div>
          <div style={{ padding: '0 12px 12px' }}>
            {entregadas.map((s, i) => {
              const o = orderById[s.order_id]
              return (
                // .pp-cerrada (pulido-portal.css): rejilla por áreas; en escritorio una fila, en móvil se
                // apila (folio · cliente · fecha / quién recibió / "Ver prueba" a lo ancho con 44 px).
                <div key={s.id} className="pp-cerrada" style={{ borderBottom: i < entregadas.length - 1 ? '1px solid var(--line)' : 'none' }}>
                  <span className="mono pp-cerrada-folio">{o?.external_ref ?? '—'}</span>
                  <span className="pp-cerrada-cli">{o ? clienteDePedido(o).name : 'Cliente'}</span>
                  {s.received_by && <span className="pp-cerrada-rec">Recibió: {s.received_by}</span>}
                  {s.delivered_at && <span className="pp-cerrada-fecha">{fmtDate(s.delivered_at)}</span>}
                  {s.proof_image_url && (
                    <button className="btn ghost sm pp-cerrada-prueba" type="button" onClick={() => verPrueba(s.proof_image_url)}><Icon name="image" /> Ver prueba</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {toast && <div className="toast show"><Icon name="check" /> {toast}</div>}
    </div>
  )
}
