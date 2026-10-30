// COMERCIAL · Metas y comisiones de vendedor (solo Dirección).
//
// La comisión que aquí se muestra es una ESTIMACIÓN, no una liquidación ni una cifra
// "a pagar": el modelo de comisiones sigue pendiente de decisión de Dirección (D-15).
// La pantalla solo LEE: no congela tasas, no reconstruye vendedores, no aplica reversas
// y no escribe ningún movimiento de dinero. Toda la regla vive en `data/comisiones.ts`.
import React, { useMemo, useState } from 'react'
import { Target, Percent, Trophy, Receipt, Info, TrendingUp, TrendingDown } from 'lucide-react'
import { movimientoProductos } from '../../data/metrics'
import { money } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useTeam } from '../../data/hooks/useTeam'
import { useMetas } from '../../data/hooks/useMetas'
import { usePaymentEntries } from '../../data/hooks/useMoney'
import { useRefunds } from '../../data/hooks/useFinanzas'
import { hasSupabase } from '../../lib/supabase'
import { entriesFromOrders } from '../../data/ops/moneyMock'
import { estimarComisiones, sinCuentasOcultas, type LineaProducto } from '../../data/comisiones'
import { esteMes, mesPasado, diaNegocio, hoyNegocio } from '../../data/periodo'
import { lineasDe, metasDe, useComisionesEquipo, type leerComisionesEquipo } from '../../data/ops/comisionesEquipo'

