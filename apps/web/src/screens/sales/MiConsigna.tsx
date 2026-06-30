// VENDEDOR · Mi inventario (consignación). Lo que trae consigo para vender
// directo. Almacén se lo asigna; vende desde Clientes → "Venta directa".
import React, { useMemo } from 'react'
import { PageHead } from '../../app/PageHead'
import { useProducts } from '../../data/hooks/useProducts'
import { useConsigna, remaining } from '../../data/hooks/useConsigna'
import { useRole } from '../../auth/RoleContext'

export function MiConsigna() {
  const { user, role } = useRole()
  const { data: consigna } = useConsigna()
  const { data: products } = useProducts()
  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products])

  // Admin ve todas las consignaciones; vendedor solo la suya.
  const mine = role === 'admin' ? Object.entries(consigna) : [[user?.email ?? '', consigna[user?.email ?? ''] ?? []] as const]

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Mi inventario">
        Lo que traes en <b>consignación</b> para vender directo a tus clientes. Almacén te lo asigna;
        para vender, entra a <b>Clientes → Venta directa</b>. Lo que no vendas, lo regresas cuando quieras.
      </PageHead>

      {mine.every(([, items]) => (items ?? []).length === 0) ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No traes producto en consignación. Pídele a Almacén que te asigne inventario.
        </div>
      ) : mine.map(([vendor, items]) => (
        (items ?? []).length === 0 ? null : (
          <div key={vendor} className="card" style={{ padding: 0 }}>
            {role === 'admin' && <div style={{ padding: '14px 16px 0' }}><div className="eyebrow" style={{ margin: 0 }}>{vendor}</div></div>}
            <div style={{ padding: '8px 14px' }}>
              <table className="tbl-cards">
                <thead><tr><th>Producto</th><th>Asignado</th><th>Vendido</th><th>Traes</th></tr></thead>
                <tbody>
                  {(items ?? []).map((it) => (
                    <tr key={it.product_id}>
                      <td data-label="Producto">{prodName[it.product_id] ?? 'Producto'}</td>
                      <td data-label="Asignado" className="mono">{it.assigned}</td>
                      <td data-label="Vendido" className="mono">{it.sold}</td>
                      <td data-label="Traes"><span className={'pill ' + (remaining(it) > 0 ? 'p-ok' : 'p-neu')}>{remaining(it)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ))}
    </div>
  )
}
