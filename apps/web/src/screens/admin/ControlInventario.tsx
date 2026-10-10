// DIRECCIÓN · Control de inventario (W1).
//  · Devoluciones por disponer: Dirección decide el destino de lo que Almacén recibió e
//    inspeccionó — VENDIBLE (regresa a su lote, solo si llegó en buen estado y vigente) o MERMA.
//  · Conciliación lote ↔ kardex: la existencia de cada lote debe ser la suma de sus
//    movimientos; también acumulados de compra, salidas por renglón, devoluciones ≤ surtido y
//    alertas (pago llegado tras cancelar). Errores esperados: 0.
//  · Bajas de almacén (D-06): mermas y ajustes negativos que Almacén aplica sin aprobación
//    previa, para revisión posterior de Dirección.
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { fmtDate } from '../../lib/format'
import { hasSupabase, supabase } from '../../lib/supabase'
import { useStockReturns } from '../../data/hooks/useStockReturns'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useOpId } from '../../data/hooks/useOpId'
import { w1Message } from '../../data/ops/w1Command'
import { pendingDisposicion, disponerDevolucion, type StockReturn, type StockReturnLine, type Disposition } from '../../data/store/stockReturnsStore'

type Tab = 'disp' | 'conc' | 'bajas'
interface ConcRow { check_id: string; severidad: 'error' | 'alerta' | 'info'; entidad: string; entidad_id: string; detalle: string | null; esperado: number | null; obtenido: number | null }
interface BajaRow { movement_id: string; created_at: string; actor_email: string | null; actor_role: string | null; motivo: string | null; tipo: string; sku: string; lote: string; cantidad: number }

const CHECK_LABEL: Record<string, string> = {
  C1_lote_kardex: 'Existencia del lote ≠ suma del kardex',
  C2_compra_acumulado: 'Acumulado de compra ≠ recepciones',
  C3_renglon_salidas: 'Renglón surtido sin sus salidas exactas',
  C4_disposicion_movimiento: 'Disposición sin su movimiento',
  C5_devuelto_excede: 'Devuelto mayor que lo surtido',
  C6_pendiente_fisico: 'Pendiente físico (reingreso / disposición)',
  C7_pago_tras_cancelar: 'Pago llegado tras cancelar (revisar reembolso)',
  C8_caducado_en_stock: 'Lote caducado con existencia',
  C9_baja_almacen: 'Baja de almacén (últimos 30 días)',
}

export function ControlInventario() {
  const [tab, setTab] = useState<Tab>('disp')
  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Control de inventario">
        Decide el destino de las devoluciones, concilia existencias contra el kardex y revisa las bajas que registró Almacén.
      </PageHead>
      {!hasSupabase && <div className="sysnote"><span>Disponible con el sistema conectado.</span></div>}
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={tab === 'disp' ? 'active' : undefined} onClick={() => setTab('disp')}>Devoluciones por disponer</button>
        <button type="button" className={tab === 'conc' ? 'active' : undefined} onClick={() => setTab('conc')}>Conciliación</button>
        <button type="button" className={tab === 'bajas' ? 'active' : undefined} onClick={() => setTab('bajas')}>Bajas de almacén</button>
      </div>
      {tab === 'disp' && <Disposicion />}
      {tab === 'conc' && <Conciliacion />}
      {tab === 'bajas' && <Bajas />}
    </div>
  )
}

function Disposicion() {
  const { data: returns, loading } = useStockReturns()
  const groups = useMemo(() => {
    const m = new Map<string, { ret: StockReturn; lines: StockReturnLine[] }>()
    pendingDisposicion(returns).forEach(({ ret, line }) => {
      const g = m.get(ret.id) ?? { ret, lines: [] }
      g.lines.push(line); m.set(ret.id, g)
    })
    return [...m.values()]
  }, [returns])
  if (loading) return <div className="card" style={{ color: 'var(--ink-3)' }}>Cargando…</div>
  if (groups.length === 0) return <div className="card" style={{ color: 'var(--ink-3)' }}>No hay devoluciones pendientes de disposición.</div>
  return <>{groups.map((g) => <DisposicionCard key={g.ret.id} ret={g.ret} lines={g.lines} />)}</>
}

