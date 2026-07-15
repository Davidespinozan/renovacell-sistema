// VENDEDOR · Mi inventario (consignación). Lo que trae consigo para vender
// directo. Almacén se lo asigna; vende desde Clientes → "Venta directa".
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useProducts } from '../../data/hooks/useProducts'
import { useConsigna, remaining } from '../../data/hooks/useConsigna'
import { LOW_CONSIGNA, requestRestock } from '../../data/store/consignaStore'
import { useRole } from '../../auth/RoleContext'

export function MiConsigna() {
  const { user, role } = useRole()
  const { data: consigna } = useConsigna()
  const { data: products } = useProducts()
  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products])
  // Productos ya solicitados en esta sesión (para no pedir dos veces el mismo).
  const [requested, setRequested] = useState<Set<string>>(new Set())

  // Admin ve todas las consignaciones; vendedor solo la suya.
  const mine = role === 'admin' ? Object.entries(consigna) : [[user?.email ?? '', consigna[user?.email ?? ''] ?? []] as const]

  // El botón "Pedir reabasto" es para el vendedor sobre SU inventario (no admin).
  const canRequest = role === 'pos'
  const askRestock = (vendor: string, productId: string) => {
    requestRestock(vendor, productId, prodName[productId] ?? 'producto')
    setRequested((s) => new Set(s).add(productId))
  }
  const lowCount = canRequest
    ? (consigna[user?.email ?? ''] ?? []).filter((it) => remaining(it) <= LOW_CONSIGNA).length
    : 0

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Mi inventario">
        Lo que traes en <b>consignación</b> para vender directo a tus clientes. Almacén te lo asigna;
        para vender, entra a <b>Clientes → Venta directa</b>. Lo que no vendas, lo regresas cuando quieras.
      </PageHead>

      {!mine.every(([, items]) => (items ?? []).length === 0) && (
        <div style={{ display: 'flex' }}>
          <ExportButton
            name="mi-inventario"
            style={{ marginLeft: 'auto' }}
            rows={mine.flatMap(([vendor, items]) => (items ?? []).map((it) => ({ vendedor: vendor, producto: prodName[it.product_id] ?? 'Producto', asignado: it.assigned, vendido: it.sold, trae: remaining(it) })))}
            columns={[
              { key: 'vendedor', label: 'Vendedor' },
              { key: 'producto', label: 'Producto' },
              { key: 'asignado', label: 'Asignado' },
              { key: 'vendido', label: 'Vendido' },
              { key: 'trae', label: 'Trae (saldo)' },
            ]}
          />
        </div>
      )}

      {lowCount > 0 && (
        <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="box" />
          <span><b>{lowCount} producto(s) con saldo bajo</b> ({LOW_CONSIGNA} o menos). Pide reabasto a Almacén con el botón de cada renglón.</span>
        </div>
      )}

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
                <thead><tr><th>Producto</th><th>Asignado</th><th>Vendido</th><th>Traes</th>{canRequest && <th></th>}</tr></thead>
                <tbody>
                  {(items ?? []).map((it) => {
                    const rem = remaining(it)
                    const low = rem <= LOW_CONSIGNA
                    return (
                      <tr key={it.product_id}>
                        <td data-label="Producto">{prodName[it.product_id] ?? 'Producto'}</td>
                        <td data-label="Asignado" className="mono">{it.assigned}</td>
                        <td data-label="Vendido" className="mono">{it.sold}</td>
                        <td data-label="Traes"><span className={'pill ' + (low ? 'p-warn' : 'p-ok')}>{rem}{low && ' · bajo'}</span></td>
                        {canRequest && (
                          <td data-label="" style={{ textAlign: 'right' }}>
                            {requested.has(it.product_id) ? (
                              <span className="pill p-ok"><Icon name="check" /> Solicitado</span>
                            ) : low ? (
                              <button className="btn ghost sm" type="button" onClick={() => askRestock(vendor as string, it.product_id)}>
                                <Icon name="box" /> Pedir reabasto
                              </button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ))}
    </div>
  )
}
