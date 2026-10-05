// ADMIN · Ventas — reportes comerciales (solo lectura). Alineado al estándar de
// sala-studio: selector de período, KpiCards con delta, gráficas recharts y un
// bloque avanzado de retención/recompra. Agrega de los stores vía data/metrics.
import React, { useMemo, useState } from 'react'
import {
  ArrowUp, ArrowDown, Minus, Info, TrendingUp, ShoppingBag, Receipt, Users, Repeat,
  Store, Package, AlertTriangle,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import { money, initials, avatarColor } from '../../lib/format'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { useDoctors } from '../../data/hooks/useDoctors'
import {
  channelSplit, doctorActivity, topDoctors, topProducts, lineMix,
  cfdiSolicitados, monthlySales, doctoresEnRiesgo, DIAS_RIESGO,
} from '../../data/metrics'
import { useKpiVentas } from '../../data/hooks/useKpis'
import { esteMes, mesPasado, ultimosDias, todoElHistorico, periodoAnterior, enPeriodo, hoyNegocio, type Periodo as PeriodoNegocio } from '../../data/periodo'
import { cifra, AvisoKpi } from '../../app/Kpi'
import type { ProductSafe, Profile } from '../../data/types'
import { VentasDetalle } from './VentasDetalle'

const GREEN = '#007311'
const GREEN_SOFT = '#5FB873'
const pct = (n: number) => `${Math.round(n * 100)}%`

// Periodos de CALENDARIO del negocio. «Este mes» es el mes calendario, no "los últimos
// 30 días": una ventana móvil con nombre de mes era la ambigüedad que se retiró.
type Periodo = 'mes' | 'pasado' | 'dias90' | 'todo'
const PERIODOS: { v: Periodo; label: string }[] = [
  { v: 'mes', label: 'Este mes' },
  { v: 'pasado', label: 'Mes pasado' },
  { v: 'dias90', label: 'Últimos 90 días' },
  { v: 'todo', label: 'Todo' },
]
const periodoDe = (v: Periodo): PeriodoNegocio =>
  v === 'mes' ? esteMes() : v === 'pasado' ? mesPasado() : v === 'dias90' ? ultimosDias(90) : todoElHistorico()

export function Ventas() {
  const [tab, setTab] = useState<'detalle' | 'resumen'>('detalle')
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Administración · Ventas</div>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Ventas</h1>
      </div>
      <div className="fchips">
        <button type="button" className={'fchip' + (tab === 'detalle' ? ' on' : '')} onClick={() => setTab('detalle')}>Detalle</button>
        <button type="button" className={'fchip' + (tab === 'resumen' ? ' on' : '')} onClick={() => setTab('resumen')}>Resumen</button>
      </div>
      {tab === 'detalle' ? <VentasDetalle /> : <VentasResumen />}
    </div>
  )
}

