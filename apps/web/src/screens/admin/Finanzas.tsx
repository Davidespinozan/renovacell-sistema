// FINANZAS (Dirección). Estado de resultados (utilidad real con costos),
// posición financiera (por cobrar / por pagar) y registro de gastos. Datos
// SENSIBLES (costos/utilidad): solo Dirección. Lógica pura en data/ops/finanzas.
import React, { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Wallet, Plus, X, Trash2, ArrowDownCircle, ArrowUpCircle, AlertTriangle, Receipt } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useCompras } from '../../data/hooks/useCompras'
import { useGastos, type GastoCategoria } from '../../data/hooks/useFinanzas'
import { GASTO_CATEGORIAS } from '../../data/store/gastosStore'
import { cuentasPorPagar, gastosPorCategoria } from '../../data/ops/finanzas'
import { useKpiVentas, useKpiPorCobrar, useKpiResultado } from '../../data/hooks/useKpis'
import { avanceDeCobro } from '../../data/kpis'
import { esteMes, mesPasado, todoElHistorico, enPeriodo, hoyNegocio } from '../../data/periodo'
import { cifra, AvisoKpi } from '../../app/Kpi'

const pct = (n: number) => `${n.toFixed(1)}%`

export function Finanzas() {
  const { data: compras, markPaid } = useCompras()
  const { data: gastos, addGasto, removeGasto } = useGastos()
  const [open, setOpen] = useState(false)

  // Periodo en DÍAS DEL NEGOCIO (America/Mazatlan): el mismo corte que aplica el servidor.
  const [period, setPeriod] = useState<'mes' | 'pasado' | 'todo'>('mes')
  const hoy = hoyNegocio()
  const range = useMemo(
    () => (period === 'todo' ? todoElHistorico() : period === 'pasado' ? mesPasado() : esteMes()),
    [period, hoy], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // CIFRAS DE CABECERA: las responde el servidor. Utilidad y margen llegan en null
  // cuando el costo de lo vendido no se conoce completo (er.costo_confiable = false).
  const res = useKpiResultado(range)
  const ven = useKpiVentas(range)
  const cxc = useKpiPorCobrar()
  const er = res.data
  const cogsUnreliable = !!er && !er.costo_confiable
  const netaUnreliable = !!er && !er.utilidad_neta_confiable
  const avance = ven.data ? avanceDeCobro(ven.data) : null

  // `fecha` de un gasto ya es un día del negocio: se compara como fecha, sin zonas.
  const fGastos = useMemo(() => gastos.filter((g) => enPeriodo(g.fecha, range)), [gastos, range])
  const cxp = useMemo(() => cuentasPorPagar(compras), [compras])
  const porPagar = useMemo(() => compras.filter((p) => p.kind === 'compra' && !p.paid), [compras])
  const porCat = useMemo(() => gastosPorCategoria(fGastos), [fGastos])
  const dinero = (n: number | null | undefined) => (n == null ? 'No confiable' : money(n))

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Finanzas">
        La salud real del negocio: cuánto vendiste, cuánto costó, cuánto gastaste y
        <b> cuánto ganaste</b> — más lo que te deben y lo que debes. (Solo Dirección.)
      </PageHead>

      <AvisoKpi estados={[res, ven, cxc]} />

      {er && cogsUnreliable && (
        <div className="sysnote" style={{ background: 'var(--warn-bg, #FFF6E5)', borderColor: '#E9D8A6', color: '#8a6d1a', alignItems: 'flex-start' }}>
          <AlertTriangle size={16} />
          <span>
            <b>Costo incompleto: se conoce el de {er.cobertura_pct}% de las {er.unidades_vendidas} unidades vendidas.</b>{' '}
            {er.unidades_sin_surtir > 0 && <>{er.unidades_sin_surtir} unidad(es) vendida(s) aún no se surten: su costo se conoce al salir del almacén. </>}
            {er.unidades_sin_costo > 0 && <>{er.unidades_sin_costo} unidad(es) salieron sin costo registrado. </>}
            Por eso <b>utilidad y margen se muestran como no confiables</b>: un costo desconocido no se cuenta como cero.
          </span>
        </div>
      )}
      {er && !cogsUnreliable && netaUnreliable && (
        <div className="sysnote" style={{ background: 'var(--warn-bg, #FFF6E5)', borderColor: '#E9D8A6', color: '#8a6d1a', alignItems: 'flex-start' }}>
          <AlertTriangle size={16} />
          <span>
            <b>Mermas sin costo: {er.merma_unidades_sin_costo} unidad(es) dadas de baja no tienen costo registrado.</b>{' '}
            La utilidad bruta es confiable; la <b>utilidad neta no</b>, porque esa merma no vale cero.
          </span>
        </div>
      )}

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={period === 'mes' ? 'active' : undefined} onClick={() => setPeriod('mes')}>Este mes</button>
        <button type="button" className={period === 'pasado' ? 'active' : undefined} onClick={() => setPeriod('pasado')}>Mes pasado</button>
        <button type="button" className={period === 'todo' ? 'active' : undefined} onClick={() => setPeriod('todo')}>Todo</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '-4px 0 0' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Estado de resultados · {range.etiqueta}</div>
        {er && (
          <ExportButton
            name={`estado-de-resultados-${range.etiqueta}`}
            style={{ marginLeft: 'auto' }}
            rows={[
              ...(cogsUnreliable ? [{ concepto: `AVISO: costo conocido solo para ${er.cobertura_pct}% de las unidades vendidas — utilidad y margen NO son confiables`, monto: '' as number | string }] : []),
              { concepto: 'Ventas', monto: er.ventas as number | string },
              { concepto: 'Devoluciones', monto: -er.devoluciones },
              { concepto: 'Ventas netas', monto: er.ventas_netas },
              { concepto: cogsUnreliable ? 'Costo de ventas conocido (incompleto)' : 'Costo de ventas', monto: -er.costo_ventas_conocido },
              { concepto: 'Utilidad bruta', monto: er.utilidad_bruta ?? 'no confiable' },
              { concepto: 'Gastos', monto: -er.gastos },
              { concepto: er.merma_unidades_sin_costo > 0 ? 'Mermas con costo conocido (incompleto)' : 'Mermas', monto: -er.mermas_conocidas },
              { concepto: 'Utilidad neta', monto: er.utilidad_neta ?? 'no confiable' },
              { concepto: 'Margen bruto %', monto: er.margen_bruto_pct ?? 'no confiable' },
              { concepto: 'Margen neto %', monto: er.margen_neto_pct ?? 'no confiable' },
            ]}
            columns={[
              { key: 'concepto', label: 'Concepto' },
              { key: 'monto', label: 'Monto' },
            ]}
          />
        )}
      </div>

      {/* Estado de resultados */}
      <div className="grid sigs">
        <Stat icon={<TrendingUp size={18} />} v={cifra(res, (r) => money(r.ventas))} k="Ventas" s={`pedidos levantados · ${range.etiqueta.toLowerCase()}`} />
        {er && er.devoluciones > 0 && (
          <Stat icon={<TrendingDown size={18} />} v={money(er.devoluciones)} k="Devoluciones" s={`ventas netas ${money(er.ventas_netas)}`} accent="dang" />
        )}
        <Stat icon={<ArrowDownCircle size={18} />} v={cifra(res, (r) => (r.costo_ventas == null ? '—' : money(r.costo_ventas)))} k="Costo de ventas" s={!er ? '' : cogsUnreliable ? `conocido: ${money(er.costo_ventas_conocido)} · faltan costos` : `margen bruto ${pct(er.margen_bruto_pct ?? 0)}`} accent={cogsUnreliable ? 'warn' : undefined} />
        <Stat icon={<Wallet size={18} />} v={cifra(res, (r) => dinero(r.utilidad_bruta))} k="Utilidad bruta" s={cogsUnreliable ? 'falta costo de lo vendido' : 'ventas netas − costo'} accent={cogsUnreliable ? 'warn' : undefined} />
        <Stat icon={<ArrowDownCircle size={18} />} v={cifra(res, (r) => money(r.gastos))} k="Gastos" s="operativos" />
        <Stat icon={<ArrowDownCircle size={18} />} v={cifra(res, (r) => money(r.mermas_conocidas))} k="Mermas" s={er && er.merma_unidades_sin_costo > 0 ? `+ ${er.merma_unidades_sin_costo} unidad(es) sin costo` : 'caducidad / daño'} accent={er && (er.mermas_conocidas > 0 || er.merma_unidades_sin_costo > 0) ? 'dang' : undefined} />
        <Stat icon={er && (er.utilidad_neta ?? 0) < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />} v={cifra(res, (r) => dinero(r.utilidad_neta))} k="Utilidad neta" s={!er ? '' : er.utilidad_neta == null ? 'falta costo para calcularla' : `margen neto ${pct(er.margen_neto_pct ?? 0)}`} accent={!er ? undefined : er.utilidad_neta == null ? 'warn' : er.utilidad_neta >= 0 ? 'ok' : 'dang'} />
      </div>

      {/* Cobranza: lo vendido en el periodo y el dinero que entró EN el periodo */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="eyebrow" style={{ margin: 0 }}>Cobranza · {range.etiqueta}</div>
          {avance != null && (
            <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)' }}>Avance de cobro de lo vendido <b style={{ color: avance >= 80 ? 'var(--green-deep)' : avance >= 50 ? 'var(--warn)' : 'var(--danger)' }}>{pct(avance)}</b></span>
          )}
        </div>
        <div style={{ height: 10, borderRadius: 999, background: 'var(--line)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ width: `${Math.min(100, Math.max(0, avance ?? 0))}%`, height: '100%', background: 'var(--grad-green, linear-gradient(90deg,#009A3E,#007311))' }} />
        </div>
        <div className="grid sigs">
          <Stat icon={<Receipt size={18} />} v={cifra(ven, (k) => money(k.ventas))} k="Vendido" s="pedidos levantados en el periodo" />
          <Stat icon={<TrendingUp size={18} />} v={cifra(ven, (k) => money(k.cobrado_neto))} k="Cobrado en el periodo" s="por fecha de pago: lo que entró menos lo que salió" accent="ok" />
          {ven.data && ven.data.cobrado_salidas > 0 && (
            <Stat icon={<TrendingDown size={18} />} v={money(ven.data.cobrado_salidas)} k="Salidas" s={`reembolsos y reversas · entraron ${money(ven.data.cobrado_entradas)}`} accent="dang" />
          )}
          <Stat icon={<ArrowDownCircle size={18} />} v={cifra(ven, (k) => money(k.saldo_ventas))} k="Falta cobrar de lo vendido" s="saldo a hoy de los pedidos del periodo" />
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
          «Cobrado en el periodo» cuenta el dinero por la fecha en que se pagó, sea de pedidos de este periodo o de anteriores.
        </div>
      </div>

      {/* Posición financiera */}
      <div className="grid two">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="chip" style={{ background: 'var(--ok-bg)', color: 'var(--green-deep)', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center' }}><ArrowDownCircle size={18} /></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>Cuentas por cobrar · posición a hoy</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{cifra(cxc, (c) => money(c.total))}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>saldo de pedidos sin liquidar · no depende del periodo</div>
            </div>
          </div>
          {cxc.data && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
              {cxc.data.pedidos} pedido(s) con saldo · {money(cxc.data.a_credito)} a crédito{cxc.data.vencido > 0 ? ` · ${money(cxc.data.vencido)} vencido` : ''}.
            </div>
          )}
        </div>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="chip" style={{ background: 'var(--warn-bg)', color: 'var(--warn)', width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center' }}><ArrowUpCircle size={18} /></div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>Por pagar</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{money(cxp.total)}</div>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>{cxp.count} compra(s) a proveedor sin pagar (a costo real).</div>
          {porPagar.length > 0 && (
            <div style={{ marginTop: 10, display: 'grid', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
              {porPagar.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product_name}{p.supplier ? ` · ${p.supplier}` : ''}</span>
                  <span className="mono">{money(p.unit_cost * p.qty)}</span>
                  <button className="btn ghost sm" type="button" onClick={() => void markPaid(p.id)}>Pagar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gastos */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Gastos · {range.etiqueta}</div>
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
              {fGastos.map((g) => (
                <tr key={g.id}>
                  <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(g.fecha)}</td>
                  <td data-label="Categoría"><span className="pill p-neu">{g.categoria}</span></td>
                  <td data-label="Concepto">{g.concepto}</td>
                  <td data-label="Monto" className="mono">{money(g.monto)}</td>
                  <td data-label="" style={{ textAlign: 'right' }}>
                    <button className="btn ghost sm" type="button" onClick={() => { if (window.confirm(`¿Eliminar el gasto "${g.concepto}" por ${money(g.monto)}? No se puede deshacer.`)) void removeGasto(g.id) }}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {fGastos.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Sin gastos en el periodo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* El modal solo se cierra si el gasto quedó guardado; si no, conserva lo capturado. */}
      {open && <GastoModal onClose={() => setOpen(false)} onSave={async (g) => { const r = await addGasto(g); if (r.ok) setOpen(false) }} />}
    </div>
  )
}

function Stat({ icon, v, k, s, accent }: { icon: React.ReactNode; v: string; k: string; s: string; accent?: 'ok' | 'dang' | 'warn' }) {
  const chipStyle = accent === 'dang' ? { background: 'var(--danger-bg)', color: 'var(--danger)' }
    : accent === 'warn' ? { background: 'var(--warn-bg)', color: 'var(--warn)' } : undefined
  const vColor = accent === 'dang' ? 'var(--danger)' : accent === 'warn' ? 'var(--warn)' : accent === 'ok' ? 'var(--green-deep)' : undefined
  return (
    <div className="card sig">
      <div className="chip" style={chipStyle}>{icon}</div>
      <div className="v" style={{ fontSize: 18, color: vColor }}>{v}</div>
      <div className="k">{k}</div>
      <div className="s">{s}</div>
    </div>
  )
}

function GastoModal({ onClose, onSave }: { onClose: () => void; onSave: (g: { fecha: string; categoria: GastoCategoria; concepto: string; monto: number }) => void }) {
  const today = hoyNegocio()
  const [fecha, setFecha] = useState(today)
  const [categoria, setCategoria] = useState<GastoCategoria>('Otros')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const n = Math.max(0, Number(monto) || 0)
  const valid = concepto.trim() !== '' && n > 0

  const fld: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 14, outline: 'none', marginTop: 6 }
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
