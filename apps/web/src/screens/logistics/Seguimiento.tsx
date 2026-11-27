// SEGUIMIENTO (admin + staff de logística): todos los envíos —propios y
// paquetería— con su estatus, y DETECCIÓN DE ATORADOS (vencidos o surtidos sin
// salir). Es la vista para cazar el pedido que se atoró (caso S12840).
import React, { useMemo, useState } from 'react'
import { avisar, pedirTexto } from '../../app/dialogos'   // CALIDAD VISUAL · diálogos del sistema
import { useRastreo } from '../../data/hooks/useRastreo'
import { RastreoEnvio } from '../../app/RastreoEnvio'
import { reloadShipments } from '../../data/store/shipmentsStore'
import { reloadOrders } from '../../data/store/ordersStore'
import { Icon } from '../../app/icons'
import { Vacio } from '../../app/EmptyState'
import { ExportButton } from '../../app/ExportButton'
import { fmtDate } from '../../lib/format'
import { signedProofUrl } from '../../lib/uploads'
import { entregar } from '../../data/ops/entregar'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useShipments } from '../../data/hooks/useShipments'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useRole } from '../../auth/RoleContext'
import { driverName, getDrivers } from '../../data/mock/shipments'
import { clienteDePedido, deliveryOf } from '../../data/mock/profiles'
import { diagnoseShipment, envioVigente, esRecoge } from '../../data/ops/seguimiento'
import { ETAPAS, ETIQUETA_ETAPA, ETIQUETA_MEDIO, MEDIOS, contar, diagnosticoEnAlmacen, esperaEnAlmacen, etapaDe, medioDe, metodoPrometido, type EtapaEnvio, type MedioEnvio } from '../../data/ops/seguimientoVista'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { useCorteEntrega } from '../../data/hooks/useCorteEntrega'
import { hoyNegocio } from '../../data/periodo'
import { entregarRecoge } from '../../data/store/ordersStore'
import type { Shipment } from '../../data/types'
import { cantidadVista } from '../../lib/cajas'
import { capitalizarNombre } from '../../lib/nombres'

interface Row {
  order: OrderWithItems
  shipment: Shipment | undefined
  stuck: boolean
  reason: string
  statusLabel: string
  statusPill: string
  medio: MedioEnvio | null      // por dónde viaja: paquetería, chofer o lo recogen
  etapa: EtapaEnvio             // en qué va: por preparar → preparado → en camino → entregado
  salida?: string | null        // solo «por preparar»: cuándo sale (o cuándo debió salir)
}

/**
 * `embebido`: cuando la lista vive dentro de otra pantalla (Inicio del vendedor, sección "en camino"), la sección
 * anfitriona ya trae su título: se ocultan el eyebrow propio y el Exportar (deshabilitado sin filas, solo ruido), y
 * sin pedidos se muestra un vacío compacto en lugar de nada. Por omisión, la pantalla completa de siempre.
 */
