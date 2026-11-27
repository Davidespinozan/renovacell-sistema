// MODIFICAR PEDIDO (27 nov 2026, dueño: «hay que poder hacer modificaciones, agregar productos, etc., cuando el producto
// aún no ha salido a almacén»). Cambiar cantidades, quitar y agregar productos; el servidor pone precios, envío y total.
import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { money } from '../lib/format'
import { aInterno, aVista, cantidadVista, pasoVista } from '../lib/cajas'
import { useProducts, isActiveProduct } from '../data/hooks/useProducts'
import { modificarPedido, pedidoModificable, type RenglonEdicion, type ResultadoModificacion } from '../data/ops/modificarPedido'
import { reloadOrders } from '../data/store/ordersStore'
import type { OrderWithItems } from '../data/hooks/useOrders'

const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function BotonModificarPedido({ order, className = 'btn ghost sm', modificar = modificarPedido }: { order: OrderWithItems; className?: string; modificar?: typeof modificarPedido }) {
  const [abierto, setAbierto] = useState(false)
  const [hecho, setHecho] = useState<ResultadoModificacion | null>(null)
  if (!pedidoModificable(order)) return null
  return (
    <>
      <button className={className} type="button" onClick={() => { setHecho(null); setAbierto(true) }} data-testid="modificar-pedido-abrir"><Icon name="edit" style={{ width: 13, height: 13 }} /> Modificar pedido</button>
      {hecho && <div className="sysnote" role="status" style={{ marginTop: 8, background: 'var(--ok-bg)', color: 'var(--green-deep)' }} data-testid="modificar-pedido-hecho">
        <span>Pedido modificado. Total {money(hecho.total_antes)} → <b>{money(hecho.total)}</b>{hecho.envio !== hecho.envio_antes ? ` · envío ${money(hecho.envio_antes)} → ${money(hecho.envio)}` : ''}.{hecho.estado_pago && hecho.estado_pago !== 'paid' && order.payment_status === 'paid' ? ' Ahora tiene saldo por cobrar: Almacén no lo prepara hasta cubrirlo.' : ''}</span>
      </div>}
      {abierto && createPortal(<Editor order={order} modificar={modificar} onClose={() => setAbierto(false)} onHecho={(r) => { setAbierto(false); setHecho(r); reloadOrders() }} />, document.body)}
    </>
  )
}

