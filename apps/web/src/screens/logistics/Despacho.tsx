// DESPACHO (Empaque / Dirección). Manifiesto de carga POR CHOFER: agrupa toda la carga
// del día de cada chofer en una hoja de salida, la despacha de un tiro (no pedido por
// pedido) y la imprime para que el chofer FIRME al recibirla. Queda registrado quién la
// entregó y a qué hora. El chofer luego confirma la recepción para salir a reparto.
import React, { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useShipments } from '../../data/hooks/useShipments'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { driverName } from '../../data/mock/shipments'
import { deliveryOf } from '../../data/mock/profiles'
import { useRole } from '../../auth/RoleContext'

interface Parada { shipmentId: string; folio: string; cliente: string; direccion: string; telefono: string; piezas: number }
interface Manifiesto { driverId: string; chofer: string; paradas: Parada[]; totalPiezas: number }

export function Despacho() {
  const { data: shipments, dispatchShipment } = useShipments()
  const { data: orders } = useAllOrders()
  const { user, role } = useRole()
  const [toast, setToast] = useState<string | null>(null)
  const [printMf, setPrintMf] = useState<Manifiesto | null>(null)

  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])) as Record<string, OrderWithItems | undefined>, [orders])
  const who = `${user?.name ?? (role === 'admin' ? 'Administración' : 'Empaque')}`

  const piezas = (orderId: string) => {
    const o = orderById[orderId]
    return o ? o.items.filter((it) => it.unit_price != null).reduce((t, it) => t + it.qty, 0) : 0
  }

  // Agrupa lo "por despachar" (con chofer propio) en un manifiesto por chofer.
  const manifiestos = useMemo<Manifiesto[]>(() => {
    const porDespachar = shipments.filter((s) => s.driver_id && s.status === 'por_despachar')
    const byDriver = new Map<string, Parada[]>()
    porDespachar.forEach((s) => {
      const o = orderById[s.order_id]
      const d = o ? deliveryOf(o) : { name: '—', addr: '—', phone: '—' }
      const arr = byDriver.get(s.driver_id!) ?? []
      arr.push({ shipmentId: s.id, folio: o?.external_ref ?? s.order_id, cliente: d.name, direccion: d.addr, telefono: d.phone, piezas: piezas(s.order_id) })
      byDriver.set(s.driver_id!, arr)
    })
    return [...byDriver.entries()].map(([driverId, paradas]) => ({
      driverId, chofer: driverName(driverId), paradas,
      totalPiezas: paradas.reduce((t, p) => t + p.piezas, 0),
    }))
  }, [shipments, orderById])

  const enRuta = shipments.filter((s) => s.driver_id && (s.status === 'despachado' || s.status === 'out_for_delivery'))

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600) }

  const despacharTodo = (mf: Manifiesto) => {
    mf.paradas.forEach((p) => dispatchShipment(p.shipmentId, who, p.folio))
    flash(`Manifiesto despachado a ${mf.chofer} · ${mf.paradas.length} pedido(s) · falta que confirme`)
  }

  // Imprime la hoja de salida de un chofer (misma técnica que el recibo del POS: monta el
  // documento en un portal oculto, marca el body y limpia la clase en afterprint).
  const printTimer = useRef<number | null>(null)
  const imprimir = (mf: Manifiesto) => {
    setPrintMf(mf)
    if (printTimer.current) cancelAnimationFrame(printTimer.current)
    printTimer.current = requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add('printing-manifiesto')
      const cleanup = () => { document.body.classList.remove('printing-manifiesto'); window.removeEventListener('afterprint', cleanup) }
      window.addEventListener('afterprint', cleanup)
      window.print()
    }))
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Despacho">
        Arma la <b>hoja de salida (manifiesto)</b> de cada chofer: revisa su carga del día,
        despáchala completa y imprímela para que la <b>firme al recibirla</b>. Queda registrado
        quién la entregó y a qué hora; el chofer confirma la recepción para salir a reparto.
      </PageHead>

      {manifiestos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Nada por despachar.</div>
      ) : manifiestos.map((mf) => (
        <div key={mf.driverId} className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="chip" style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--green-soft)' }}><Icon name="truck" /></div>
            <div>
              <div style={{ fontWeight: 700 }}>{mf.chofer}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{mf.paradas.length} pedido(s) · {mf.totalPiezas} pieza(s)</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn ghost sm" type="button" onClick={() => imprimir(mf)}><Icon name="download" /> Imprimir manifiesto</button>
              <button className="btn sm" type="button" onClick={() => despacharTodo(mf)}><Icon name="truck" /> Despachar todo ({mf.paradas.length})</button>
            </div>
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <table className="tbl-cards">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Dirección</th><th>Piezas</th><th></th></tr></thead>
              <tbody>
                {mf.paradas.map((p) => (
                  <tr key={p.shipmentId}>
                    <td data-label="Pedido" className="mono">{p.folio}</td>
                    <td data-label="Cliente">{p.cliente}</td>
                    <td data-label="Dirección" style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{p.direccion}</td>
                    <td data-label="Piezas" className="mono">{p.piezas}</td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <button className="btn ghost sm" type="button" title="Despachar solo este pedido" onClick={() => { dispatchShipment(p.shipmentId, who, p.folio); flash(`Despachado ${p.folio}`) }}>Despachar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px' }}>
          <div className="eyebrow" style={{ margin: 0 }}>Despachadas / en ruta</div>
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

      {printMf && <ManifiestoPrint mf={printMf} who={who} />}
      {toast && <div className="toast show"><Icon name="check" /> {toast}</div>}
    </div>
  )
}

// Hoja de salida imprimible: folios, destinos, piezas y renglones de FIRMA (quien entrega
// y el chofer que recibe). Es el documento físico que respalda la entrega de la carga.
function ManifiestoDoc({ mf, who }: { mf: Manifiesto; who: string }) {
  return (
    <div className="manifiesto-doc">
      <h4>RENOVACELL</h4>
      <div className="mf-sub">Manifiesto de carga · hoja de salida</div>
      <div className="mf-meta">
        <span>Chofer: <b>{mf.chofer}</b></span>
        <span>Pedidos: <b>{mf.paradas.length}</b></span>
        <span>Piezas: <b>{mf.totalPiezas}</b></span>
        <span>Fecha: <b>{fmtDate(new Date().toISOString())}</b></span>
      </div>
      <table>
        <thead><tr><th>#</th><th>Pedido</th><th>Cliente</th><th>Dirección</th><th>Tel.</th><th>Pzas</th></tr></thead>
        <tbody>
          {mf.paradas.map((p, i) => (
            <tr key={p.shipmentId}>
              <td>{i + 1}</td>
              <td>{p.folio}</td>
              <td>{p.cliente}</td>
              <td>{p.direccion}</td>
              <td>{p.telefono}</td>
              <td>{p.piezas}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mf-firma">
        <div>Entregó ({who})</div>
        <div>Recibió (chofer: {mf.chofer})</div>
      </div>
      <div className="mf-foot">Documento interno de control de salida. No es un comprobante fiscal (CFDI).</div>
    </div>
  )
}
function ManifiestoPrint({ mf, who }: { mf: Manifiesto; who: string }) {
  return createPortal(<div className="manifiesto-print-root"><ManifiestoDoc mf={mf} who={who} /></div>, document.body)
}
