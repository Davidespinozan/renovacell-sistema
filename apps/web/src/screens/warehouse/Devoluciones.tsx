// ALMACÉN · Devoluciones y reingresos (W1 · D-02 / D-03).
//  1) Reingresos por confirmar: pedidos EMPACADOS que Dirección canceló. El inventario no
//     reaparece hasta que Almacén confirma el reacomodo físico (una sola vez, a los lotes
//     que realmente salieron). Lo dañado o caducado queda para que Dirección lo disponga.
//  2) Recibir devolución: producto que regresó de un pedido ENVIADO/ENTREGADO. Se inspecciona
//     y se registra; NO vuelve a stock hasta que Dirección decide VENDIBLE o MERMA. El tope
//     por lote es lo que realmente salió en el pedido (lo impone el servidor).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { hasSupabase } from '../../lib/supabase'
import { useStockReturns } from '../../data/hooks/useStockReturns'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useOpId } from '../../data/hooks/useOpId'
import {
  pendingReingresos, pendingDisposicion, returnableForOrder, recibirDevolucion, confirmarReingreso,
  type StockReturn, type Returnable,
} from '../../data/store/stockReturnsStore'

const fld: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: 'var(--cp-surface)' }
const errBox: React.CSSProperties = { background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }

function useNames() {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { data: orders } = useAllOrders()
  return useMemo(() => {
    const prod = new Map(products.map((p) => [p.id, p.name]))
    const lot = new Map(lots.map((l) => [l.id, l]))
    const ord = new Map(orders.map((o) => [o.id, o]))
    return { prod, lot, ord, orders }
  }, [products, lots, orders])
}

