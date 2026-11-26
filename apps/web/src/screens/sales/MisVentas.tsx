// MIS VENTAS (23 nov 2026, pedido de Roberto): el vendedor veía en Inicio "Vendido este mes" y "Por cobrar" pero no
// los pedidos que forman esas cifras. Esta pantalla los lista con LA MISMA regla que CifrasVendedor (RoleHome): pedidos
// que el vendedor ya puede ver (RLS = su cartera), sin cancelados ni borradores; "este mes" = mes del negocio;
// "por cobrar" = sin pagar ni reembolsar. Tocar un pedido muestra sus productos.
import React, { useMemo, useState } from 'react'
import { useAllOrders, type OrderWithItems } from '../../data/hooks/useOrders'
import { useProducts } from '../../data/hooks/useProducts'
import { clienteDePedido } from '../../data/mock/profiles'
import { diaNegocio, hoyNegocio } from '../../data/periodo'
import { statusView } from '../doctor/orderStatus'
import { etapaSeguimiento, fechaHora, useSeguimiento } from '../../data/ops/seguimientoVenta'   // TRAZABILIDAD (26 nov)
import { Cargando, Vacio } from '../../app/EmptyState'
import { fmtDate, money } from '../../lib/format'

export type FiltroVentas = 'mes' | 'cobrar' | 'todos'

// Filtro con el que se abre la pantalla (lo fijan las cifras de Inicio antes de navegar).
let filtroInicial: FiltroVentas = 'mes'
export function abrirMisVentas(setScreen: (k: string) => void, filtro: FiltroVentas) {
  filtroInicial = filtro
  setScreen('mis_ventas')
}

const vivo = (o: OrderWithItems) => o.status !== 'cancelled' && o.status !== 'draft'
const porCobrar = (o: OrderWithItems) => o.payment_status !== 'paid' && o.payment_status !== 'refunded'

export function filtrarVentas(pedidos: OrderWithItems[], filtro: FiltroVentas, mes: string): OrderWithItems[] {
  const vivos = pedidos.filter(vivo)
  if (filtro === 'mes') return vivos.filter((o) => diaNegocio(o.created_at).startsWith(mes))
  if (filtro === 'cobrar') return vivos.filter(porCobrar)
  return vivos
}

function etiquetaPago(o: OrderWithItems): { label: string; pill: string } {
  if (o.payment_status === 'paid') return { label: 'Pagado', pill: 'p-ok' }
  if (o.payment_status === 'refunded') return { label: 'Reembolsado', pill: 'p-neu' }
  return { label: 'Por cobrar', pill: 'p-warn' }
}

const FILTROS: Array<{ k: FiltroVentas; label: string }> = [
  { k: 'mes', label: 'Este mes' },
  { k: 'cobrar', label: 'Por cobrar' },
  { k: 'todos', label: 'Todos' },
]

