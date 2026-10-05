// COMERCIAL · Metas y comisiones de vendedor (solo Dirección).
//
// La comisión que aquí se muestra es una ESTIMACIÓN, no una liquidación ni una cifra
// "a pagar": el modelo de comisiones sigue pendiente de decisión de Dirección (D-15).
// La pantalla solo LEE: no congela tasas, no reconstruye vendedores, no aplica reversas
// y no escribe ningún movimiento de dinero. Toda la regla vive en `data/comisiones.ts`.
import React, { useMemo, useState } from 'react'
import { Target, Percent, Trophy, Receipt, Info } from 'lucide-react'
import { money } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useTeam } from '../../data/hooks/useTeam'
import { useMetas } from '../../data/hooks/useMetas'
import { usePaymentEntries } from '../../data/hooks/useMoney'
import { useRefunds } from '../../data/hooks/useFinanzas'
import { hasSupabase } from '../../lib/supabase'
import { entriesFromOrders } from '../../data/ops/moneyMock'
import { estimarComisiones, type LineaProducto } from '../../data/comisiones'
import { esteMes, mesPasado, diaNegocio, hoyNegocio } from '../../data/periodo'

export function Comisiones() {
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { data: team } = useTeam()
  const { data: asientos } = usePaymentEntries()
  const { data: refunds } = useRefunds()
  const { targetFor, lineRate, setTarget, setLineRate } = useMetas()

  // Periodo en MESES DEL NEGOCIO (America/Mazatlan), el mismo corte que los indicadores.
  const [cual, setCual] = useState<'mes' | 'pasado'>('mes')
  const hoy = hoyNegocio()
  const periodo = useMemo(() => (cual === 'pasado' ? mesPasado() : esteMes()), [cual, hoy]) // eslint-disable-line react-hooks/exhaustive-deps
  const rateCosm = lineRate('cosm')
  const rateProf = lineRate('prof')

  const sellers = useMemo(() => team.filter((u) => u.role === 'pos' && u.active), [team])
  // Línea de cada producto (Home Care 'cosm' / Professional 'prof') para la tasa por línea.
  const lineOf = useMemo(() => {
    const m: Record<string, LineaProducto> = {}
    products.forEach((p) => { m[p.id] = p.line === 'prof' ? 'prof' : 'cosm' })
    return m
  }, [products])

  const est = useMemo(() => estimarComisiones({
    orders,
    // Con backend, el cobrado sale del libro; en la demo se deriva de los pedidos pagados.
    entries: hasSupabase ? asientos : entriesFromOrders(orders, refunds, diaNegocio),
    vendedores: sellers.map((s) => ({ email: s.email, name: s.name })),
    lineaDe: (pid) => ((pid && lineOf[pid]) === 'prof' ? 'prof' : 'cosm'),
    tasaVigente: { cosm: rateCosm, prof: rateProf },
  }, periodo), [orders, asientos, refunds, sellers, lineOf, rateCosm, rateProf, periodo])

  const rows = useMemo(() => est.filas.map((f) => {
    const meta = targetFor(f.email)
    return { ...f, meta, avance: meta > 0 ? (f.vendido / meta) * 100 : 0 }
  }), [est, targetFor])
  const sinVend = est.sinVendedor

  const editarLinea = (line: 'cosm' | 'prof', actual: number) => {
    const label = line === 'prof' ? 'Professional' : 'Home Care'
    const raw = window.prompt(`Tasa VIGENTE de ${label} (%). Ej. 5 = 5%. Cambiarla recalcula la estimación de cualquier periodo: no hay tasas históricas guardadas.`, String((actual * 100).toFixed(2)))
    if (raw == null) return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) setLineRate(line, n / 100)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Comercial · Metas y comisiones</div>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{periodo.etiqueta}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost sm" type="button" title="Editar la tasa vigente de Home Care" onClick={() => editarLinea('cosm', rateCosm)}>
            <Percent size={14} /> Home Care: {(rateCosm * 100).toFixed(1)}%
          </button>
          <button className="btn ghost sm" type="button" title="Editar la tasa vigente de Professional" onClick={() => editarLinea('prof', rateProf)}>
            <Percent size={14} /> Professional: {(rateProf * 100).toFixed(1)}%
          </button>
        </div>
      </div>

      <div className="sysnote" role="note" style={{ background: 'var(--warn-bg, #FFF6E5)', borderColor: '#E9D8A6', color: '#8a6d1a', alignItems: 'flex-start' }}>
        <Info size={16} />
        <span>
          <b>Estimación, no liquidación.</b> La comisión de esta pantalla no es una cantidad a pagar ni genera obligación alguna:
          es lo vendido en el periodo por la <b>tasa vigente hoy</b>. No descuenta devoluciones, no usa tasas de fechas pasadas y
          toma al vendedor que el pedido trae registrado. La regla definitiva de comisiones está pendiente de decisión de Dirección.
        </span>
      </div>

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={cual === 'mes' ? 'active' : undefined} onClick={() => setCual('mes')}>Este mes</button>
        <button type="button" className={cual === 'pasado' ? 'active' : undefined} onClick={() => setCual('pasado')}>Mes pasado</button>
      </div>

      <div className="grid sigs">
        <div className="card sig"><div className="chip"><Target size={18} /></div><div className="v">{money(est.totales.vendido)}</div><div className="k">Vendido</div><div className="s">pedidos del periodo atribuidos a vendedores</div></div>
        <div className="card sig"><div className="chip"><Receipt size={18} /></div><div className="v">{money(est.totales.cobrado)}</div><div className="k">Cobrado en el periodo</div><div className="s">por fecha de pago, de pedidos con vendedor</div></div>
        <div className="card sig"><div className="chip"><Percent size={18} /></div><div className="v">{money(est.totales.comisionEstimada)}</div><div className="k">Comisión estimada</div><div className="s">sobre lo vendido · tasas de hoy · no es a pagar</div></div>
        <div className="card sig"><div className="chip"><Trophy size={18} /></div><div className="v">{rows[0] && rows[0].vendido > 0 ? rows[0].nombre.split('·')[0].trim() : '—'}</div><div className="k">Mayor venta del periodo</div><div className="s">{rows[0] && rows[0].vendido > 0 ? money(rows[0].vendido) : 'sin ventas'}</div></div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px 6px' }}>
          <div className="eyebrow" style={{ margin: 0 }}>Por vendedor</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            «Vendido» y «Cobrado» son bases distintas y se muestran separadas a propósito. La estimación aplica a cada renglón vendido
            la tasa vigente de su línea (Home Care o Professional). La meta es la vigente hoy.
          </div>
        </div>
        <div style={{ padding: '0 14px 10px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Vendedor</th><th>Vendido</th><th>Cobrado en el periodo</th><th>Pedidos</th><th>Meta</th><th>Avance</th><th>Comisión estimada</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <MetaRow key={r.email} row={r} onSetMeta={(v) => setTarget(r.email, v)} />
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-3)' }}>Sin vendedores activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {sinVend.pedidos > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ink-3)' }}>Ventas sin vendedor registrado (mostrador / autoservicio del doctor):</span>
          <b className="mono">{money(sinVend.vendido)}</b>
          <span style={{ color: 'var(--ink-3)' }}>· {sinVend.pedidos} pedido(s) · fuera de la estimación</span>
        </div>
      )}
    </div>
  )
}

interface Row { email: string; nombre: string; vendido: number; cobrado: number; pedidos: number; meta: number; avance: number; comisionEstimada: number }

function MetaRow({ row, onSetMeta }: { row: Row; onSetMeta: (v: number) => void }) {
  const [val, setVal] = useState(String(row.meta || ''))
  const save = () => { const n = Number(val.trim()); if (Number.isFinite(n)) onSetMeta(n) }
  const pct = Math.min(100, Math.round(row.avance))
  const ok = row.meta > 0 && row.vendido >= row.meta
  return (
    <tr>
      <td data-label="Vendedor">{row.nombre}</td>
      <td data-label="Vendido" className="mono">{money(row.vendido)}</td>
      <td data-label="Cobrado en el periodo" className="mono">{money(row.cobrado)}</td>
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
      <td data-label="Comisión estimada" className="mono" title="Estimación sobre lo vendido con la tasa vigente. No es una cantidad a pagar."><b>{money(row.comisionEstimada)}</b> <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>est.</span></td>
    </tr>
  )
}