export function Devoluciones() {
  const { data: returns, loading } = useStockReturns()
  const names = useNames()
  const reingresos = pendingReingresos(returns)
  const porDisponer = pendingDisposicion(returns)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Devoluciones y reingresos">
        Aquí se registra el producto que <b>regresa físicamente</b> al almacén. Nada vuelve al inventario vendible
        sin revisarlo: los reingresos de cancelaciones se confirman aquí y las devoluciones las dispone Dirección.
      </PageHead>
      {!hasSupabase && <div className="sysnote"><span>Disponible con el sistema conectado.</span></div>}

      <div className="card">
        <div className="eyebrow">Reingresos por confirmar · pedidos empacados cancelados</div>
        {loading ? <div style={{ color: 'var(--ink-3)' }}>Cargando…</div>
          : reingresos.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>No hay reingresos pendientes.</div>
          : reingresos.map((r) => <ReingresoCard key={r.id} ret={r} names={names} />)}
      </div>

      <RecibirDevolucion names={names} />

      <div className="card">
        <div className="eyebrow">En revisión de Dirección</div>
        {porDisponer.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>Nada pendiente.</div> : (
          <table className="tbl-cards">
            <thead><tr><th>Pedido</th><th>Producto</th><th>Lote</th><th>Cant.</th><th>Inspección</th></tr></thead>
            <tbody>
              {porDisponer.map(({ ret, line }) => (
                <tr key={line.id}>
                  <td data-label="Pedido">{names.ord.get(ret.order_id)?.external_ref ?? ret.order_id.slice(0, 8)}</td>
                  <td data-label="Producto">{names.prod.get(line.product_id) ?? 'Producto'}</td>
                  <td data-label="Lote" className="mono">{names.lot.get(line.lot_id)?.lot_code ?? '—'}</td>
                  <td data-label="Cant." className="mono">{line.qty}</td>
                  <td data-label="Inspección">{line.inspection}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ReingresoCard({ ret, names }: { ret: StockReturn; names: ReturnType<typeof useNames> }) {
  const pend = ret.lines.filter((l) => l.inspection === null)
  const [estado, setEstado] = useState<Record<string, 'ok' | 'dañado'>>(() => Object.fromEntries(pend.map((l) => [l.id, 'ok'])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { opId } = useOpId()
  const folio = names.ord.get(ret.order_id)?.external_ref ?? ret.order_id.slice(0, 8)

  const confirmar = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await confirmarReingreso(opId, ret.id, pend.map((l) => ({ line_id: l.id, estado: estado[l.id] ?? 'ok' })))
    setBusy(false)
    if (!r.ok) setErr(r.error)
  }

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{folio} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)' }}>· {ret.notes ?? 'cancelado'}</span></div>
      {pend.map((l) => {
        const lot = names.lot.get(l.lot_id)
        return (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 160 }}>{names.prod.get(l.product_id) ?? 'Producto'} · <span className="mono">{lot?.lot_code ?? '—'}</span> · <b>{l.qty} u</b></span>
            <div className="seg">
              <button type="button" className={estado[l.id] === 'ok' ? 'active' : undefined} onClick={() => setEstado((e) => ({ ...e, [l.id]: 'ok' }))}>Reacomodado OK</button>
              <button type="button" className={estado[l.id] === 'dañado' ? 'active' : undefined} onClick={() => setEstado((e) => ({ ...e, [l.id]: 'dañado' }))}>Dañado</button>
            </div>
          </div>
        )
      })}
      {err && <div className="sysnote" role="alert" style={errBox}><span>{err}</span></div>}
      <div style={{ textAlign: 'right', marginTop: 8 }}>
        <button className="btn sm" type="button" disabled={busy} onClick={confirmar}>
          <Icon name="check" /> {busy ? 'Confirmando…' : err ? 'Reintentar' : 'Confirmar reacomodo'}
        </button>
      </div>
    </div>
  )
}

function RecibirDevolucion({ names }: { names: ReturnType<typeof useNames> }) {
  const [folio, setFolio] = useState('')
  const [order, setOrder] = useState<OrderWithItems | null>(null)
  const [rows, setRows] = useState<Returnable[] | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [insp, setInsp] = useState<Record<string, 'ok' | 'dañado'>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const { opId, renew } = useOpId()

  const buscar = async () => {
    setErr(null); setDone(null); setRows(null)
    const f = folio.trim().toLowerCase()
    const o = names.orders.find((x) => (x.external_ref ?? '').toLowerCase() === f)
    if (!o) { setErr('No se encontró un pedido con ese folio.'); return }
    if (!['shipped', 'delivered', 'fulfilled'].includes(o.status ?? '')) {
      setErr(o.status === 'packed' ? 'Ese pedido no ha salido: si se cancela, el reingreso se confirma arriba.' : 'Ese pedido no admite devolución (no ha salido o está cancelado).')
      return
    }
    if (order?.id !== o.id) renew() // otro pedido = intención nueva
    setOrder(o)
    const rs = await returnableForOrder(o.id)
    setRows(rs); setQty({}); setInsp(Object.fromEntries(rs.map((r) => [r.lot_id, 'ok'])))
  }

  const lines = (rows ?? []).filter((r) => (qty[r.lot_id] ?? 0) > 0)
    .map((r) => ({ lot_id: r.lot_id, qty: qty[r.lot_id], inspection: insp[r.lot_id] ?? 'ok' as const }))
  const valid = !!order && lines.length > 0 && lines.every((l) => l.qty <= ((rows ?? []).find((r) => r.lot_id === l.lot_id)?.disponible ?? 0))

  const registrar = async () => {
    if (!valid || busy || !order) return
    setBusy(true); setErr(null)
    const r = await recibirDevolucion(opId, order.id, lines, notes.trim() || null)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    renew()
    setDone(`Devolución de ${order.external_ref} registrada. Dirección decidirá si regresa a venta o va a merma.`)
    setOrder(null); setRows(null); setFolio(''); setNotes('')
  }

  return (
    <div className="card">
      <div className="eyebrow">Recibir devolución · pedido enviado o entregado</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={fld} value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Folio del pedido (p. ej. S123456 o POS-…)" onKeyDown={(e) => { if (e.key === 'Enter') void buscar() }} />
        <button className="btn ghost sm" type="button" onClick={() => void buscar()} disabled={!folio.trim()}>Buscar</button>
      </div>
      {done && <div className="sysnote" style={{ marginTop: 10 }}><Icon name="check" /><span>{done}</span></div>}
      {order && rows && (
        <div style={{ marginTop: 12 }}>
          {rows.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>No hay salidas registradas para ese pedido.</div> : (
            <table className="tbl-cards">
              <thead><tr><th>Producto / lote</th><th>Salió</th><th>Ya devuelto</th><th>Regresa</th><th>Estado</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const lot = names.lot.get(r.lot_id)
                  return (
                    <tr key={r.lot_id}>
                      <td data-label="Producto / lote">{names.prod.get(lot?.product_id ?? '') ?? 'Producto'} · <span className="mono">{lot?.lot_code ?? '—'}</span></td>
                      <td data-label="Salió" className="mono">{r.salido}</td>
                      <td data-label="Ya devuelto" className="mono">{r.devuelto}</td>
                      <td data-label="Regresa">
                        <input type="number" min={0} max={r.disponible} disabled={r.disponible === 0} style={{ ...fld, maxWidth: 90 }}
                          value={qty[r.lot_id] ?? 0} onChange={(e) => setQty((q) => ({ ...q, [r.lot_id]: Math.max(0, Math.min(r.disponible, Math.floor(Number(e.target.value) || 0))) }))} />
                      </td>
                      <td data-label="Estado">
                        <select style={{ ...fld, maxWidth: 130 }} value={insp[r.lot_id] ?? 'ok'} onChange={(e) => setInsp((s) => ({ ...s, [r.lot_id]: e.target.value as 'ok' | 'dañado' }))}>
                          <option value="ok">Buen estado</option>
                          <option value="dañado">Dañado</option>
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <input style={{ ...fld, marginTop: 10 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional): motivo, quién lo trajo…" />
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>Si el lote ya caducó, el sistema lo clasifica como caducado (solo puede ir a merma). Registrar una devolución no genera reembolso.</div>
        </div>
      )}
      {err && <div className="sysnote" role="alert" style={errBox}><span>{err}</span></div>}
      {order && (
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <button className="btn sm" type="button" disabled={!valid || busy} onClick={registrar} style={!valid || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            {busy ? 'Registrando…' : err ? 'Reintentar' : 'Registrar devolución'}
          </button>
        </div>
      )}
    </div>
  )
}