// Con backend los datos salen de comisiones_equipo (Dirección y jefe de ventas: la misma lectura y el mismo cálculo);
// solo Dirección edita metas y tasas. Sin backend (demo y pruebas) se usan los datos locales.
export function Comisiones({ leer }: { leer?: typeof leerComisionesEquipo } = {}) {
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
  const srv = useComisionesEquipo(periodo.desde, periodo.hasta, leer ? { leer } : {})
  const datos = srv.datos
  const puedeEditar = datos ? datos.puede_editar : true
  // El jefe de ventas lee metas y tasas del servidor; Dirección usa el almacén de metas (vivo, lo edita aquí mismo).
  const soloLectura = datos && !puedeEditar ? metasDe(datos.metas) : null
  const metaDe = soloLectura ? soloLectura.targetFor : targetFor
  const rateCosm = soloLectura ? soloLectura.lineRate('cosm') : lineRate('cosm')
  const rateProf = soloLectura ? soloLectura.lineRate('prof') : lineRate('prof')

  const sellers = useMemo(() => team.filter((u) => u.role === 'pos' && u.active), [team])
  // Cuentas internas: sus pedidos de prueba no cuentan (su vendedor no está en el equipo visible).
  const pedidos = useMemo(() => (datos ? datos.pedidos : sinCuentasOcultas(orders, new Set(team.map((u) => u.id)))), [datos, orders, team])
  // Línea de cada producto (Home Care 'cosm' / Professional 'prof') para la tasa por línea.
  const lineOf = useMemo(() => {
    const m: Record<string, LineaProducto> = {}
    products.forEach((p) => { m[p.id] = p.line === 'prof' ? 'prof' : 'cosm' })
    return datos ? { ...m, ...lineasDe(datos.pedidos) } : m
  }, [products, datos])

  const est = useMemo(() => estimarComisiones({
    orders: pedidos,
    // Con backend, el cobrado sale del libro; en la demo se deriva de los pedidos pagados.
    entries: datos ? datos.asientos : hasSupabase ? asientos : entriesFromOrders(pedidos, refunds, diaNegocio),
    vendedores: datos ? datos.vendedores : sellers.map((s) => ({ id: s.id, email: s.email, name: s.name })),   // CX-0c · id = identidad canónica
    lineaDe: (pid) => ((pid && lineOf[pid]) === 'prof' ? 'prof' : 'cosm'),
    tasaVigente: { cosm: rateCosm, prof: rateProf },
  }, periodo), [datos, pedidos, asientos, refunds, sellers, lineOf, rateCosm, rateProf, periodo])

  // HERRAMIENTAS DEL VENDEDOR · productos más y menos movidos del periodo (por piezas; los menos incluyen los que no se vendieron).
  const mov = useMemo(() => movimientoProductos(pedidos as Parameters<typeof movimientoProductos>[0], products, periodo, 5), [pedidos, products, periodo])
  const rows = useMemo(() => est.filas.map((f) => {
    const meta = metaDe(f.email)
    return { ...f, meta, avance: meta > 0 ? (f.vendido / meta) * 100 : 0 }
  }), [est, metaDe])
  const sinVend = est.sinVendedor

  const editarLinea = (line: 'cosm' | 'prof', actual: number) => {
    if (!puedeEditar) return
    const label = line === 'prof' ? 'Professional' : 'Home Care'
    const raw = window.prompt(`Tasa VIGENTE de ${label} (%). Ej. 5 = 5%. Cambiarla recalcula la estimación de cualquier periodo: no hay tasas históricas guardadas.`, String((actual * 100).toFixed(2)))
    if (raw == null) return
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0 && n <= 100) setLineRate(line, n / 100)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow crumb" style={{ margin: 0 }}>Comercial · Metas y comisiones</div>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{periodo.etiqueta}</span>
        {/* Tasas como píldoras junto al periodo (pulido-admin.css · .pa-tasas): son contexto, no acciones grandes. */}
        <div className="pa-tasas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {puedeEditar ? <>
            <button className="btn ghost sm" type="button" title="Editar la tasa vigente de Home Care" onClick={() => editarLinea('cosm', rateCosm)}>
              <Percent size={14} /> Home Care: {(rateCosm * 100).toFixed(1)}%
            </button>
            <button className="btn ghost sm" type="button" title="Editar la tasa vigente de Professional" onClick={() => editarLinea('prof', rateProf)}>
              <Percent size={14} /> Professional: {(rateProf * 100).toFixed(1)}%
            </button>
          </> : <>
            <span className="pill" data-testid="tasa-cosm"><Percent size={12} /> Home Care: {(rateCosm * 100).toFixed(1)}%</span>
            <span className="pill" data-testid="tasa-prof"><Percent size={12} /> Professional: {(rateProf * 100).toFixed(1)}%</span>
          </>}
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

      {srv.error && <div role="alert" className="sysnote" data-testid="comisiones-error">{srv.error}</div>}
      {!puedeEditar && <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="comisiones-solo-lectura">Vista del jefe de ventas: las metas y las tasas las define Dirección.</div>}

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={cual === 'mes' ? 'active' : undefined} onClick={() => setCual('mes')}>Este mes</button>
        <button type="button" className={cual === 'pasado' ? 'active' : undefined} onClick={() => setCual('pasado')}>Mes pasado</button>
      </div>

      <div className="grid sigs">
        <div className="card sig"><div className="chip"><Target size={18} /></div><div className="v">{money(est.totales.vendido)}</div><div className="k">Vendido</div><div className="s">pedidos del periodo atribuidos a vendedores</div></div>
        <div className="card sig"><div className="chip"><Receipt size={18} /></div><div className="v">{money(est.totales.cobrado)}</div><div className="k">Cobrado en el periodo</div><div className="s">por fecha de pago, de pedidos con vendedor</div></div>
        <div className="card sig"><div className="chip"><Percent size={18} /></div><div className="v">{money(est.totales.comisionEstimada)}</div><div className="k">Comisión estimada</div><div className="s">sobre lo vendido · tasas de hoy · no es a pagar</div></div>
        <div className="card sig"><div className="chip"><Trophy size={18} /></div><div className="v pa-sig-nombre">{rows[0] && rows[0].vendido > 0 ? rows[0].nombre.split('·')[0].trim() : '—'}</div><div className="k">Mayor venta del periodo</div><div className="s">{rows[0] && rows[0].vendido > 0 ? money(rows[0].vendido) : 'sin ventas'}</div></div>
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
                <MetaRow key={r.email} row={r} onSetMeta={puedeEditar ? (v) => setTarget(r.email, v) : null} />
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--ink-3)' }}>Sin vendedores activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid pmov" data-testid="productos-movimiento">
        <div className="card">
          <div className="eyebrow pmov-h"><TrendingUp size={15} /> Más vendidos · {periodo.etiqueta}</div>
          {mov.mas.length === 0 ? <div className="pmov-vacio">Sin ventas en el periodo.</div> : (
            <ol className="pmov-lista">{mov.mas.map((p) => <li key={p.id}><span>{p.name}</span><b className="mono">{p.units} pz</b><small className="mono">{money(p.revenue)}</small></li>)}</ol>
          )}
        </div>
        <div className="card">
          <div className="eyebrow pmov-h"><TrendingDown size={15} /> Menos vendidos · {periodo.etiqueta}</div>
          {mov.menos.length === 0 ? <div className="pmov-vacio">Sin productos en el catálogo.</div> : (
            <ol className="pmov-lista">{mov.menos.map((p) => <li key={p.id}><span>{p.name}</span><b className="mono">{p.units} pz</b><small className="mono">{p.units ? money(p.revenue) : 'sin ventas'}</small></li>)}</ol>
          )}
        </div>
      </div>

      {sinVend.pedidos > 0 && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--ink-3)' }}>Ventas sin vendedor registrado (mostrador / autoservicio del doctor):</span>
          <b className="mono">{money(sinVend.vendido)}</b>
          <span style={{ color: 'var(--ink-3)' }}>· {sinVend.pedidos} {sinVend.pedidos === 1 ? 'pedido' : 'pedidos'} · fuera de la estimación</span>
        </div>
      )}
    </div>
  )
}