export function MisVentas() {
  const { data: pedidos, loading } = useAllOrders()
  const { data: productos } = useProducts()
  const [filtro, setFiltro] = useState<FiltroVentas>(filtroInicial)
  const [abierto, setAbierto] = useState<string | null>(null)
  const mes = hoyNegocio().slice(0, 7)

  const nombreProducto = useMemo(() => {
    const m: Record<string, string> = {}
    productos.forEach((p) => { m[p.id] = p.name })
    return m
  }, [productos])

  const lista = useMemo(() => filtrarVentas(pedidos, filtro, mes), [pedidos, filtro, mes])
  const seg = useSeguimiento(lista.map((o) => o.id))
  const total = lista.reduce((s, o) => s + Number(o.total ?? 0), 0)

  const cambiar = (k: FiltroVentas) => { filtroInicial = k; setFiltro(k); setAbierto(null) }

  return (
    <div className="grid" style={{ gap: 16 }} data-testid="mis-ventas">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {FILTROS.map((f) => (
          <button key={f.k} type="button" className={`btn sm ${filtro === f.k ? '' : 'ghost'}`} onClick={() => cambiar(f.k)} aria-pressed={filtro === f.k} data-testid={`mis-ventas-${f.k}`}>
            {f.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--ink-2)' }} data-testid="mis-ventas-total">
          {lista.length} pedido{lista.length === 1 ? '' : 's'} · <b>{money(total)}</b>
        </span>
      </div>

      {loading ? <Cargando etiqueta="Cargando tus ventas…" /> : lista.length === 0 ? (
        <Vacio icono="bag" titulo={filtro === 'cobrar' ? 'No tienes pedidos por cobrar.' : filtro === 'mes' ? 'Aún no tienes ventas este mes.' : 'Aún no tienes ventas.'} />
      ) : (
        <div className="card" style={{ padding: '6px 14px 14px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Dónde va</th></tr></thead>
            <tbody>
              {lista.map((o) => {
                const pago = etiquetaPago(o)
                const st = statusView(o.status)
                const s = seg[o.id]
                const et = s ? etapaSeguimiento({ status: o.status, payment_method: o.payment_method, shipping_meta: o.shipping_meta, seguimiento: s }) : null
                const abiertoEste = abierto === o.id
                return (
                  <React.Fragment key={o.id}>
                    <tr onClick={() => setAbierto(abiertoEste ? null : o.id)} style={{ cursor: 'pointer' }} aria-expanded={abiertoEste} data-testid="mis-ventas-fila">
                      <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.created_at)}</td>
                      <td data-label="Pedido" className="mono">{o.external_ref ?? o.id.slice(0, 8)}</td>
                      <td data-label="Cliente">{clienteDePedido(o).name || '—'}</td>
                      <td data-label="Total" className="mono"><b>{money(Number(o.total ?? 0))}</b></td>
                      <td data-label="Pago"><span className={`pill ${pago.pill}`}>{pago.label}</span></td>
                      <td data-label="Dónde va" data-testid="mis-ventas-seguimiento"><span className={`pill ${et?.pill ?? st.pill}`}>{et?.texto ?? st.label}</span></td>
                    </tr>
                    {abiertoEste && (
                      <tr data-testid="mis-ventas-detalle">
                        <td colSpan={6} data-label="">
                          <div style={{ display: 'grid', gap: 4, padding: '4px 0 8px', fontSize: 13 }}>
                            {o.items.map((it) => (
                              <div key={it.id} style={{ display: 'flex', gap: 8 }}>
                                <span style={{ flex: 1 }}>{(it.product_id && nombreProducto[it.product_id]) || 'Producto'}</span>
                                <span className="mono">{it.qty} × {money(Number(it.unit_price ?? 0))}</span>
                                <span className="mono" style={{ minWidth: 90, textAlign: 'right' }}>{money(it.qty * Number(it.unit_price ?? 0))}</span>
                              </div>
                            ))}
                            {s && (s.empacado_at || s.salio_at || s.entregado_at) && (
                              <div style={{ color: 'var(--ink-2)', marginBottom: 4 }} data-testid="mis-ventas-traza">
                                {s.empacado_at && <div>✓ Empacado: {fechaHora(s.empacado_at)}</div>}
                                {s.salio_at && <div>✓ Salió del almacén: {fechaHora(s.salio_at)}{s.chofer ? ` · chofer ${s.chofer}` : ''}{s.guia ? ` · guía ${s.guia}` : ''}</div>}
                                {s.entregado_at && <div>✓ Entregado: {fechaHora(s.entregado_at)}{s.recibio ? ` · recibió ${s.recibio}` : ''}</div>}
                              </div>
                            )}
                            {Number(o.shipping_cost ?? 0) > 0 && (
                              <div style={{ display: 'flex', gap: 8, color: 'var(--ink-3)' }}>
                                <span style={{ flex: 1 }}>Envío</span>
                                <span className="mono" style={{ minWidth: 90, textAlign: 'right' }}>{money(Number(o.shipping_cost))}</span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
