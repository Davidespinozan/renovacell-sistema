// ALMACÉN · ENTREGAR VARIOS AL CHOFER (27 nov 2026): los pedidos locales que salen a la misma hora se entregan al chofer
// de una vez. Cada pedido hace los mismos tres pasos que «Entregar al chofer» (asignar → dar salida → En camino).
import React, { useState } from 'react'
import { Hoja } from '../../app/Hoja'
import { useShipments } from '../../data/hooks/useShipments'
import { markShipped } from '../../data/store/ordersStore'
import { getDrivers } from '../../data/mock/shipments'
import { choferSugerido, entregarLoteAlChofer, leerUltimoChofer, recordarChofer, type ResultadoLote } from '../../data/ops/entregarChofer'
import { estimadaDe } from '../../data/ops/entrega'
import { entregaDe } from '../packing/Cola'
import { capitalizarNombre } from '../../lib/nombres'
import type { OrderWithItems } from '../../data/hooks/useOrders'

const nombreDe = (o: OrderWithItems) => capitalizarNombre(((o.shipping_meta ?? {}) as { customer?: { name?: string } | null }).customer?.name) || 'Cliente'

export function EntregarLote({ pedidos, salida, quien, onCerrar }: { pedidos: OrderWithItems[]; salida: string; quien: string; onCerrar: () => void }) {
  const { createShipment, dispatchShipment } = useShipments()
  const choferes = getDrivers()
  const [choferId, setChoferId] = useState(() => choferSugerido(choferes, leerUltimoChofer()))
  const [avance, setAvance] = useState<number | null>(null)     // null = todavía no empieza
  const [resultado, setResultado] = useState<ResultadoLote | null>(null)
  const chofer = choferes.find((c) => c.id === choferId)
  const n = pedidos.length
  const ocupado = avance != null && !resultado

  const entregar = async () => {
    if (!chofer || ocupado) return
    setAvance(0)
    const r = await entregarLoteAlChofer(pedidos.map((o) => ({ id: o.id, folio: o.external_ref ?? o.id })), chofer.id, {
      asignar: async (pedidoId, id) => {
        const o = pedidos.find((x) => x.id === pedidoId)!
        const c = await createShipment({ order_id: pedidoId, carrier: null, tracking_number: null, driver_id: id, estimated_delivery_at: estimadaDe(entregaDe(o)) ?? new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'por_despachar' })
        return c.ok ? { ok: true, envioId: c.shipment.id } : { ok: false, error: c.error }
      },
      darSalida: (envioId, folio) => dispatchShipment(envioId, quien, folio),
      enCamino: (pedidoId, id) => markShipped(pedidoId, { method: 'chofer', driver: chofer.name, driver_id: id }),
    }, setAvance)
    recordarChofer(chofer.id)
    setResultado(r)
  }

  const pie = resultado
    ? <button type="button" className="btn" onClick={onCerrar} data-testid="lote-listo">Listo</button>
    : <button type="button" className="btn" disabled={!chofer || ocupado} style={!chofer ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => void entregar()} data-testid="lote-entregar">{ocupado ? `Entregando ${Math.min((avance ?? 0) + 1, n)} de ${n}…` : chofer ? `Entregar los ${n} a ${chofer.name.split(' ')[0]}` : `Entregar los ${n}`}</button>

  return (
    <Hoja abierta onCerrar={ocupado ? () => {} : onCerrar} titulo={`Entregar ${n} pedidos al chofer`} pie={pie} testid="lote-hoja">
      <div className="elote" data-testid="lote">
        <div className="elote-salida">{salida}</div>
        {!resultado && (
          <label className="elote-campo">
            <span>Chofer</span>
            <select value={choferId} onChange={(e) => setChoferId(e.target.value)} disabled={ocupado} data-testid="lote-chofer">
              <option value="">Elige al chofer…</option>
              {choferes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {!resultado && !chofer && <div className="elote-falta" role="status" data-testid="lote-falta">Falta elegir al chofer.</div>}
        <ul className="elote-lista">
          {pedidos.map((o) => {
            const falla = resultado?.fallas.find((f) => f.id === o.id)
            const hecho = resultado?.entregados.includes(o.id)
            return (
              <li key={o.id} data-testid={`lote-pedido-${o.id}`}>
                <span className="elote-nombre">{nombreDe(o)} <span className="mono">{o.external_ref}</span></span>
                {hecho && <span className="pill p-ok">En camino</span>}
                {falla && <span className="elote-error" role="alert">{falla.mensaje}</span>}
              </li>
            )
          })}
        </ul>
        {!resultado && <div className="elote-nota">Se asignan y salen ahora: cada pedido pasa a «En camino» y el chofer lo ve en su ruta.</div>}
        {resultado && (
          <div className={'elote-resultado' + (resultado.fallas.length ? ' elote-resultado--falla' : '')} role="status" data-testid="lote-resultado">
            {resultado.fallas.length === 0
              ? `Los ${n} pedidos ya van En camino con ${chofer?.name.split(' ')[0] ?? 'el chofer'}.`
              : `${resultado.entregados.length} de ${n} quedaron En camino. ${resultado.fallas.length === 1 ? 'El que falló sigue' : 'Los que fallaron siguen'} en la fila para intentarlo de nuevo.`}
          </div>
        )}
      </div>
    </Hoja>
  )
}