function Editor({ order, modificar, onClose, onHecho }: { order: OrderWithItems; modificar: typeof modificarPedido; onClose: () => void; onHecho: (r: ResultadoModificacion) => void }) {
  const { data: productos } = useProducts()
  const porId = useMemo(() => Object.fromEntries(productos.map((p) => [p.id, p])), [productos])
  const inicial = useMemo(() => {
    const m = new Map<string, number>()
    order.items.filter((i) => i.unit_price != null && i.product_id).forEach((i) => m.set(i.product_id!, (m.get(i.product_id!) ?? 0) + i.qty))
    return [...m.entries()].map(([product_id, qty]) => ({ product_id, qty }))
  }, [order])
  const precioAntes = useMemo(() => Object.fromEntries(order.items.filter((i) => i.product_id && i.unit_price != null).map((i) => [i.product_id!, i.unit_price!])), [order])
  const [lineas, setLineas] = useState<RenglonEdicion[]>(inicial)
  const [busca, setBusca] = useState('')
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const poner = (pid: string, qty: number) => { setErr(null); setLineas((ls) => (ls.some((l) => l.product_id === pid) ? ls.map((l) => (l.product_id === pid ? { ...l, qty: Math.max(0, qty) } : l)) : [...ls, { product_id: pid, qty: Math.max(0, qty) }])) }
  const quitar = (pid: string) => { setErr(null); setLineas((ls) => ls.filter((l) => l.product_id !== pid)) }
  const opciones = useMemo(() => {
    const w = plano(busca).split(/\s+/).filter(Boolean)
    if (!w.length) return []
    return productos.filter((p) => isActiveProduct(p) && p.sellable !== false && p.price != null && !lineas.some((l) => l.product_id === p.id))
      .filter((p) => { const t = plano(`${p.name} ${p.sku ?? ''}`); return w.every((x) => t.includes(x)) }).slice(0, 8)
  }, [busca, productos, lineas])
  const activas = lineas.filter((l) => l.qty > 0)
  const estimado = activas.reduce((s, l) => s + l.qty * (precioAntes[l.product_id] ?? porId[l.product_id]?.price ?? 0), 0)
  const cambio = JSON.stringify([...activas].sort((a, b) => a.product_id.localeCompare(b.product_id))) !== JSON.stringify([...inicial].sort((a, b) => a.product_id.localeCompare(b.product_id)))
  const guardar = async () => {
    if (busy) return
    if (!cambio) { setErr('No hay cambios que guardar.'); return }
    setBusy(true); setErr(null)
    const r = await modificar(order.id, activas, motivo)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onHecho(r.data)
  }
  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="modificar-pedido">
        <div className="mhead">
          <div><h3>Modificar pedido {order.external_ref}</h3><div className="ms">Se puede mientras no salga de Almacén. Los precios, el envío y el total los calcula el sistema.</div></div>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <div className="mod-lista">
            {lineas.map((l) => {
              const p = porId[l.product_id]
              const paso = pasoVista(p)
              return (
                <div key={l.product_id} className={'mod-fila' + (l.qty === 0 ? ' mod-fila--fuera' : '')} data-testid={`mod-fila-${l.product_id}`}>
                  <span className="mod-nombre">{p?.name ?? 'Producto'}{!inicial.some((x) => x.product_id === l.product_id) && <span className="pill p-blue" style={{ marginLeft: 6 }}>Nuevo</span>}</span>
                  <span className="mod-cant">
                    <button type="button" className="btn ghost sm" aria-label="Menos" onClick={() => poner(l.product_id, aInterno(p, Math.max(0, aVista(p, l.qty) - paso)))} data-testid="mod-menos">−</button>
                    <input inputMode="decimal" value={String(aVista(p, l.qty))} aria-label={`Cantidad de ${p?.name ?? 'producto'}`} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); if (Number.isFinite(v)) poner(l.product_id, aInterno(p, v)) }} data-testid="mod-cantidad" />
                    <button type="button" className="btn ghost sm" aria-label="Más" onClick={() => poner(l.product_id, aInterno(p, aVista(p, l.qty) + paso))} data-testid="mod-mas">+</button>
                  </span>
                  <span className="mod-cuanto mono">{l.qty > 0 ? cantidadVista(p, l.qty) : 'se quita'}</span>
                  <button type="button" className="btn ghost sm" onClick={() => quitar(l.product_id)} aria-label={`Quitar ${p?.name ?? 'producto'}`} data-testid="mod-quitar"><Icon name="trash" /></button>
                </div>
              )
            })}
          </div>
          <label className="mod-lbl" htmlFor="mod-buscar">Agregar producto</label>
          <input id="mod-buscar" className="mod-input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Busca por nombre o clave" data-testid="mod-buscar" />
          {opciones.length > 0 && <div className="mod-opciones">{opciones.map((p) => (
            <button key={p.id} type="button" className="mod-opcion" onClick={() => { poner(p.id, aInterno(p, pasoVista(p) >= 1 ? 1 : pasoVista(p))); setBusca('') }} data-testid={`mod-agregar-${p.id}`}><span>{p.name}</span><span className="mono">{money(p.price ?? 0)}</span></button>
          ))}</div>}
          <div className="mod-total" data-testid="mod-estimado">Productos (aproximado): <b className="mono">{money(estimado)}</b> <span className="ms">· antes {money((order.total ?? 0) - Number((order as { shipping_cost?: number | null }).shipping_cost ?? 0))}</span></div>
          <label className="mod-lbl" htmlFor="mod-motivo">¿Por qué se modifica?</label>
          <input id="mod-motivo" className="mod-input" value={motivo} maxLength={300} onChange={(e) => { setMotivo(e.target.value); setErr(null) }} placeholder="Ej. el cliente agregó 2 cajas" data-testid="mod-motivo" />
          {err && <div className="sysnote" role="alert" style={{ marginTop: 12, background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }} data-testid="mod-error"><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={busy || !cambio || activas.length === 0 || motivo.trim().length < 3} onClick={() => void guardar()} data-testid="mod-guardar">{busy ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