function VentasResumen() {
  const { data: orders } = useAllOrders()
  const { data: products } = useProducts()
  const { data: doctors } = useDoctors()
  const [periodo, setPeriodo] = useState<Periodo>('mes')

  const hoy = hoyNegocio()
  const p = useMemo(() => periodoDe(periodo), [periodo, hoy]) // eslint-disable-line react-hooks/exhaustive-deps
  const pPrev = useMemo(() => periodoAnterior(p), [p])
  // Desgloses (canal, línea, top) sobre los pedidos cargados, cortados por DÍA DEL NEGOCIO.
  const filtered = useMemo(() => orders.filter((o) => enPeriodo(o.created_at, p)), [orders, p])

  const productsById = useMemo(() => Object.fromEntries(products.map((x) => [x.id, x])) as Record<string, ProductSafe | undefined>, [products])
  const doctorsById = useMemo(() => Object.fromEntries(doctors.map((d) => [d.id, d])) as Record<string, Profile | undefined>, [doctors])

  // CIFRAS DE CABECERA: del servidor. El periodo anterior es del mismo tamaño
  // (mes contra mes, 90 días contra los 90 anteriores).
  const cur = useKpiVentas(p)
  const prev = useKpiVentas(pPrev ?? p)
  const revDelta = pPrev && cur.data && prev.data && prev.data.ventas > 0 ? (cur.data.ventas - prev.data.ventas) / prev.data.ventas : null
  const ordDelta = pPrev && cur.data && prev.data && prev.data.pedidos > 0 ? (cur.data.pedidos - prev.data.pedidos) / prev.data.pedidos : null

  const act = doctorActivity(filtered)
  const channel = channelSplit(filtered)
  const mix = lineMix(filtered, productsById)
  const docs = topDoctors(filtered, doctorsById)
  const prods = topProducts(filtered, productsById)
  const cfdi = cfdiSolicitados(filtered)
  const trend = monthlySales(orders) // tendencia: siempre los últimos 6 meses del negocio
  const risk = doctoresEnRiesgo(orders, doctors)

  return (
    <div className="grid" style={{ gap: 26 }}>
      {/* Selector de período */}
      <div className="fchips">
        {PERIODOS.map((x) => (
          <button key={x.v} type="button" className={'fchip' + (periodo === x.v ? ' on' : '')} onClick={() => setPeriodo(x.v)}>{x.label}</button>
        ))}
      </div>
      <div className="eyebrow" style={{ margin: '-14px 0 -10px' }}>{p.etiqueta}{p.desde && p.hasta ? ` · del ${p.desde} al ${p.hasta}` : ''}</div>
      <AvisoKpi estados={[cur, prev]} />

      {/* KPIs */}
      <div className="grid sigs">
        <Kpi icon={<TrendingUp size={18} />} label="Ventas" value={cifra(cur, (k) => money(k.ventas))} delta={revDelta} />
        <Kpi icon={<ShoppingBag size={18} />} label="Pedidos" value={cifra(cur, (k) => String(k.pedidos))} delta={ordDelta} />
        <Kpi icon={<Receipt size={18} />} label="Ticket promedio" value={cifra(cur, (k) => money(k.ticket))} nota="por pedido" />
        <Kpi icon={<Users size={18} />} label="Doctores activos" value={String(act.active)} nota="con compra" />
        <Kpi icon={<Repeat size={18} />} label="Recompra" value={pct(act.repeatRate)} nota={`${act.repeat} repiten`} ayuda="% de doctores con más de un pedido en el periodo." />
      </div>

      {/* Tendencia */}
      <ChartCard titulo="Ventas por mes · últimos 6 meses (no depende del periodo elegido)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trend} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => money(Number(v))} width={64} />
            <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: 'rgba(95,184,115,.08)' }} />
            <Bar dataKey="revenue" name="Ventas" radius={[6, 6, 0, 0]} fill={GREEN} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Top productos + Top doctores */}
      <div className="grid two" style={{ gap: 16 }}>
        <ChartCard titulo="Top productos (ingresos)">
          {prods.length === 0 ? (
            <EmptyChart mensaje="Sin productos vendidos en el periodo." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(160, prods.length * 46)}>
              <BarChart layout="vertical" data={prods} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--line)" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => money(Number(v))} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: 'rgba(95,184,115,.08)' }} />
                <Bar dataKey="revenue" name="Ingresos" radius={[0, 6, 6, 0]}>
                  {prods.map((p, i) => <Cell key={p.id} fill={i === 0 ? GREEN : GREEN_SOFT} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Bloque titulo="Top doctores (LTV)">
          <table className="tbl-cards">
            <thead><tr><th>Doctor</th><th>Pedidos</th><th>Total</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td data-label="Doctor"><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><span className="avatar sm" style={{ background: avatarColor(d.name) }}>{initials(d.name)}</span>{d.name}</div></td>
                  <td data-label="Pedidos" className="mono">{d.orders}</td>
                  <td data-label="Total" className="mono">{money(d.total)}</td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--ink-3)' }}>Sin ventas a doctores en el periodo.</td></tr>}
            </tbody>
          </table>
        </Bloque>
      </div>

      {/* Canal + Línea + Facturación */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
        <Bloque titulo={<><Store size={14} style={ic} /> Por canal</>}>
          <SplitRow label="Portal del Doctor" amount={channel.portal.revenue} total={channel.portal.revenue + channel.pos.revenue} />
          <SplitRow label="Punto de Venta" amount={channel.pos.revenue} total={channel.portal.revenue + channel.pos.revenue} />
        </Bloque>
        <Bloque titulo={<><Package size={14} style={ic} /> Por línea</>}>
          <SplitRow label="Home Care" amount={mix.cosm.revenue} total={mix.cosm.revenue + mix.prof.revenue} sub={`${mix.cosm.units} pzas`} />
          <SplitRow label="Professional" amount={mix.prof.revenue} total={mix.cosm.revenue + mix.prof.revenue} sub={`${mix.prof.units} pzas`} />
        </Bloque>
        <Bloque titulo={<><Receipt size={14} style={ic} /> Cobro y CFDI</>}>
          <Mini k="CFDI solicitados" v={pct(cfdi)} />
          <Mini k="Cobrado en el periodo" v={cifra(cur, (k) => money(k.cobrado_neto))} tone="ok" />
          <Mini k="Falta cobrar de lo vendido" v={cifra(cur, (k) => money(k.saldo_ventas))} tone="warn" />
        </Bloque>
      </div>

      {/* Avanzado: retención / riesgo */}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 22 }}>
        <div className="eyebrow" style={{ color: 'var(--green-deep)' }}>Avanzado</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Retención y recompra</h2>
        <Bloque titulo={<><AlertTriangle size={14} style={ic} /> Doctores en riesgo · {DIAS_RIESGO} días o más sin pedir</>}>
          {risk.length === 0 ? (
            <div style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>Ningún doctor verificado con compras lleva {DIAS_RIESGO} días o más sin pedir. 🎉</div>
          ) : (
            <table className="tbl-cards">
              <thead><tr><th>Doctor</th><th>Último pedido</th><th>Histórico</th></tr></thead>
              <tbody>
                {risk.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Doctor">{r.name}</td>
                    <td data-label="Último pedido"><span className="pill p-warn">hace {r.diasSinPedir} d</span></td>
                    <td data-label="Histórico" className="mono">{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Bloque>
      </div>
    </div>
  )
}

const ic: React.CSSProperties = { display: 'inline', verticalAlign: '-2px', marginRight: 6 }

function Kpi({ icon, label, value, nota, delta, ayuda }: {
  icon: React.ReactNode; label: string; value: string; nota?: string; delta?: number | null; ayuda?: string
}) {
  return (
    <div className="card sig">
      <div className="chip">{icon}</div>
      <div className="v">{value}</div>
      <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {label}
        {ayuda && <span title={ayuda} style={{ display: 'inline-flex', cursor: 'help' }}><Info size={12} style={{ color: 'var(--ink-3)' }} /></span>}
      </div>
      {delta != null ? <Delta v={delta} /> : nota ? <div className="s">{nota}</div> : null}
    </div>
  )
}

function Delta({ v }: { v: number }) {
  const up = v > 0.001, down = v < -0.001
  const color = up ? 'var(--green-deep)' : down ? 'var(--danger)' : 'var(--ink-3)'
  const Icon = up ? ArrowUp : down ? ArrowDown : Minus
  return (
    <div className="s" style={{ display: 'flex', alignItems: 'center', gap: 4, color }}>
      <Icon size={12} /> {Math.abs(Math.round(v * 100))}% vs periodo anterior
    </div>
  )
}

function Bloque({ titulo, children }: { titulo: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="eyebrow">{titulo}</div>
      {children}
    </div>
  )
}

function ChartCard({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="eyebrow">{titulo}</div>
      {children}
    </div>
  )
}

function EmptyChart({ mensaje }: { mensaje: string }) {
  return <div style={{ height: 160, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>{mensaje}</div>
}

function SplitRow({ label, amount, total, sub }: { label: string; amount: number; total: number; sub?: string }) {
  const w = total > 0 ? (amount / total) * 100 : 0
  return (
    <div className="barrow">
      <div className="lab">{label}{sub && <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{sub}</div>}</div>
      <div className="track"><div className="fill" style={{ width: `${Math.max(2, w)}%` }} /></div>
      <div className="amt">{money(amount)}</div>
    </div>
  )
}

function Mini({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? 'var(--green-deep)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)'
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{k}</div>
      <div className="mono" style={{ fontSize: 17, fontWeight: 600, color, marginTop: 3 }}>{v}</div>
    </div>
  )
}
