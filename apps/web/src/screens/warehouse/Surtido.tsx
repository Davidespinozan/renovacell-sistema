// Surtido (FEFO): toma un pedido pendiente del store compartido y lo surte
// asignando lotes por caducidad ascendente. Al confirmar, descuenta lotes,
// registra movimientos y mueve el pedido a Empacado (se ve en el Portal).
import { Vacio } from '../../app/EmptyState'
import { recargarInventario } from '../../data/store/lotsStore'
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { fmtDate, money } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { planSurtido, canFulfill, surtirPedido, mapaEnCustodia, type ItemPlan } from '../../data/ops/surtir'
import { useOpId } from '../../data/hooks/useOpId'
import { isSurtible } from '../../data/ops/seguimiento'
import { entregaDelPedido, esperaSalida, fechaCorta, salidaDePedido } from '../../data/ops/entrega'
import { useCorteEntrega } from '../../data/hooks/useCorteEntrega'
import { ListaDetalle } from '../../app/ListaDetalle'
import { capitalizarNombre } from '../../lib/nombres'
import { orderAddress } from '../../data/ops/shippingAddress'
import { hoyNegocio, sumarDias } from '../../data/periodo'
import { ProgramarSalida } from '../../app/ProgramarSalida'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { creditoAbierto, creditoVencido } from '../../data/ops/moneyView'
import type { ProductSafe } from '../../data/types'
import { cantidadVista, esMediaCaja } from '../../lib/cajas'
import { clienteDePedido } from '../../data/mock/profiles'   // el nombre del cliente junto al folio (Almacén lo pidió)
import { EntregaPill, ordenarPorSalida } from '../packing/Cola'   // HORA DE SALIDA (26 nov 2026): cuándo sale cada pedido, lo primero arriba
// SOBRE PEDIDO (26 nov 2026): el pedido se vendió sin existencia y espera mercancía.
const esSobrePedido = (o: { shipping_meta?: unknown }) => (((o.shipping_meta as { sobre_pedido?: unknown[] } | null)?.sobre_pedido) ?? []).length > 0

