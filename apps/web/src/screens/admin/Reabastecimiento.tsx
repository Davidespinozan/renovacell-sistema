// COMPRAS / REABASTECIMIENTO (Logística + Dirección). Stock por producto con
// sugerencia de reorden cuando está bajo, y órdenes de compra a proveedor.
// El alta de inventario al recibir se hace en Almacén → Entradas (lote+caducidad).
import React, { useMemo } from 'react'
import { ShoppingCart, PackageCheck, AlertTriangle } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { useCompras } from '../../data/hooks/useCompras'

const LOW = 20      // umbral de stock bajo
const TARGET = 60   // stock objetivo tras reorden

export function Reabastecimiento() {
  const { data: lots } = useLots()
  const { data: products } = useProducts()
  const { data: pos, createPurchase, markReceived } = useCompras()

  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>()
    lots.forEach((l) => m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.quantity))
    return m
  }, [lots])

  // Sugerencias: productos con stock <= umbral (con lotes registrados).
  const sugerencias = useMemo(
    () => products
      .map((p) => ({ p, stock: stockByProduct.get(p.id) ?? 0, hasLots: stockByProduct.has(p.id) }))
      .filter((x) => (x.hasLots || x.p.price != null) && x.stock <= LOW)
      .sort((a, b) => a.stock - b.stock),
    [products, stockByProduct],
  )

  const pendientePO = (productId: string) => pos.some((o) => o.product_id === productId && o.status === 'solicitada')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Logística · Compras y reabastecimiento</div>

      {/* Sugerencias de reorden */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={16} style={{ color: 'var(--warn)' }} />
          <div className="eyebrow" style={{ margin: 0 }}>Sugerencias de reorden (stock ≤ {LOW} u)</div>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Stock</th><th>Estado</th><th>Sugerido</th><th></th></tr></thead>
            <tbody>
              {sugerencias.map(({ p, stock }) => {
                const sugerido = Math.max(TARGET - stock, 10)
                const agotado = stock <= 0
                return (
                  <tr key={p.id}>
                    <td data-label="Producto">{p.name}</td>
                    <td data-label="Stock" className="mono">{stock} u</td>
                    <td data-label="Estado"><span className={'pill ' + (agotado ? 'p-dang' : 'p-warn')}>{agotado ? 'Agotado' : 'Bajo'}</span></td>
                    <td data-label="Sugerido" className="mono">+{sugerido} u</td>
                    <td data-label="">
                      {pendientePO(p.id)
                        ? <span className="pill p-blue">Ya solicitada</span>
                        : <button className="btn sm" type="button" onClick={() => createPurchase({ product_id: p.id, product_name: p.name, qty: sugerido })}><ShoppingCart size={14} /> Solicitar compra</button>}
                    </td>
                  </tr>
                )
              })}
              {sugerencias.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Stock saludable · sin reorden sugerido. 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Órdenes de compra */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 6px' }}><div className="eyebrow" style={{ margin: 0 }}>Órdenes de compra</div></div>
        <div style={{ padding: '0 14px 8px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {pos.map((o) => (
                <tr key={o.id}>
                  <td data-label="Producto">{o.product_name}</td>
                  <td data-label="Cantidad" className="mono">{o.qty} u</td>
                  <td data-label="Fecha">{fmtDate(o.created_at)}</td>
                  <td data-label="Estado"><span className={'pill ' + (o.status === 'recibida' ? 'p-ok' : 'p-warn')}>{o.status === 'recibida' ? 'Recibida' : 'Solicitada'}</span></td>
                  <td data-label="">
                    {o.status === 'solicitada'
                      ? <button className="btn ghost sm" type="button" onClick={() => markReceived(o.id)}><PackageCheck size={14} /> Marcar recibida</button>
                      : <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Da de alta el lote en Entradas</span>}
                  </td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Aún no hay órdenes de compra.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