interface Row { email: string; nombre: string; vendido: number; cobrado: number; pedidos: number; meta: number; avance: number; comisionEstimada: number }

function MetaRow({ row, onSetMeta }: { row: Row; onSetMeta: ((v: number) => void) | null }) {
  const [val, setVal] = useState(String(row.meta || ''))
  const save = () => { const n = Number(val.trim()); if (onSetMeta && Number.isFinite(n)) onSetMeta(n) }
  const pct = Math.min(100, Math.round(row.avance))
  const ok = row.meta > 0 && row.vendido >= row.meta
  return (
    <tr>
      <td data-label="Vendedor">{row.nombre}</td>
      <td data-label="Vendido" className="mono">{money(row.vendido)}</td>
      <td data-label="Cobrado en el periodo" className="mono">{money(row.cobrado)}</td>
      <td data-label="Pedidos" className="mono">{row.pedidos}</td>
      <td data-label="Meta">
        {!onSetMeta ? <span className="mono">{row.meta > 0 ? money(row.meta) : '—'}</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--ink-3)' }}>$</span>
          <input value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} inputMode="numeric"
            placeholder="0" style={{ width: 92, padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
        </span>}
      </td>
      <td data-label="Avance">
        {row.meta > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
            <span style={{ flex: 1, height: 7, borderRadius: 5, background: 'var(--line)', overflow: 'hidden', minWidth: 64, display: 'inline-block' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: ok ? 'var(--grad-green)' : 'var(--green-soft)' }} />
            </span>
            <span className="mono" style={{ fontSize: 12, color: ok ? 'var(--green-deep)' : 'var(--ink-3)' }}>{Math.round(row.avance)}%</span>
          </span>
        ) : <span style={{ color: 'var(--ink-3)', opacity: 0.6 }} title="Sin meta asignada">—</span>}
      </td>
      <td data-label="Comisión estimada" className="mono" title="Estimación sobre lo vendido con la tasa vigente. No es una cantidad a pagar."><b>{money(row.comisionEstimada)}</b> <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>est.</span></td>
    </tr>
  )
}
