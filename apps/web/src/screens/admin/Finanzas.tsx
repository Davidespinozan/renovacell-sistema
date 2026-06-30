// FINANZAS (Dirección). Estado de resultados (utilidad real con costos),
// posición financiera (por cobrar / por pagar) y registro de gastos. Datos
// SENSIBLES (costos/utilidad): solo Dirección. Lógica pura en data/ops/finanzas.
import React, { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Wallet, Plus, X, Trash2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useCompras } from '../../data/hooks/useCompras'
import { useGastos, type GastoCategoria } from '../../data/hooks/useFinanzas'
import { GASTO_CATEGORIAS } from '../../data/store/gastosStore'
import { estadoResultados, cuentasPorCobrar, cuentasPorPagar, gastosPorCategoria } from '../../data/ops/finanzas'

const pct = (n: number) => `${n.toFixed(1)}%`

export function Finanzas() {
  const { data: orders } = useAllOrders()
  const { data: compras } = useCompras()
  const { data: gastos, addGasto, removeGasto } = useGastos()
  const [open, setOpen] = useState(false)

  const er = useMemo(() => estadoResultados(orders, gastos), [orders, gastos])
  const cxc = useMemo(() => cuentasPorCobrar(orders), [orders])
  const cxp = useMemo(() => cuentasPorPagar(compras), [compras])
  const porCat = useMemo(() => gastosPorCategoria(gastos), [gastos])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Finanzas">
        La salud real del negocio: cuánto vendiste, cuánto costó, cuánto gastaste y
        <b> cuánto ganaste</b> — más lo que te deben y lo que debes. (Solo Dirección.)
      </PageHead>

      {/* Estado de resultados */}
      <div className="grid sigs">
        <Stat icon={<TrendingUp size={18} />} v={money(er.ventas)} k="Ventas" s="del periodo" />
        <Stat icon={<ArrowDownCircle size={18} />} v={money(er.costoVentas)} k="Costo de ventas" s={`margen bruto ${pct(er.margenBruto)}`} />
        <Stat icon={<Wallet size={18} />} v={money(er.utilidadBruta)} k="Utilidad bruta" s="ventas − costo" />
        <Stat icon={<ArrowDownCircle size={18} />} v={money(er.gastos)} k="Gastos" s="operativos" />
        <Stat icon={er.utilidadNeta >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />} v={money(er.utilidadNeta)} k="Utilidad neta" s={`margen neto ${pct(er.margenNeto)}`} accent={er.utilidadNeta >= 0 ? 'ok' : 'dang'} />
      </div>

      {/* Posición financiera */}
      <div className="grid two">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="chip" style={{ background: 'var(--ok-bg)', color: 'var(--green-deep)', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center' }}><ArrowDownCircle size={18} /></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>Por cobrar</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{money(cxc.total)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>{cxc.count} pedido(s) contra pedido sin pagar.</div>
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="chip" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center' }}><ArrowUpCircle size={18} /></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>Por pagar</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{money(cxp.total)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>{cxp.count} compra(s) a proveedor pendientes (a costo).</div>
        </div>
      </div>

      {/* Gastos */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Gastos del periodo</div>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {porCat.slice(0, 4).map((c) => (
              <span key={c.categoria} className="pill p-neu">{c.categoria}: {money(c.monto)}</span>
            ))}
            <button className="btn sm" type="button" onClick={() => setOpen(true)}><Plus size={14} /> Registrar gasto</button>
          </span>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Monto</th><th></th></tr></thead>
            <tbody>
              {gastos.map((g) => (
                <tr key={g.id}>
                  <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(g.fecha)}</td>
                  <td data-label="Categoría"><span className="pill p-neu">{g.categoria}</span></td>
                  <td data-label="Concepto">{g.concepto}</td>
                  <td data-label="Monto" className="mono">{money(g.monto)}</td>
                  <td data-label="" style={{ textAlign: 'right' }}>
                    <button className="btn ghost sm" type="button" onClick={() => removeGasto(g.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {gastos.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Sin gastos registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {open && <GastoModal onClose={() => setOpen(false)} onSave={(g) => { addGasto(g); setOpen(false) }} />}
    </div>
  )
}

function Stat({ icon, v, k, s, accent }: { icon: React.ReactNode; v: string; k: string; s: string; accent?: 'ok' | 'dang' }) {
  return (
    <div className="card sig">
      <div className="chip" style={accent === 'dang' ? { background: 'var(--danger-bg)', color: 'var(--danger)' } : undefined}>{icon}</div>
      <div className="v" style={{ fontSize: 18, color: accent === 'dang' ? 'var(--danger)' : accent === 'ok' ? 'var(--green-deep)' : undefined }}>{v}</div>
      <div className="k">{k}</div>
      <div className="s">{s}</div>
    </div>
  )
}

function GastoModal({ onClose, onSave }: { onClose: () => void; onSave: (g: { fecha: string; categoria: GastoCategoria; concepto: string; monto: number }) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [fecha, setFecha] = useState(today)
  const [categoria, setCategoria] = useState<GastoCategoria>('Otros')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const n = Math.max(0, Number(monto) || 0)
  const valid = concepto.trim() !== '' && n > 0

  const fld: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 6 }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Registrar gasto</h3><div className="ms">Resta a la utilidad del periodo.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="form-grid-2">
            <div>
              <label style={{ ...lbl, marginTop: 0 }}>Fecha</label>
              <input type="date" style={fld} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <label style={{ ...lbl, marginTop: 0 }}>Categoría</label>
              <select style={fld} value={categoria} onChange={(e) => setCategoria(e.target.value as GastoCategoria)}>
                {GASTO_CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <label style={lbl}>Concepto</label>
          <input style={fld} value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="p. ej. Renta bodega" autoFocus />
          <label style={lbl}>Monto (MXN)</label>
          <input type="number" min={1} style={fld} value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0" />

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSave({ fecha, categoria, concepto: concepto.trim(), monto: n })}>Guardar gasto</button>
          </div>
        </div>
      </div>
    </div>
  )
}