export function Seguimiento({ embebido = false }: { embebido?: boolean } = {}) {
  const { data: orders } = useAllOrders()
  const { data: shipments, resolveIncident, regresarAlAlmacen, cambiarChofer } = useShipments()
  const { data: products } = useProducts()
  const { data: doctors } = useDoctors()
  const { role, user } = useRole()
  const puedeAlmacen = role === 'admin' || role === 'warehouse' || role === 'packing'
  const [cambioDe, setCambioDe] = useState<string | null>(null)
  // TRAZABILIDAD COMPLETA (27 nov 2026, dueño: «¿por qué en Envíos nada más se ven las entregas locales? ¿no hay manera
  // de ver trazabilidad de envíos foráneos?»). La lista solo traía pedidos YA preparados: los foráneos pagados que
  // seguían en Almacén sin guía no existían aquí. Ahora entran también los que esperan en Almacén, y se filtra por
  // dónde viajan y en qué van. La vista embebida del vendedor («en camino») queda como estaba.
  const { byOrder } = useOrderMoney()
  const corte = useCorteEntrega()
  const hoy = hoyNegocio()
  const [medio, setMedio] = useState<MedioEnvio | 'todos'>('todos')
  const [etapa, setEtapa] = useState<EtapaEnvio | 'todas'>('todas')
  // BLOQUE1 · el pedido regresó (rechazado, no estaba…): vuelve a Surtido para asignar otro chofer.
  const regresar = async (shipmentId: string, folio: string) => {
    const motivo = await pedirTexto(`¿Por qué regresó ${folio} al almacén? (vuelve a Surtido para asignarle chofer de nuevo)`)
    if (!motivo || !motivo.trim()) return
    const r = await regresarAlAlmacen(shipmentId, motivo.trim(), folio)
    if (r.ok) void avisar(`${folio} regresó al almacén. Asígnale chofer de nuevo en Surtido.`)
  }
  const cambiar = async (shipmentId: string, driverId: string, folio: string) => {
    setCambioDe(null)
    if (!driverId) return
    const r = await cambiarChofer(shipmentId, driverId, folio)
    if (r.ok) void avisar(`Listo: ${folio} ahora lo lleva ${driverName(driverId)}.`)
  }

  // Vendedor: solo pedidos de SU cartera (doctor.meta.owner). Otros roles: todos.
  const ownerByDoctor = useMemo(() => {
    const m: Record<string, string> = {}
    doctors.forEach((d) => { const o = (d.meta as Record<string, unknown>)?.owner as string; if (o) m[d.id] = o })
    return m
  }, [doctors])
  // AUDITORÍA (19 nov 2026) · la base ya le entrega al vendedor SOLO los pedidos de su cartera (RLS); el filtro por
  // doctor.meta.owner dejaba la lista siempre vacía (los pedidos son de cliente, sin doctor). Se conserva la firma.
  const inCartera = (o: OrderWithItems) => role !== 'pos' || !!o || !!ownerByDoctor

  const incidents = useMemo(
    () => shipments
      .filter((s) => s.incident && !s.incident.resolved && s.status !== 'delivered' && s.status !== 'cancelado')   // AUDITORÍA · lo entregado o cancelado ya no se «reintenta»
      .map((s) => ({ shipment: s, order: orders.find((o) => o.id === s.order_id) }))
      .filter(({ order }) => (order ? inCartera(order) : role !== 'pos')),
    [shipments, orders, role, user, ownerByDoctor],
  )

  const prodName = useMemo(() => {
    const m: Record<string, string> = {}
    products.forEach((p) => (m[p.id] = p.name))
    return m
  }, [products])

  const rows = useMemo(() => {
    const noEsPos = (o: OrderWithItems) => (o.shipping_meta as { channel?: string } | null)?.channel !== 'pos'   // POS no es envío
    const inFlight = orders.filter((o) => ['packed', 'shipped', 'delivered'].includes(o.status ?? '') && noEsPos(o) && inCartera(o))
    const enCurso = inFlight
      .map((o): Row => {
        const shipment = envioVigente(shipments, o.id)
        const base = { order: o, shipment, medio: medioDe(o, shipment), etapa: etapaDe(o) }
        // REVISIÓN 19 nov · la vendedora ve el pedido pero no su envío (permisos): sin envío legible no se inventa
        // «sin asignar · N días detenido»; se muestra el estado del pedido.
        if (role === 'pos' && !shipment && o.status !== 'delivered') return { ...base, stuck: false, reason: '', statusLabel: o.status === 'shipped' ? 'En camino' : 'Preparando envío', statusPill: 'p-neu' }
        return { ...base, ...diagnoseShipment(o, shipment) }
      })
    // Los que ya le tocan a Almacén y siguen sin prepararse (pagados o con crédito): sin ellos, un foráneo sin guía no existía aquí.
    const enAlmacen = embebido ? [] : orders
      .filter((o) => noEsPos(o) && inCartera(o) && esperaEnAlmacen(o, byOrder[o.id]))
      .map((o): Row => ({ order: o, shipment: undefined, medio: medioDe(o, undefined), etapa: 'por_preparar', ...diagnosticoEnAlmacen(o, hoy, corte) }))
    return [...enAlmacen, ...enCurso]
      .sort((a, b) => Number(b.stuck) - Number(a.stuck) || (a.order.created_at < b.order.created_at ? 1 : -1))
  }, [orders, shipments, role, user, ownerByDoctor, byOrder, hoy, corte, embebido])
  const cuenta = useMemo(() => contar(rows, medio), [rows, medio])
  const visibles = embebido ? rows : rows.filter((r) => (medio === 'todos' || r.medio === medio) && (etapa === 'todas' || r.etapa === etapa))
  // Lo que sigue en Almacén se avisa aparte de los «atorados»: así el número de atorados es el MISMO que ven en Inicio y en
  // el Tablero (preparados sin salir o con entrega vencida), y lo que Almacén no ha preparado tiene su propio aviso.
  const delMedio = rows.filter((r) => medio === 'todos' || r.medio === medio)
  const enAlmacenN = delMedio.filter((r) => r.etapa === 'por_preparar').length
  const pasadosN = delMedio.filter((r) => r.etapa === 'por_preparar' && r.stuck).length
  const sinGuia = delMedio.filter((r) => r.etapa === 'por_preparar' && r.medio === 'paqueteria').length
  const stuckCount = (embebido ? rows : delMedio).filter((r) => r.stuck && r.etapa !== 'por_preparar').length


  return (
    <div className="grid" style={{ gap: 16 }}>
      {!embebido && <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow">Seguimiento de envíos</div>
        <ExportButton
          name="seguimiento-envios"
          style={{ marginLeft: 'auto' }}
          rows={rows.map((r) => {
            const client = clienteDePedido(r.order)
            const method = r.shipment
              ? r.shipment.driver_id ? `Chofer propio · ${driverName(r.shipment.driver_id)}` : `${r.shipment.carrier}${r.shipment.tracking_number ? ` · guía ${r.shipment.tracking_number}` : ''}`
              : metodoPrometido(r.order)
            return {
              folio: r.order.external_ref, viaja: r.medio ? ETIQUETA_MEDIO[r.medio] : '', estatus: r.statusLabel, detenido: r.stuck ? 'Sí' : 'No', motivo: r.reason || (r.salida ?? ''),
              cliente: client?.name ?? '', metodo: method,
              productos: r.order.items.map((it) => prodName[it.product_id ?? ''] ?? 'Producto').join(', '),
              estimada: r.shipment?.estimated_delivery_at ?? '',
            }
          })}
          columns={[
            { key: 'folio', label: 'Folio' },
            { key: 'viaja', label: 'Viaja por' },
            { key: 'estatus', label: 'Estatus' },
            { key: 'detenido', label: 'Detenido' },
            { key: 'motivo', label: 'Motivo' },
            { key: 'cliente', label: 'Cliente' },
            { key: 'metodo', label: 'Método de envío' },
            { key: 'productos', label: 'Productos' },
            { key: 'estimada', label: 'Entrega estimada', format: (v) => (v ? fmtDate(v as string) : '') },
          ]}
        />
      </div>}

      {!embebido && (
        <div className="seg-filtros" data-testid="seg-filtros">
          <div className="hoy-filtros" role="group" aria-label="Por dónde viaja">
            <button type="button" className={'fchip' + (medio === 'todos' ? ' on' : '')} aria-pressed={medio === 'todos'} onClick={() => setMedio('todos')} data-testid="seg-medio-todos">Todos <b>{rows.length}</b></button>
            {MEDIOS.map((m) => (
              <button key={m} type="button" className={'fchip' + (medio === m ? ' on' : '')} aria-pressed={medio === m} onClick={() => setMedio(m)} data-testid={`seg-medio-${m}`}>{ETIQUETA_MEDIO[m]} <b>{cuenta.porMedio[m]}</b></button>
            ))}
          </div>
          <div className="hoy-filtros" role="group" aria-label="En qué va">
            {ETAPAS.map((e) => (
              <button key={e} type="button" className={'fchip' + (etapa === e ? ' on' : '')} aria-pressed={etapa === e} onClick={() => setEtapa(etapa === e ? 'todas' : e)} data-testid={`seg-etapa-${e}`}>{ETIQUETA_ETAPA[e]} <b>{cuenta.porEtapa[e]}</b></button>
            ))}
          </div>
        </div>
      )}

      {!embebido && enAlmacenN > 0 && (etapa === 'todas' || etapa === 'por_preparar') && (
        <div className="sysnote" data-testid="seg-en-almacen" style={pasadosN > 0 ? { background: 'var(--warn-bg)', borderColor: 'var(--warn-line)', color: 'var(--warn)' } : undefined}>
          <Icon name="truck" />
          <span>
            <b>{enAlmacenN} {enAlmacenN === 1 ? 'pedido sigue' : 'pedidos siguen'} en Almacén sin preparar</b>{pasadosN > 0 ? ` · ${pasadosN} ya ${pasadosN === 1 ? 'pasó' : 'pasaron'} su fecha de salida` : ''}.
            {sinGuia > 0 && <> {sinGuia === 1 ? '1 va por paquetería y aún no tiene guía' : `${sinGuia} van por paquetería y aún no tienen guía`}: el rastreo aparece aquí en cuanto Almacén la registra.</>}
          </span>
        </div>
      )}

      {stuckCount > 0 && (
        <div className="alert">
          <div className="ico"><Icon name="truck" /></div>
          <div className="x">
            <b>{stuckCount} {stuckCount === 1 ? 'envío atorado' : 'envíos atorados'}.</b> Hay pedidos vencidos o surtidos sin salir. Revísalos antes de que el doctor reclame.
          </div>
        </div>
      )}

      {incidents.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)' }}>
          <div className="eyebrow">Incidencias de entrega ({incidents.length})</div>
          {incidents.map(({ shipment, order }) => {
            const folio = order?.external_ref ?? shipment.order_id
            return (
              <div key={shipment.id} className="lrow">
                <div>
                  <div className="nm mono">{folio}</div>
                  <div className="lt">{shipment.incident!.type}{shipment.incident!.note ? ` · ${shipment.incident!.note}` : ''}</div>
                </div>
                <div className="seg-inc-acciones">
                  <button className="btn sm" type="button" onClick={() => resolveIncident(shipment.id, folio)}>
                    <Icon name="check" /> Reintentar
                  </button>
                  {puedeAlmacen && shipment.driver_id && (cambioDe === shipment.id ? (
                    <select className="seg-chofer" autoFocus defaultValue="" aria-label="Nuevo chofer" onChange={(e) => void cambiar(shipment.id, e.target.value, folio)} onBlur={() => setCambioDe(null)}>
                      <option value="" disabled>Elegir chofer…</option>
                      {getDrivers().filter((d) => d.id !== shipment.driver_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  ) : (
                    <button className="btn ghost sm" type="button" onClick={() => setCambioDe(shipment.id)} data-testid="cambiar-chofer">Cambiar chofer</button>
                  ))}
                  {puedeAlmacen && shipment.driver_id && (
                    <button className="btn ghost sm" type="button" onClick={() => void regresar(shipment.id, folio)} data-testid="regreso-almacen">Regresó al almacén</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {embebido && rows.length === 0 && (
        <div className="op-vacio"><Vacio plano icono="truck" titulo="Sin pedidos en camino" data-testid="seguimiento-vacio" /></div>
      )}

      {!embebido && rows.length > 0 && visibles.length === 0 && (
        <div className="op-vacio"><Vacio plano icono="truck" titulo="Nada con ese filtro" data-testid="seg-filtro-vacio" /></div>
      )}

      {visibles.map((r) => (
        <ShipmentRow key={r.order.id} row={r} prodName={prodName} />
      ))}
    </div>
  )
}

function ShipmentRow({ row, prodName }: { row: Row; prodName: Record<string, string> }) {
  const { data: products } = useProducts()   // CAJAS-MEDIOS: para leer media caja en cajas
  const { order, shipment, stuck, reason, statusLabel, statusPill } = row
  const { role } = useRole()
  const { cambiarChofer } = useShipments()
  // BLOQUE1 · cambiar el chofer de una entrega viva (el chofer no vino, se reparte la ruta…).
  const cambiable = (role === 'admin' || role === 'warehouse' || role === 'packing') && !!shipment?.driver_id
    && ['por_despachar', 'despachado', 'out_for_delivery', 'incident'].includes(shipment.status ?? '')
  const [cambiando, setCambiando] = useState(false)
  const client = clienteDePedido(order)
  const deliv = deliveryOf(order) // dirección de ENTREGA del pedido (respaldo al perfil)
  const items = order.items.filter((it) => it.unit_price != null)
  const recoge = esRecoge(order)
  const method = shipment
    ? shipment.driver_id
      ? `Chofer propio · ${driverName(shipment.driver_id)}`
      : `${shipment.carrier}${shipment.tracking_number ? ` · guía ${shipment.tracking_number}` : ''}`
    : recoge ? 'Recoge en sucursal' : metodoPrometido(order)
  // Recoge en sucursal: se cierra aquí cuando el cliente pasa por su pedido (no hay chofer ni guía que lo cierren).
  const puedeEntregarRecoge = recoge && !shipment && order.status === 'shipped'
  const recogioYa = (order.shipping_meta as { recogio?: string } | null)?.recogio
  const [recogeAbierto, setRecogeAbierto] = useState(false)
  const [recogio, setRecogio] = useState('')
  const [entregandoRecoge, setEntregandoRecoge] = useState(false)
  const confirmarRecoge = async () => {
    if (!recogio.trim()) return
    setEntregandoRecoge(true)
    const r = await entregarRecoge(order.id, recogio.trim())
    setEntregandoRecoge(false)
    if (r.ok) setRecogeAbierto(false)
  }

  // PAQ-A · Envío por paquetería: su estado lo reporta la paquetería. Se pone al día al abrir; si ya entregó, el
  // pedido se cierra solo. El cierre manual queda solo como respaldo (cuando la paquetería no lo refleja).
  const tieneGuia = !!shipment && !shipment.driver_id && !!shipment.tracking_number
  const { rastreo, cargando: consultando, actualizar: actualizarRastreo } = useRastreo(order.id, tieneGuia && shipment?.status !== 'delivered', () => { reloadShipments(); reloadOrders() })
  const [recibio, setRecibio] = useState('')
  const [marcando, setMarcando] = useState(false)
  // Paquetería (envío sin chofer, en tránsito): staff cierra la entrega — antes no había
  // forma y quedaban "enviados" para siempre. confirmar_entrega autoriza a admin/almacén.
  const puedeCerrarPaqueteria = !!shipment && !shipment.driver_id && shipment.status !== 'delivered' && order.status === 'shipped'
  // Prueba de entrega visible (recall/disputa): antes la foto se guardaba y nadie la veía.
  const tienePrueba = !!shipment && shipment.status === 'delivered' && !!shipment.proof_image_url
  const abrirPrueba = async () => {
    const url = await signedProofUrl(shipment?.proof_image_url ?? null)
    if (url) window.open(url, '_blank', 'noopener')
    else void avisar('No se pudo abrir la evidencia de entrega.')
  }
  const cerrarPaqueteria = async () => {
    if (!shipment || !recibio.trim()) return
    const r = await entregar(shipment.id, order.id, null, recibio.trim())
    // Si no quedó, el formulario sigue abierto con lo capturado; el motivo aparece
    // en la franja de avisos.
    if (r.ok) setMarcando(false)
  }

  return (
    <div className="card" style={stuck ? { borderLeft: '4px solid var(--danger)' } : undefined} data-testid={`seg-fila-${order.external_ref ?? order.id}`} data-medio={row.medio ?? ''} data-etapa={row.etapa}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
        <span className={'pill ' + statusPill}><span className="d" /> {statusLabel}</span>
        {stuck && <span className="pill p-dang"><Icon name="x" style={{ width: 12, height: 12 }} /> Detenido</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {shipment?.estimated_delivery_at ? `Estimada ${fmtDate(shipment.estimated_delivery_at)}` : fmtDate(order.created_at)}
        </span>
      </div>

      {stuck && (
        <div className="sysnote" style={{ marginBottom: 10, background: 'var(--warn-bg)', borderColor: 'var(--warn-line)', color: 'var(--warn)' }}>
          <Icon name="truck" />
          <span>{reason}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, fontSize: 13 }}>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Cliente</div>{capitalizarNombre(client.name)}{client.clinic ? ` · ${client.clinic}` : ''}</div>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Dirección</div>{deliv.addr}</div>
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Método</div>{method}
          {cambiable && (cambiando ? (
            <select className="seg-chofer" autoFocus defaultValue="" aria-label="Nuevo chofer" onBlur={() => setCambiando(false)}
              onChange={(e) => { const v = e.target.value; setCambiando(false); if (v) void cambiarChofer(shipment!.id, v, order.external_ref ?? 'el pedido').then((r) => { if (r.ok) void avisar(`Ahora lo lleva ${driverName(v)}.`) }) }}>
              <option value="" disabled>Elegir chofer…</option>
              {getDrivers().filter((d) => d.id !== shipment!.driver_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : <> · <button className="rc-link" type="button" onClick={() => setCambiando(true)} data-testid="fila-cambiar-chofer">Cambiar</button></>)}
        </div>
        {row.etapa === 'por_preparar' && row.salida && !stuck && <div data-testid="seg-salida"><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Salida</div>{row.salida}</div>}
        <div><div className="lt" style={{ color: 'var(--ink-3)', fontSize: 11 }}>Productos</div>{items.map((it) => `${prodName[it.product_id ?? ''] ?? 'Producto'} ×${cantidadVista(products.find((p) => p.id === it.product_id), it.qty)}`).join(', ')}</div>
      </div>

      {tieneGuia && <RastreoEnvio rastreo={rastreo} cargando={consultando} onActualizar={actualizarRastreo} />}

      {(puedeEntregarRecoge || (recoge && recogioYa)) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }} data-testid="recoge-cierre">
          {recogioYa && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Recogió: {recogioYa}</span>}
          {puedeEntregarRecoge && (recogeAbierto ? (
            <>
              <input value={recogio} onChange={(e) => setRecogio(e.target.value)} placeholder="¿Quién lo recogió?" aria-label="Quién lo recogió"
                style={{ flex: 1, minWidth: 200, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none', backgroundColor: 'var(--cp-surface)' }} />
              <button className="btn sm" type="button" disabled={!recogio.trim() || entregandoRecoge} style={!recogio.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => void confirmarRecoge()} data-testid="recoge-confirmar"><Icon name="check" /> {entregandoRecoge ? 'Guardando…' : 'Confirmar entrega'}</button>
              <button className="btn ghost sm" type="button" onClick={() => setRecogeAbierto(false)}>Cancelar</button>
            </>
          ) : (
            <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setRecogeAbierto(true)} data-testid="recoge-entregar"><Icon name="check" /> Entregado al cliente</button>
          ))}
        </div>
      )}

      {(tienePrueba || puedeCerrarPaqueteria) && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
          {tienePrueba && (
            <button className="btn ghost sm" type="button" onClick={abrirPrueba}><Icon name="image" /> Ver prueba de entrega</button>
          )}
          {shipment?.status === 'delivered' && shipment.received_by && (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Recibió: {shipment.received_by}</span>
          )}
          {puedeCerrarPaqueteria && (marcando ? (
            <>
              <input value={recibio} onChange={(e) => setRecibio(e.target.value)} placeholder="¿Quién recibió el paquete? (acuse de la paquetería)"
                style={{ flex: 1, minWidth: 200, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none', backgroundColor: 'var(--cp-surface)' }} />
              <button className="btn sm" type="button" disabled={!recibio.trim()} style={!recibio.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={cerrarPaqueteria}><Icon name="check" /> Confirmar entrega</button>
              <button className="btn ghost sm" type="button" onClick={() => setMarcando(false)}>Cancelar</button>
            </>
          ) : (
            <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setMarcando(true)} title="Úsalo solo si la paquetería ya entregó al cliente y el sistema no lo refleja: normalmente se cierra solo al actualizar el rastreo."><Icon name="check" /> Cerrar entrega al cliente manualmente</button>
          ))}
        </div>
      )}
    </div>
  )
}
