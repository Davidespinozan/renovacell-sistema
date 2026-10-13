// Guías: envíos generados (paquetería con guía o chofer propio) con su estatus.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { ExportButton } from '../../app/ExportButton'
import { fmtDate } from '../../lib/format'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { driverName } from '../../data/mock/shipments'
import { etiquetaDeGuia } from '../../data/shipping/provider'
import { useRastreo } from '../../data/hooks/useRastreo'
import { RastreoEnvio } from '../../app/RastreoEnvio'
import { RecoleccionGuia } from '../../app/RecoleccionGuia'
import { recoleccionDe } from '../../data/shipping/recoleccion'
import { reloadShipments } from '../../data/store/shipmentsStore'
import { reloadOrders } from '../../data/store/ordersStore'

function shipPill(status: string | null): { label: string; pill: string } {
  switch (status) {
    case 'assigned': return { label: 'Asignado a chofer', pill: 'p-warn' }
    case 'por_despachar': return { label: 'Por despachar', pill: 'p-warn' }
    case 'despachado': return { label: 'Despachado', pill: 'p-blue' }
    case 'in_transit': return { label: 'En camino', pill: 'p-blue' }
    case 'guia_generada': return { label: 'Guía generada · por entregar a paquetería', pill: 'p-warn' }
    case 'out_for_delivery': return { label: 'En reparto', pill: 'p-blue' }
    case 'incident': return { label: 'Incidencia', pill: 'p-dang' }
    case 'delivered': return { label: 'Entregado', pill: 'p-ok' }
    default: return { label: status ?? '—', pill: 'p-neu' }
  }
}

// Una guía de paquetería recién generada NO está "en camino": el paquete sigue en el local hasta que se entrega a la
// paquetería. El servidor la registra como in_transit; aquí se muestra lo que realmente pasa mientras nadie la despache.
function estadoVisible(s: { status: string | null; tracking_number?: string | null; driver_id?: string | null; dispatched_at?: string | null }): string | null {
  return s.status === 'in_transit' && s.tracking_number && !s.driver_id && !s.dispatched_at ? 'guia_generada' : s.status
}

// Rastreo de UNA guía: se pone al día al abrir la pantalla; si la paquetería ya entregó, el pedido se cierra y la
// lista se recarga.
function RastreoDeGuia({ orderId }: { orderId: string }) {
  const { rastreo, cargando, actualizar } = useRastreo(orderId, true, () => { reloadShipments(); reloadOrders() })
  return <RastreoEnvio rastreo={rastreo} cargando={cargando} onActualizar={actualizar} />
}

export function Guias() {
  const { data: shipments } = useShipments()
  const { data: orders } = useAllOrders()

  // Reimprimir la etiqueta de una guía ya generada (enlace nuevo de 1 h; no vuelve a comprar la guía).
  const [bajando, setBajando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const descargar = async (orderId: string, shipmentId: string) => {
    if (bajando) return
    setBajando(shipmentId); setAviso(null)
    // La pestaña se abre en el clic (si se abre después de esperar, el navegador la bloquea).
    const w = window.open('', '_blank')
    try {
      const e = await etiquetaDeGuia(orderId)
      if (!e) throw new Error('sin etiqueta')
      if (w) w.location.href = e.url; else window.location.href = e.url
    } catch {
      w?.close()
      setAviso('No se pudo obtener la etiqueta de esa guía. Intenta de nuevo; si persiste, avisa a Dirección.')
    }
    setBajando(null)
  }

  const folioOf = useMemo(() => {
    const m: Record<string, string> = {}
    orders.forEach((o) => (m[o.id] = o.external_ref ?? o.id))
    return m
  }, [orders])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow">Empaque · Guías</div>
        <ExportButton
          name="guias"
          style={{ marginLeft: 'auto' }}
          rows={shipments.map((s) => ({
            pedido: folioOf[s.order_id] ?? s.order_id,
            metodo: s.driver_id ? `Chofer propio · ${driverName(s.driver_id)}` : `${s.carrier ?? ''}${s.tracking_number ? ` · guía ${s.tracking_number}` : ''}`,
            estimada: s.estimated_delivery_at ?? '',
            estatus: shipPill(estadoVisible(s)).label,
          }))}
          columns={[
            { key: 'pedido', label: 'Pedido' },
            { key: 'metodo', label: 'Método' },
            { key: 'estimada', label: 'Estimada', format: (v) => (v ? fmtDate(v as string) : '') },
            { key: 'estatus', label: 'Estatus' },
          ]}
        />
      </div>
      {aviso && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }}><span>{aviso}</span></div>}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Pedido</th><th>Método</th><th>Estimada</th><th>Estatus</th><th>Etiqueta</th></tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const sp = shipPill(estadoVisible(s))
                return (
                  <React.Fragment key={s.id}>
                  <tr>
                    <td data-label="Pedido" className="mono">{folioOf[s.order_id] ?? s.order_id}</td>
                    <td data-label="Método">
                      {s.driver_id ? (
                        <span><Icon name="usercheck" style={{ width: 13, height: 13, display: 'inline', verticalAlign: '-2px' }} /> {driverName(s.driver_id)}</span>
                      ) : (
                        <span>{s.carrier} {s.tracking_number && <span className="lc" style={{ marginLeft: 6 }}>{s.tracking_number}</span>}
                          {s.tracking_number && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{s.pickup_confirmation ? 'La paquetería pasará por el paquete (recolección agendada).' : 'La guía no incluye recolección: entrega el paquete en una sucursal o agenda la recolección aquí abajo.'}</span>}
                        </span>
                      )}
                    </td>
                    <td data-label="Estimada">{s.estimated_delivery_at ? fmtDate(s.estimated_delivery_at) : '—'}</td>
                    <td data-label="Estatus"><span className={'pill ' + sp.pill}>{sp.label}</span></td>
                    <td data-label="Etiqueta">
                      {s.label_url
                        ? <a className="btn ghost sm" href={s.label_url} target="_blank" rel="noreferrer"><Icon name="download" style={{ width: 13, height: 13 }} /> Guía</a>
                        : s.tracking_number && !s.driver_id
                          ? <button className="btn ghost sm" type="button" disabled={bajando === s.id} onClick={() => void descargar(s.order_id, s.id)} data-testid="descargar-etiqueta"><Icon name="download" style={{ width: 13, height: 13 }} /> {bajando === s.id ? 'Abriendo…' : 'Descargar etiqueta'}</button>
                          : <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                  {s.tracking_number && !s.driver_id && s.status !== 'delivered' && s.status !== 'cancelado' && (
                    <tr><td colSpan={5} style={{ paddingTop: 0 }}>
                      <RecoleccionGuia orderId={s.order_id} agendada={recoleccionDe(s)} onCambio={reloadShipments} />
                      <RastreoDeGuia orderId={s.order_id} />
                    </td></tr>
                  )}
                  </React.Fragment>
                )
              })}
              {shipments.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Aún no hay envíos generados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
