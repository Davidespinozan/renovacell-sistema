// PARA RECOGER (23 nov 2026, dueño: "que Blanca también marque entregado"). Pedidos que ya quedaron listos en sucursal
// («Recoge en sucursal» despachado): quien atiende el mostrador —Blanca o Alberto— lo marca entregado cuando el cliente
// pasa por él y anota quién lo recogió. Misma acción que «Entregado al cliente» de Seguimiento (entregarRecoge).
import React, { useState } from 'react'
import { Icon } from '../../app/icons'
import { Vacio } from '../../app/EmptyState'
import { fmtDate } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useShipments } from '../../data/hooks/useShipments'
import { useProducts } from '../../data/hooks/useProducts'
import { esRecoge, envioVigente } from '../../data/ops/seguimiento'
import { entregarRecoge } from '../../data/store/ordersStore'
import { clienteDePedido } from '../../data/mock/profiles'
import { cantidadVista } from '../../lib/cajas'
import { nombreSugerido } from '../../data/ops/rutaChofer'   // el nombre del cliente se toca en vez de escribirse

/** Listos para recoger: despachados como «recoge en sucursal», sin envío de paquetería ni chofer. */
export function paraRecoger(orders: OrderWithItems[], tieneEnvio: (id: string) => boolean): OrderWithItems[] {
  return orders.filter((o) => o.status === 'shipped' && esRecoge(o) && !tieneEnvio(o.id))
}

export function ParaRecoger() {
  const { data: orders } = useAllOrders()
  const { data: shipments } = useShipments()
  const { data: products } = useProducts()
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  const lista = paraRecoger(orders, (id) => !!envioVigente(shipments, id))
  return (
    <div className="grid" style={{ gap: 12 }} data-testid="para-recoger">
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Pedidos listos en sucursal. Cuando el cliente pase, entrégaselo y márcalo aquí con el nombre de quien lo recogió.</div>
      {lista.length === 0
        ? <Vacio icono="box" titulo="No hay pedidos esperando a que los recojan." />
        : lista.map((o) => <FilaRecoger key={o.id} o={o} nombreProducto={(id) => byId[id]?.name ?? 'Producto'} producto={(id) => byId[id]} />)}
    </div>
  )
}

// Exportada (27 nov 2026): la misma fila vive también en el Inicio de Almacén, para que quien recoge no quede escondido en una pestaña.
export function FilaRecoger({ o, nombreProducto, producto }: { o: OrderWithItems; nombreProducto: (id: string) => string; producto: (id: string) => Parameters<typeof cantidadVista>[0] }) {
  const [abierto, setAbierto] = useState(false)
  const [recogio, setRecogio] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cliente = clienteDePedido(o)
  const sugerido = nombreSugerido(cliente.name)
  const confirmar = async () => {
    if (!recogio.trim() || guardando) return
    setGuardando(true); setError(null)
    const r = await entregarRecoge(o.id, recogio.trim())
    setGuardando(false)
    if (!r.ok) setError(r.error ?? 'No se pudo marcar como entregado.')
  }
  return (
    <div className="card" data-testid="recoger-fila">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 14 }}>{o.external_ref}</span>
        <b style={{ fontSize: 14 }}>{cliente.name}</b>
        <span className="pill p-ok">Listo para recoger</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(o.created_at)}</span>
      </div>
      {o.items.map((it) => (
        <div key={it.id} className="coitem"><span>{nombreProducto(it.product_id ?? '')} <span style={{ color: 'var(--ink-3)' }}>×{cantidadVista(producto(it.product_id ?? ''), it.qty)}</span></span></div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        {abierto ? (
          <>
            <input value={recogio} onChange={(e) => setRecogio(e.target.value)} placeholder="¿Quién lo recogió?" aria-label="Quién lo recogió" autoFocus
              style={{ flex: 1, minWidth: 200, padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none', backgroundColor: 'var(--cp-surface)' }} data-testid="recoger-quien" />
            <button className="btn sm" type="button" disabled={!recogio.trim() || guardando} onClick={() => void confirmar()} data-testid="recoger-confirmar"><Icon name="check" /> {guardando ? 'Guardando…' : 'Confirmar entrega'}</button>
            <button className="btn ghost sm" type="button" onClick={() => setAbierto(false)}>Cancelar</button>
            {!recogio.trim() && sugerido && <button className="btn ghost sm" type="button" onClick={() => setRecogio(sugerido)} data-testid="recoger-sugerido">Lo recogió {sugerido}</button>}
          </>
        ) : (
          <button className="btn sm" type="button" onClick={() => setAbierto(true)} data-testid="recoger-entregar"><Icon name="check" /> Ya lo recogió</button>
        )}
      </div>
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}
