// VENTAS DEL EVENTO / DE MI CUSTODIA. Lo que se vendió desde una custodia, leído del
// libro de custodia (no de un contador): producto, lote, cantidad y precio del servidor.
// Cada venta es un pedido real con su cobro en el libro de dinero.
import React, { useMemo, useState } from 'react'
import { money, fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useProducts } from '../../data/hooks/useProducts'
import { useUsers } from '../../data/hooks/useUsers'
import { useCustodies, useCustodyLines } from '../../data/hooks/useCustody'
import type { Custody } from '../../data/ops/custody'

export function VentasEvento() {
  const { data: custodias, loading } = useCustodies()
  const { data: lines } = useCustodyLines()
  const { data: products } = useProducts()
  const { data: users } = useUsers({ staffOnly: true })
  const [sel, setSel] = useState<string>('')

  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const userName = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string>, [users])
  const etiqueta = (c: Custody): string =>
    c.kind === 'evento' ? `Evento · ${c.event_name ?? 'sin nombre'}`
      : `Consignación · ${c.holder_user_id ? (userName[c.holder_user_id] ?? 'vendedor') : 'tercero'}`

  const ventas = useMemo(
    () => lines.filter((l) => l.kind === 'venta' && (!sel || l.custody_id === sel)),
    [lines, sel])
  const unidades = ventas.reduce((s, l) => s + l.qty, 0)
  const importe = ventas.reduce((s, l) => s + l.qty * (l.unit_price ?? 0), 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Ventas desde custodia">
        Lo vendido desde eventos y consignación. Cada renglón es una venta real: tiene pedido,
        salida de inventario del lote y cobro registrado.
      </PageHead>

      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={sel} onChange={(e) => setSel(e.target.value)}
            style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13, background: 'var(--cp-surface)' }}>
            <option value="">Todas las custodias</option>
            {custodias.map((c) => <option key={c.id} value={c.id}>{etiqueta(c)}</option>)}
          </select>
          <span className="pill p-neu">{unidades} unidades</span>
          <span className="pill p-ok">{money(importe)}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '10px 14px 14px' }}>
          {loading ? <div style={{ color: 'var(--ink-3)' }}>Cargando…</div>
            : ventas.length === 0 ? <div style={{ color: 'var(--ink-3)' }}>Todavía no hay ventas desde custodia.</div>
              : (
                <table className="tbl-cards">
                  <thead><tr><th>Fecha</th><th>Custodia</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th></tr></thead>
                  <tbody>
                    {ventas.map((l) => {
                      const c = custodias.find((x) => x.id === l.custody_id)
                      return (
                        <tr key={l.id}>
                          <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.created_at)}</td>
                          <td data-label="Custodia">{c ? etiqueta(c) : '—'}</td>
                          <td data-label="Producto">{prodName[l.product_id] ?? 'Producto'}</td>
                          <td data-label="Cant." className="mono">{l.qty}</td>
                          <td data-label="Precio" className="mono">{money(l.unit_price ?? 0)}</td>
                          <td data-label="Importe" className="mono">{money(l.qty * (l.unit_price ?? 0))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
        </div>
      </div>
    </div>
  )
}
