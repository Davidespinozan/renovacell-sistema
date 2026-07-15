// ALMACÉN · Consignación. Asigna producto a un vendedor (descuenta del central,
// FEFO), ve el saldo de cada vendedor y recibe devoluciones. Modelo de saldo
// permanente: no hay cierre diario.
import React, { useMemo, useState } from 'react'
import { Plus, X, PackagePlus, Undo2 } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useConsigna, remaining } from '../../data/hooks/useConsigna'
import { useTeam } from '../../data/hooks/useTeam'
import type { ProductSafe } from '../../data/types'

export function Consigna() {
  const { data: consigna, assignToVendor, returnToWarehouse } = useConsigna()
  const { data: products } = useProducts()
  const { data: team } = useTeam()
  const [assignOpen, setAssignOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const vendors = team.filter((u) => u.active && u.role === 'pos')
  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products])
  const vendorName = (email: string) => team.find((u) => u.email === email)?.name.split('·')[0].trim() ?? email
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400) }

  const conVendors = Object.entries(consigna).filter(([, items]) => (items ?? []).length > 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Consignación">
        Producto que entregas a un vendedor para que venda en campo. Se descuenta del almacén al asignarlo
        y queda en su saldo; el vendedor regresa lo que no venda cuando quiera.
      </PageHead>

      <div style={{ display: 'flex', gap: 10 }}>
        <ExportButton
          name="consignacion"
          style={{ marginLeft: 'auto' }}
          rows={conVendors.flatMap(([vendor, items]) => (items ?? []).map((it) => ({ vendedor: vendorName(vendor), producto: prodName[it.product_id] ?? 'Producto', asignado: it.assigned, vendido: it.sold, trae: remaining(it) })))}
          columns={[
            { key: 'vendedor', label: 'Vendedor' },
            { key: 'producto', label: 'Producto' },
            { key: 'asignado', label: 'Asignado' },
            { key: 'vendido', label: 'Vendido' },
            { key: 'trae', label: 'Trae (saldo)' },
          ]}
        />
        <button className="btn sm" type="button" onClick={() => setAssignOpen(true)}><PackagePlus size={14} /> Asignar a vendedor</button>
      </div>

      {conVendors.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Nadie trae consignación todavía.</div>
      ) : conVendors.map(([vendor, items]) => (
        <div key={vendor} className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 16px 0' }}><div className="eyebrow" style={{ margin: 0 }}>{vendorName(vendor)}</div></div>
          <div style={{ padding: '8px 14px' }}>
            <table className="tbl-cards">
              <thead><tr><th>Producto</th><th>Asignado</th><th>Vendido</th><th>Trae</th><th></th></tr></thead>
              <tbody>
                {(items ?? []).map((it) => (
                  <tr key={it.product_id}>
                    <td data-label="Producto">{prodName[it.product_id] ?? 'Producto'}</td>
                    <td data-label="Asignado" className="mono">{it.assigned}</td>
                    <td data-label="Vendido" className="mono">{it.sold}</td>
                    <td data-label="Trae" className="mono">{remaining(it)}</td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      {remaining(it) > 0 && (
                        <button className="btn ghost sm" type="button" onClick={() => { const n = Number(window.prompt(`¿Cuántas unidades regresa ${vendorName(vendor)}?`, String(remaining(it)))); if (n > 0) { returnToWarehouse(vendor, it.product_id, Math.min(n, remaining(it))); flash('Devolución recibida') } }}>
                          <Undo2 size={14} /> Recibir devolución
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {assignOpen && (
        <AssignModal
          vendors={vendors.map((v) => ({ email: v.email, name: v.name.split('·')[0].trim() }))}
          products={products.filter((p) => p.price != null && isActiveProduct(p))}
          onClose={() => setAssignOpen(false)}
          onAssign={(vendor, productId, qty) => {
            const res = assignToVendor(vendor, productId, qty)
            if (res.ok) { setAssignOpen(false); flash('Consignación asignada') }
            return res
          }}
        />
      )}
      {toast && <div className="toast show">{toast}</div>}
    </div>
  )
}

function AssignModal({ vendors, products, onClose, onAssign }: {
  vendors: { email: string; name: string }[]
  products: ProductSafe[]
  onClose: () => void
  onAssign: (vendor: string, productId: string, qty: number) => { ok: boolean; missing?: number }
}) {
  const [vendor, setVendor] = useState(vendors[0]?.email ?? '')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [qty, setQty] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const n = Math.max(0, parseInt(qty, 10) || 0)
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  const save = () => {
    if (!vendor || !productId || n <= 0) return
    const res = onAssign(vendor, productId, n)
    if (!res.ok) setErr(res.missing != null ? `Sin stock suficiente — faltan ${res.missing} u en almacén.` : 'No se pudo asignar.')
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><div><h3>Asignar consignación</h3><div className="ms">Sale del almacén (FEFO) y queda en el saldo del vendedor.</div></div><button className="mclose" type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Vendedor</label>
          <select style={input} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {vendors.length === 0 && <option value="">Sin vendedores</option>}
            {vendors.map((v) => <option key={v.email} value={v.email}>{v.name}</option>)}
          </select>
          <label style={label}>Producto</label>
          <select style={input} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label style={label}>Cantidad</label>
          <input style={input} type="number" min={1} value={qty} onChange={(e) => { setQty(e.target.value); setErr(null) }} placeholder="0" />
          {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!vendor || n <= 0} style={!vendor || n <= 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}><Plus size={15} /> Asignar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