export function Surtido() {
  const { data: orders } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const [active, setActive] = useState<OrderWithItems | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchResult, setBatchResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const corte = useCorteEntrega()

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const pending = ordenarPorSalida(orders.filter((o) => isSurtible(o, byOrder[o.id])))
  // SALIDA PROGRAMADA · pagados que salen después de mañana: aún no se preparan (aparecen aquí un día antes).
  const manana = sumarDias(hoyNegocio(), 1)
  const programados = orders.filter((o) => (byOrder[o.id]?.liberado ?? o.payment_status === 'paid') && !['packed', 'shipped', 'delivered', 'fulfilled', 'cancelled'].includes(o.status ?? '')
    && esperaSalida(entregaDelPedido(o.shipping_meta), manana)).sort((a, b) => (entregaDelPedido(a.shipping_meta)?.salida ?? '') < (entregaDelPedido(b.shipping_meta)?.salida ?? '') ? -1 : 1)

  // ¿Cada pedido pendiente se puede surtir por COMPLETO con el stock actual? Solo
  // esos entran al surtido en lote (los que no, se abren uno a uno para ver el detalle).
  const fulfillable = useMemo(() => {
    const m: Record<string, boolean> = {}
    pending.forEach((o) => { m[o.id] = canFulfill(planSurtido(o, lots, mapaEnCustodia())) })
    return m
  }, [pending, lots])

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const selIds = pending.filter((o) => selected.has(o.id) && fulfillable[o.id]).map((o) => o.id)
  const selUnits = pending
    .filter((o) => selIds.includes(o.id))
    .reduce((sum, o) => sum + o.items.reduce((a, it) => a + it.qty, 0), 0)
  const allFulfillable = pending.filter((o) => fulfillable[o.id]).map((o) => o.id)

  const selectAll = () => setSelected(new Set(allFulfillable))
  const clearSel = () => setSelected(new Set())

  // Surte cada pedido seleccionado EN SECUENCIA, esperando la confirmación del servidor
  // de cada uno (W1: sin éxito optimista). Tras cada surtido se recarga el inventario, así
  // que el siguiente pedido re-planea contra el stock real. Un reintento de un pedido que
  // sí se aplicó lo rechaza el servidor (ya empacado): no hay doble descuento.
  const surtirLote = async () => {
    if (batchBusy) return
    setBatchBusy(true)
    let ok = 0, fail = 0
    const errors: string[] = []
    let primero = true
    for (const o of pending.filter((x) => selIds.includes(x.id))) {
      // AUDITORÍA · antes de planear el siguiente pedido se ESPERA el inventario real (antes se planeaba con el lote ya gastado)
      if (!primero) await recargarInventario().catch(() => {})
      primero = false
      const r = await surtirPedido(o)
      if (r.ok) ok += 1
      else { fail += 1; errors.push(`${o.external_ref ?? o.id}: ${r.error ?? 'no se pudo surtir'}`) }
    }
    setBatchResult({ ok, fail, errors })
    setSelected(new Set())
    setBatchBusy(false)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Preparar pedidos">
        Pedidos que ya se pagaron y están listos para preparar. Selecciona varios para
        surtirlos de una, o abre uno para ver de qué lote tomar cada producto (siempre el
        que caduca primero). Al confirmar se descuenta el inventario.
      </PageHead>

      {batchResult && (
        <div className="sysnote" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="check" />
          <span style={{ flex: 1 }}>
            Surtiste <b>{batchResult.ok}</b> {batchResult.ok === 1 ? 'pedido' : 'pedidos'}.{' '}
            {batchResult.fail > 0 && <span style={{ color: 'var(--warn)' }}>{batchResult.fail} no se pudieron surtir y quedaron pendientes.</span>}
            {batchResult.errors.map((e) => <span key={e} style={{ display: 'block', fontSize: 12, color: 'var(--danger)' }}>{e}</span>)}
          </span>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={() => setBatchResult(null)}><Icon name="x" /></button>
        </div>
      )}

      {selIds.length > 0 && (
        <div className="card" style={{ position: 'sticky', top: 74, zIndex: 5, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 18px', borderColor: 'var(--green-deep)' }}>
          <span style={{ fontWeight: 600 }}>{selIds.length} {selIds.length === 1 ? 'seleccionado' : 'seleccionados'}</span>
          <span className="mono" style={{ color: 'var(--ink-3)' }}>{selUnits} u</span>
          <button className="btn ghost sm" type="button" onClick={clearSel}>Limpiar</button>
          <button className="btn" type="button" style={{ marginLeft: 'auto' }} onClick={surtirLote} disabled={batchBusy}>
            <Icon name="layers" /> {batchBusy ? 'Surtiendo…' : 'Surtir seleccionados'}
          </button>
        </div>
      )}

      {pending.length === 0 ? (
        <Vacio icono="check" titulo="No hay pedidos por preparar." pista="Todo al día." />
      ) : (
        <>
          {allFulfillable.length > 1 && selIds.length === 0 && (
            <button className="btn ghost sm" type="button" style={{ alignSelf: 'flex-start' }} onClick={selectAll}>
              <Icon name="check" /> Seleccionar todos los surtibles ({allFulfillable.length})
            </button>
          )}
          {/* LISTA + DETALLE (27 nov 2026): antes era una tarjeta grande por pedido, con el mismo botón repetido. Ahora los
              pedidos van en renglones cortos y el elegido se abre al lado (en el celular, debajo de su renglón). La casilla
              para surtir varios de una vez sigue en cada renglón. */}
          <ListaDetalle
            testid="surtido" items={pending} clave={(o) => o.id}
            renglon={(o) => {
              const canDo = fulfillable[o.id]; const e = entregaDelPedido(o.shipping_meta); const sal = e ? salidaDePedido(e, hoyNegocio(), corte) : null
              const d = orderAddress(o.shipping_meta, null)
              const lugar = e?.tipo === 'recoge' || e?.tipo === 'mostrador' ? 'Recoge en sucursal' : [d?.city, d?.state].filter(Boolean).join(', ')
              return {
                titulo: capitalizarNombre(clienteDePedido(o).name) || clienteDePedido(o).name,
                sub: <><span className="mono">{o.external_ref}</span> · {o.items.length} producto{o.items.length === 1 ? '' : 's'}{lugar ? ` · ${lugar}` : ''}</>,
                nota: sal ? `${sal.etiqueta}${e?.paqueteria && e.tipo === 'foraneo' ? ` · ${e.texto}` : e?.tipo === 'local' ? ' · chofer' : ''}` : undefined,
                aviso: sal?.cuando === 'atrasado',
                pill: !canDo ? (esSobrePedido(o) ? { texto: 'Espera mercancía', clase: 'p-warn' } : { texto: 'Sin stock', clase: 'p-dang' }) : { texto: 'Por preparar', clase: 'p-warn' },
                antes: canDo ? <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Seleccionar ${o.external_ref}`} className="md-casilla" /> : <span className="md-casilla md-casilla--no" aria-hidden />,
              }
            }}
            detalle={(o) => {
              const canDo = fulfillable[o.id]
              return (
                <div className="hoy-detalle-cuerpo" data-testid={`surtido-detalle-${o.id}`}>
                  <div className="hoy-detalle-cab">
                    <div className="hoy-detalle-nombre" data-testid="surtido-cliente">{capitalizarNombre(clienteDePedido(o).name) || clienteDePedido(o).name}</div>
                    <div className="hoy-detalle-sub">
                      <span className="mono">{o.external_ref}</span>
                      {(() => {
                        // Un pedido liberado por CRÉDITO no está pagado: se surte, pero Almacén lo ve.
                        const d = byOrder[o.id]
                        if (!d || !creditoAbierto(d)) return null
                        return <span className={'pill ' + (creditoVencido(d) ? 'p-dang' : 'p-warn')} title={`Saldo ${d.saldo}`}>
                          {creditoVencido(d) ? 'Crédito vencido' : 'A crédito · sin pagar'}
                        </span>
                      })()}
                      {!canDo && (esSobrePedido(o) ? <span className="pill p-warn" data-testid="surtido-esperando">Esperando mercancía · sobre pedido</span> : <span className="pill p-dang">Sin stock suficiente</span>)}
                      {canDo && esSobrePedido(o) && <span className="pill p-ok" data-testid="surtido-ya-llego">Sobre pedido · ya llegó, se puede surtir</span>}
                      <span>Pedido el {fmtDate(o.created_at)}</span>
                    </div>
                  </div>
                  <EntregaPill e={entregaDelPedido(o.shipping_meta)} />
                  <div>
                    <h4>Productos a empacar</h4>
                    {o.items.map((it) => (
                      <div key={it.id} className="coitem">
                        <span>
                          {byId[it.product_id ?? '']?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{cantidadVista(byId[it.product_id ?? ''], it.qty)}</span>{/* CAJAS-MEDIOS */}
                        </span>
                        <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="hoy-detalle-accion">
                    <button className="btn" type="button" onClick={() => setActive(o)} data-testid={`surtido-preparar-${o.id}`}>
                      <Icon name="layers" /> Preparar este pedido
                    </button>
                  </div>
                </div>
              )
            }}
          />
        </>
      )}

      {programados.length > 0 && (
        <div className="card" data-testid="surtido-programados">
          <div className="eyebrow" style={{ margin: '0 0 8px' }}>Agendados para salir más adelante ({programados.length})</div>
          {programados.map((o) => {
            const e = entregaDelPedido(o.shipping_meta)
            return (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 13 }} data-testid="surtido-programado">
                <span className="mono">{o.external_ref}</span>
                <b>{clienteDePedido(o).name}</b>
                <span style={{ flex: 1, color: 'var(--ink-3)' }}>{o.items.reduce((n, it) => n + it.qty, 0)} pzas · se prepara el {fechaCorta(sumarDias(e?.salida ?? manana, -1))}</span>
                <b>Sale el {fechaCorta(e?.salida)}</b>
                <ProgramarSalida orderId={o.id} folio={o.external_ref} entrega={e} />
              </div>
            )
          })}
        </div>
      )}

      {active && <SurtirModal order={active} productsById={byId} onClose={() => setActive(null)} />}
    </div>
  )
}

export function SurtirModal({
  order, productsById, onClose,
}: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  onClose: () => void
}) {
  const { data: lots } = useLots()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { opId } = useOpId() // misma intención ⇒ mismo op_id en cada reintento

  const plans = useMemo(() => planSurtido(order, lots, mapaEnCustodia()), [order, lots])
  const ok = canFulfill(plans)

  const confirm = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    const res = await surtirPedido(order, opId)
    setBusy(false)
    if (res.ok) setDone(true)
    else setErr(res.error ?? 'No se pudo surtir el pedido.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div className="mbody">
            <div className="success">
              <div className="ck"><Icon name="check" /></div>
              <h3>Pedido surtido</h3>
              <p>
                <b>{order.external_ref}</b> quedó <b>preparado</b>. Ya se descontó del inventario
                y quedó registrado de dónde salió cada producto. El doctor ya lo ve en su seguimiento.
              </p>
              <button className="btn" type="button" style={{ marginTop: 16 }} onClick={onClose}>Listo</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mhead">
              <div>
                <h3>Preparar {order.external_ref} · {clienteDePedido(order).name}</h3>
                <div className="ms">Toma cada producto del lote que te indicamos (el que caduca primero).</div>
              </div>
              <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
            </div>
            <div className="mbody">
              {plans.map((p) => (
                <ItemPlanRow key={p.item.id} plan={p} name={productsById[p.item.product_id ?? '']?.name ?? 'Producto'} producto={productsById[p.item.product_id ?? '']} />
              ))}

              {!ok && (
                <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 12 }}>
                  <Icon name="x" />
                  <span>No alcanza el inventario para todos los productos de este pedido. Registra una entrada o ajusta el pedido.</span>
                </div>
              )}

              {err && (
                <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 12 }}>
                  <Icon name="x" /><span>{err}</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
                <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
                <button className="btn" type="button" onClick={confirm} disabled={!ok || busy} style={!ok || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                  <Icon name="check" /> {busy ? 'Confirmando…' : err ? 'Reintentar' : 'Confirmar y descontar'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// CAJAS-MEDIOS: cantidades por línea en cajas con medios para los de media caja (interno sin cambios).
function ItemPlanRow({ plan, name, producto }: { plan: ItemPlan; name: string; producto?: ProductSafe }) {
  const mc = esMediaCaja(producto)
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{name} <span style={{ color: 'var(--ink-3)' }}>×{cantidadVista(producto, plan.item.qty)}</span></span>
        {plan.shortfall > 0 && <span className="pill p-dang" style={{ marginLeft: 'auto' }}>Faltan {mc ? cantidadVista(producto, plan.shortfall) : `${plan.shortfall} ${plan.shortfall === 1 ? 'pieza' : 'piezas'}`}</span>}
      </div>
      <div className="tbl-scroll">
        <table className="tbl-cards">
          <thead>
            <tr><th>De qué lote tomar</th><th>Caduca</th><th>Cuántas</th></tr>
          </thead>
          <tbody>
            {plan.allocations.map((a, i) => (
              <tr key={a.lot.id}>
                <td data-label="De qué lote tomar">
                  <span className="lc">{a.lot.lot_code}</span>
                  {i === 0 && <span className="fefo" style={{ marginLeft: 8 }}><Icon name="check" /> Usar primero</span>}
                </td>
                <td data-label="Caduca">{fmtDate(a.lot.expiry_date ?? '')}</td>
                <td data-label="Cuántas" className="mono">{mc ? cantidadVista(producto, a.qty) : `${a.qty} ${a.qty === 1 ? 'pza' : 'pzas'}`}</td>
              </tr>
            ))}
            {plan.allocations.length === 0 && (
              <tr><td colSpan={3} style={{ color: 'var(--danger)' }}>Sin stock disponible</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
