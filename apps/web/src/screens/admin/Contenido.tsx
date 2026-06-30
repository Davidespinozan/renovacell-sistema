// ADMIN · Contenido. Un solo lugar para editar lo que ve el cliente, sin abrir
// mil interfaces: el CATÁLOGO del Portal del Doctor (hoy, editable de punta a
// punta) y la LANDING pública (siguiente paso, mismo editor). El acceso se da
// con la capability "contenido" desde Equipo.
import React, { useMemo, useState } from 'react'
import { Plus, X, Eye, EyeOff, Pencil } from 'lucide-react'
import { money } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useCatalogAdmin, type ProductInput } from '../../data/hooks/useProducts'
import type { ProductSafe } from '../../data/types'

type Tab = 'productos' | 'landing'

export function Contenido() {
  const [tab, setTab] = useState<Tab>('productos')
  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Contenido">
        Edita lo que ve el cliente desde un solo lugar: el catálogo del Portal del Doctor y,
        próximamente, la landing pública. Puedes dar acceso a otra persona con la responsabilidad
        “Contenido” desde Equipo.
      </PageHead>

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={tab === 'productos' ? 'active' : undefined} onClick={() => setTab('productos')}>Productos</button>
        <button type="button" className={tab === 'landing' ? 'active' : undefined} onClick={() => setTab('landing')}>Landing</button>
      </div>

      {tab === 'productos' ? <ProductsEditor /> : <LandingTab />}
    </div>
  )
}

function ProductsEditor() {
  const { data, createProduct, updateProduct, toggleActive } = useCatalogAdmin()
  const [editing, setEditing] = useState<ProductSafe | 'new' | null>(null)

  const groups = useMemo(() => ({
    cosm: data.filter((p) => p.line === 'cosm'),
    prof: data.filter((p) => p.line === 'prof'),
  }), [data])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="eyebrow" style={{ margin: 0 }}>{data.length} productos</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}><Plus size={14} /> Nuevo producto</button>
      </div>

      <Section title="Home Care" items={groups.cosm} onEdit={setEditing} onToggle={toggleActive} />
      <Section title="Professional" items={groups.prof} onEdit={setEditing} onToggle={toggleActive} />

      {editing && (
        <ProductModal
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            if (editing === 'new') createProduct(input)
            else updateProduct(editing.id, input)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function Section({ title, items, onEdit, onToggle }: {
  title: string
  items: ProductSafe[]
  onEdit: (p: ProductSafe) => void
  onToggle: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '14px 16px 0' }}><div className="eyebrow" style={{ margin: 0 }}>{title}</div></div>
      <div style={{ padding: '8px 14px 10px' }}>
        <table className="tbl-cards">
          <thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {items.map((p) => {
              const hidden = p.active === false
              return (
                <tr key={p.id} style={hidden ? { opacity: 0.6 } : undefined}>
                  <td data-label="Producto"><b>{p.name}</b> <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{p.sku}</span></td>
                  <td data-label="Categoría" style={{ color: 'var(--ink-2)' }}>{p.category}</td>
                  <td data-label="Precio" className="mono">{p.price == null ? '—' : money(p.price)}</td>
                  <td data-label="Estado"><span className={'pill ' + (hidden ? 'p-neu' : 'p-ok')}>{hidden ? 'Oculto' : 'Visible'}</span></td>
                  <td data-label="" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" type="button" onClick={() => onToggle(p.id)} title={hidden ? 'Mostrar en el catálogo' : 'Ocultar del catálogo'}>
                      {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button className="btn ghost sm" type="button" style={{ marginLeft: 6 }} onClick={() => onEdit(p)}><Pencil size={14} /> Editar</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProductModal({ product, onClose, onSave }: {
  product: ProductSafe | null
  onClose: () => void
  onSave: (input: ProductInput) => void
}) {
  const [name, setName] = useState(product?.name ?? '')
  const [sku, setSku] = useState(product?.sku ?? '')
  const [line, setLine] = useState<'cosm' | 'prof'>((product?.line as 'cosm' | 'prof') ?? 'cosm')
  const [category, setCategory] = useState(product?.category ?? '')
  const [price, setPrice] = useState(product?.price != null ? String(product.price) : '')
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [active, setActive] = useState(product?.active !== false)

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  const priceNum = price.trim() === '' ? null : Number(price)
  const valid = name.trim() !== '' && (priceNum === null || priceNum >= 0)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>{product ? 'Editar producto' : 'Nuevo producto'}</h3><div className="ms">Lo que cambies aquí lo ve el doctor en su catálogo.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del producto" />

          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div>
              <label style={label}>Línea</label>
              <select style={input} value={line} onChange={(e) => setLine(e.target.value as 'cosm' | 'prof')}>
                <option value="cosm">Home Care</option>
                <option value="prof">Professional</option>
              </select>
            </div>
            <div>
              <label style={label}>SKU</label>
              <input style={input} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Ej. MGP-90" />
            </div>
          </div>

          <div className="form-grid-2">
            <div>
              <label style={label}>Categoría</label>
              <input style={input} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej. Mascarilla facial" />
            </div>
            <div>
              <label style={label}>Precio (MXN)</label>
              <input style={input} type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
            </div>
          </div>

          <label style={label}>Imagen (URL)</label>
          <input style={input} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="/products/archivo.webp" />

          <label style={label}>Descripción</label>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción que ve el doctor" />

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Visible en el catálogo del doctor
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => onSave({ name: name.trim(), sku: sku.trim(), line, category: category.trim(), description: description.trim(), price: priceNum, image_url: imageUrl.trim() || null, active })}>
              {product ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function LandingTab() {
  return (
    <div className="card">
      <div className="sysnote" style={{ alignItems: 'flex-start' }}>
        <span>
          <b>Editor de la landing — siguiente paso.</b> Aquí editarás los textos, imágenes y secciones
          de la página pública con este mismo editor. La landing es una app aparte (hoy estática): el
          editor funciona en cuanto lo construya, y la página pública lo consume en vivo al conectar el
          backend (fase Supabase).
        </span>
      </div>
    </div>
  )
}