function DisposicionCard({ ret, lines }: { ret: StockReturn; lines: StockReturnLine[] }) {
  const { data: orders } = useAllOrders()
  const { data: lots } = useLots()
  const { data: products } = useProducts()
  const [dest, setDest] = useState<Record<string, Disposition>>(() => Object.fromEntries(lines.map((l) => [l.id, l.inspection === 'ok' ? 'vendible' : 'merma'])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { opId } = useOpId()
  const folio = orders.find((o) => o.id === ret.order_id)?.external_ref ?? ret.order_id.slice(0, 8)

  const aplicar = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    const r = await disponerDevolucion(opId, lines.map((l) => ({ line_id: l.id, disposition: dest[l.id] })))
    setBusy(false)
    if (!r.ok) setErr(r.error)
  }

  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{folio} · {ret.origin === 'cancelacion' ? 'reingreso de cancelación' : 'devolución'} <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)' }}>{fmtDate(ret.created_at)}</span></div>
      {lines.map((l) => {
        const lot = lots.find((x) => x.id === l.lot_id)
        const puedeVender = l.inspection === 'ok'
        return (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 180 }}>
              {products.find((p) => p.id === l.product_id)?.name ?? 'Producto'} · <span className="mono">{lot?.lot_code ?? '—'}</span> · <b>{l.qty} u</b>
              <span className={'pill ' + (l.inspection === 'ok' ? 'p-ok' : 'p-dang')} style={{ marginLeft: 8, fontSize: 10.5 }}>{l.inspection}</span>
              {l.notes && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>{l.notes}</span>}
            </span>
            <div className="seg">
              <button type="button" disabled={!puedeVender} title={puedeVender ? undefined : 'Dañado o caducado: solo merma'} className={dest[l.id] === 'vendible' ? 'active' : undefined} onClick={() => setDest((d) => ({ ...d, [l.id]: 'vendible' }))}>Vendible</button>
              <button type="button" className={dest[l.id] === 'merma' ? 'active' : undefined} onClick={() => setDest((d) => ({ ...d, [l.id]: 'merma' }))}>Merma</button>
            </div>
          </div>
        )
      })}
      {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{err}</span></div>}
      <div style={{ textAlign: 'right', marginTop: 10 }}>
        <button className="btn sm" type="button" disabled={busy} onClick={aplicar}><Icon name="check" /> {busy ? 'Aplicando…' : err ? 'Reintentar' : 'Aplicar destino'}</button>
      </div>
    </div>
  )
}

function Conciliacion() {
  const [rows, setRows] = useState<ConcRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const correr = async () => {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('conciliar_inventario') as unknown as { data: ConcRow[] | null; error: { message: string } | null }
    setBusy(false)
    if (error) { setErr(w1Message(error.message)); return }
    setRows(data ?? [])
  }
  const errores = (rows ?? []).filter((r) => r.severidad === 'error')
  const otros = (rows ?? []).filter((r) => r.severidad !== 'error')
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Conciliación lote ↔ kardex</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} disabled={busy || !hasSupabase} onClick={() => void correr()}>{busy ? 'Conciliando…' : 'Conciliar ahora'}</button>
      </div>
      {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{err}</span></div>}
      {rows && (
        <div style={{ marginTop: 12 }}>
          <div className="sysnote" style={errores.length ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}>
            <Icon name={errores.length ? 'x' : 'check'} />
            <span>{errores.length === 0 ? '0 diferencias: la existencia de cada lote cuadra con su kardex.' : `${errores.length} diferencia(s) de inventario. Revísalas antes de operar.`}</span>
          </div>
          {[...errores, ...otros].length > 0 && (
            <table className="tbl-cards" style={{ marginTop: 10 }}>
              <thead><tr><th>Tipo</th><th>Detalle</th><th>Esperado</th><th>Obtenido</th></tr></thead>
              <tbody>
                {[...errores, ...otros].map((r, i) => (
                  <tr key={`${r.check_id}-${r.entidad_id}-${i}`}>
                    <td data-label="Tipo"><span className={'pill ' + (r.severidad === 'error' ? 'p-dang' : r.severidad === 'alerta' ? 'p-warn' : 'p-neu')}>{CHECK_LABEL[r.check_id] ?? r.check_id}</span></td>
                    <td data-label="Detalle">{r.detalle ?? '—'}</td>
                    <td data-label="Esperado" className="mono">{r.esperado ?? '—'}</td>
                    <td data-label="Obtenido" className="mono">{r.obtenido ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Bajas() {
  const [rows, setRows] = useState<BajaRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cargar = async () => {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('auditoria_bajas') as unknown as { data: BajaRow[] | null; error: { message: string } | null }
    setBusy(false)
    if (error) { setErr(w1Message(error.message)); return }
    setRows(data ?? [])
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Bajas de almacén · últimos 30 días</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} disabled={busy || !hasSupabase} onClick={() => void cargar()}>{busy ? 'Cargando…' : rows ? 'Actualizar' : 'Ver bajas'}</button>
      </div>
      {err && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 10 }}><span>{err}</span></div>}
      {rows && (rows.length === 0 ? <div style={{ color: 'var(--ink-3)', marginTop: 10 }}>Sin bajas en el periodo.</div> : (
        <table className="tbl-cards" style={{ marginTop: 10 }}>
          <thead><tr><th>Fecha</th><th>Quién</th><th>Tipo</th><th>SKU / lote</th><th>Cant.</th><th>Motivo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.movement_id}>
                <td data-label="Fecha">{fmtDate(r.created_at)}</td>
                <td data-label="Quién">{r.actor_email ?? '—'}{r.actor_role ? ` · ${r.actor_role}` : ''}</td>
                <td data-label="Tipo">{r.tipo}</td>
                <td data-label="SKU / lote" className="mono">{r.sku} · {r.lote}</td>
                <td data-label="Cant." className="mono">{r.cantidad}</td>
                <td data-label="Motivo">{r.motivo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}
