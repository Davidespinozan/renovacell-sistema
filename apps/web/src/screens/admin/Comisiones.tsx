// COMERCIAL · Metas y comisiones de vendedor (solo Dirección). Toma las ventas del mes
// atribuidas a cada vendedor (POS / venta directa / eventos por shipping_meta.seller, y
// pedidos levantados por shipping_meta.placed_by), las compara contra su META (editable)
// y calcula la COMISIÓN con la tasa del equipo (editable). Números reales de los pedidos.
import React, { useMemo, useState } from 'react'
import { Target, Percent, Trophy } from 'lucide-react'
import { money } from '../../lib/format'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useTeam } from '../../data/hooks/useTeam'
import { useMetas } from '../../data/hooks/useMetas'
import { isSale } from '../../data/metrics'

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const localYM = (iso: string): string => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function Comisiones() {
  const { data: orders } = useAllOrders()
  const { data: team } = useTeam()
  const { targetFor, globalRate, setTarget, setGlobalRate } = useMetas()

  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const rate = globalRate()

  const sellers = useMemo(() => team.filter((u) => u.role === 'pos' && u.active), [team])

  // Atribución de la venta a un vendedor: email de shipping_meta.seller (POS/venta directa/
  // eventos) o, si el pedido lo levantó un vendedor, por coincidencia de nombre en placed_by.
  const sellerOf = (o: OrderWithItems): string | null => {
    const meta = (o.shipping_meta ?? {}) as { seller?: string | null; placed_by?: string | null }
    if (meta.seller) return meta.seller
    if (meta.placed_by) return sellers.find((s) => meta.placed_by!.startsWith(s.name))?.email ?? null
    return null
  }

  const { agg, sinVend } = useMemo(() => {
    const a: Record<string, { total: number; count: number }> = {}
    const sin = { total: 0, count: 0 }
    orders.filter(isSale).filter((o) => localYM(o.created_at) === ym).forEach((o) => {
      const s = sellerOf(o)
      if (s) { (a[s] ??= { total: 0, count: 0 }); a[s].total += o.total ?? 0; a[s].count += 1 }
      else { sin.total += o.total ?? 0; sin.count += 1 }
    })
    return { agg: a, sinVend: sin }
  }, [orders, ym, sellers])

  // Filas: todos los vendedores activos + cualquier email con ventas que no esté en el equipo.
  const emails = useMemo(() => {
    const set = new Set<string>(sellers.map((s) => s.email))
    Object.keys(agg).forEach((e) => set.add(e))
    return [...set]
  }, [sellers, agg])

  const rows = useMemo(() => emails.map((email) => {
    const nombre = sellers.find((s) => s.email === email)?.name ?? email
    const ventas = agg[email]?.total ?? 0
    const pedidos = agg[email]?.count ?? 0
    const meta = targetFor(email)
    const avance = meta > 0 ? (ventas / meta) * 100 : 0
    const comision = ventas * rate
    return { email, nombre, ventas, pedidos, meta, avance, comision }
  }).sort((a, b) => b.ventas - a.ventas), [emails, agg, sellers, rate, targetFor])

  const totVentas = rows.reduce((s, r) => s + r.ventas, 0)
  const totComision = rows.reduce((s, r) => s + r.comision, 0)

  const editarTasa = () => {
    const raw = window.prompt('Tasa de comisión del equipo (%). Ej. 5 = 5%', String((rate * 100).toFixed(2)))
    if (raw == null) return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) setGlobalRate(n / 100)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Comercial · Metas y comisiones</div>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{MONTHS[now.getMonth()]} {now.getFullYear()}</span>
        <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={editarTasa}>
          <Percent size={14} /> Comisión: {(rate * 100).toFixed(1)}%
        </button>
      </div>

      <div className="grid sigs">
        <div className="card sig"><div className="chip"><Target size={18} /></div><div className="v">{money(totVentas)}</div><div className="k">Ventas del mes</div><div className="s">atribuidas a vendedores</div></div>
        <div className="card sig"><div className="chip"><Percent size={18} /></div><div className="v">{money(totComision)}</div><div className="k">Comisiones</div><div className="s">a pagar del mes</div></div>
        <div className="card sig"><div className="chip"><Trophy size={18} /></div><div className="v">{rows[0]?.nombre?.split('·')[0].trim() ?? '—'}</div><div className="k">Líder del mes</div><div className="s">{rows[0] ? money(rows[0].ventas) : 'sin ventas'}</div></div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px 6px' }}><div className="eyebrow" style={{ margin: 0 }}>Por vendedor</div></div>
        <div style={{ padding: '0 14px 10px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Vendedor</th><th>Ventas</th><th>Pedidos</th><th>Meta</th><th>Avance</th><th>Comisión</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <MetaRow key={r.email} row={r} onSetMeta={(v) => setTarget(r.email, v)} />
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>Sin vendedores activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {sinVend.count > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--ink-3)' }}>Ventas sin vendedor (mostrador / autoservicio del doctor):</span>
          <b className="mono">{money(sinVend.total)}</b>
          <span style={{ color: 'var(--ink-3)' }}>· {sinVend.count} pedido(s) · no generan comisión</span>
        </div>
      )}
    </div>
  )
}

interface Row { email: string; nombre: string; ventas: number; pedidos: number; meta: number; avance: number; comision: number }

function MetaRow({ row, onSetMeta }: { row: Row; onSetMeta: (v: number) => void }) {
  const [val, setVal] = useState(String(row.meta || ''))
  const save = () => { const n = Number(val.trim()); if (Number.isFinite(n)) onSetMeta(n) }
  const pct = Math.min(100, Math.round(row.avance))
  const ok = row.meta > 0 && row.ventas >= row.meta
  return (
    <tr>
      <td data-label="Vendedor">{row.nombre}</td>
      <td data-label="Ventas" className="mono">{money(row.ventas)}</td>
      <td data-label="Pedidos" className="mono">{row.pedidos}</td>
      <td data-label="Meta">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--ink-3)' }}>$</span>
          <input value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} inputMode="numeric"
            placeholder="0" style={{ width: 92, padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
        </span>
      </td>
      <td data-label="Avance">
        {row.meta > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
            <span style={{ flex: 1, height: 7, borderRadius: 5, background: 'var(--line)', overflow: 'hidden', minWidth: 64, display: 'inline-block' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: ok ? 'var(--grad-green)' : 'var(--green-soft)' }} />
            </span>
            <span className="mono" style={{ fontSize: 12, color: ok ? 'var(--green-deep)' : 'var(--ink-3)' }}>{Math.round(row.avance)}%</span>
          </span>
        ) : <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>sin meta</span>}
      </td>
      <td data-label="Comisión" className="mono"><b>{money(row.comision)}</b></td>
    </tr>
  )
}
