// DESPACHO (Empaque / Dirección). Manifiesto de carga: autoriza y registra la
// entrega de la carga al chofer (quién y cuándo). El chofer luego confirma que
// la recibió para salir a reparto. Estilo CuboPolar: firma de Empaque, o
// Administración como alternativa si Empaque no puede.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { ExportButton } from '../../app/ExportButton'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { driverName } from '../../data/mock/shipments'
import { useRole } from '../../auth/RoleContext'

export function Despacho() {
  const { data: shipments, dispatchShipment } = useShipments()
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { user, role } = useRole()
  const [toast, setToast] = useState<string | null>(null)

  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products])
  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders])
  const who = `${user?.name ?? (role === 'admin' ? 'Administración' : 'Empaque')}`

  const porDespachar = shipments.filter((s) => s.driver_id && s.status === 'por_despachar')
  const enRuta = shipments.filter((s) => s.driver_id && (s.status === 'despachado' || s.status === 'out_for_delivery'))

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400) }

  const piezas = (orderId: string) => {
    const o = orderById[orderId]
    return o ? o.items.filter((it) => it.unit_price != null).reduce((t, it) => t + it.qty, 0) : 0
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Despacho">
        Antes de que el chofer salga, <b>autoriza la entrega de su carga</b> (queda registrado quién la
        entregó y a qué hora). El chofer confirma que la recibió para salir a reparto.
      </PageHead>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Por despachar</div>
          <ExportButton
            name="por-despachar"
            style={{ marginLeft: 'auto' }}
            rows={porDespachar.map((s) => ({ pedido: orderById[s.order_id]?.external_ref ?? s.order_id, chofer: driverName(s.driver_id), piezas: piezas(s.order_id) }))}
            columns={[
              { key: 'pedido', label: 'Pedido' },
              { key: 'chofer', label: 'Chofer' },
              { key: 'piezas', label: 'Piezas' },
            ]}
          />
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Pedido</th><th>Chofer</th><th>Piezas</th><th></th></tr></thead>
            <tbody>
              {porDespachar.map((s) => {
                const o = orderById[s.order_id]
                return (
                  <tr key={s.id}>
                    <td data-label="Pedido" className="mono">{o?.external_ref ?? s.order_id}</td>
                    <td data-label="Chofer">{driverName(s.driver_id)}</td>
                    <td data-label="Piezas" className="mono">{piezas(s.order_id)}</td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <button className="btn sm" type="button" onClick={() => { dispatchShipment(s.id, who, o?.external_ref ?? s.order_id); flash('Carga despachada · falta que el chofer confirme') }}>
                        <Icon name="truck" /> Entregar carga al chofer
                      </button>
                    </td>
                  </tr>
                )
              })}
              {porDespachar.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-3)' }}>Nada por despachar.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Despachadas / en ruta</div>
          <ExportButton
            name="en-ruta"
            style={{ marginLeft: 'auto' }}
            rows={enRuta.map((s) => ({ pedido: orderById[s.order_id]?.external_ref ?? s.order_id, chofer: driverName(s.driver_id), estado: s.status === 'out_for_delivery' ? 'En reparto' : 'Esperando confirmación', autorizo: s.dispatched_by ?? '', fecha: s.dispatched_at ?? '' }))}
            columns={[
              { key: 'pedido', label: 'Pedido' },
              { key: 'chofer', label: 'Chofer' },
              { key: 'estado', label: 'Estado' },
              { key: 'autorizo', label: 'Autorizó' },
              { key: 'fecha', label: 'Despachado', format: (v) => (v ? fmtDate(v as string) : '') },
            ]}
          />
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Pedido</th><th>Chofer</th><th>Estado</th><th>Autorizó</th></tr></thead>
            <tbody>
              {enRuta.map((s) => {
                const o = orderById[s.order_id]
                const confirmada = s.status === 'out_for_delivery'
                return (
                  <tr key={s.id}>
                    <td data-label="Pedido" className="mono">{o?.external_ref ?? s.order_id}</td>
                    <td data-label="Chofer">{driverName(s.driver_id)}</td>
                    <td data-label="Estado"><span className={'pill ' + (confirmada ? 'p-ok' : 'p-warn')}>{confirmada ? 'En reparto' : 'Esperando confirmación'}</span></td>
                    <td data-label="Autorizó">{s.dispatched_by ?? '—'}{s.dispatched_at ? ` · ${fmtDate(s.dispatched_at)}` : ''}</td>
                  </tr>
                )
              })}
              {enRuta.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-3)' }}>Sin cargas despachadas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {toast && <div className="toast show"><Icon name="check" /> {toast}</div>}
    </div>
  )
}
