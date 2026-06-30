// ADMIN · Contenido. Un solo lugar para editar lo que ve el cliente, sin abrir
// mil interfaces: el CATÁLOGO del Portal del Doctor (hoy, editable de punta a
// punta) y la LANDING pública (siguiente paso, mismo editor). El acceso se da
// con la capability "contenido" desde Equipo.
import React, { useMemo, useState } from 'react'
import { Plus, X, Eye, EyeOff, Pencil, Trash2, RotateCcw, ExternalLink } from 'lucide-react'
import { money } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { useCatalogAdmin, type ProductInput } from '../../data/hooks/useProducts'
import { useLanding, type LandingContent } from '../../data/hooks/useLanding'
import type { ProductSafe } from '../../data/types'

type Tab = 'productos' | 'landing'

export function Contenido() {
  const [tab, setTab] = useState<Tab>('productos')
  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Contenido">
        Dos superficies distintas, con público distinto: el <b>catálogo del Portal del Doctor</b>
        (lo ven solo doctores verificados, para comprar) y la <b>landing pública</b> (la ve cualquiera,
        para captar e informar). Puedes dar acceso a editar con la responsabilidad “Contenido” desde Equipo.
      </PageHead>

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button type="button" className={tab === 'productos' ? 'active' : undefined} onClick={() => setTab('productos')}>Catálogo · Portal del Doctor</button>
        <button type="button" className={tab === 'landing' ? 'active' : undefined} onClick={() => setTab('landing')}>Landing · Página pública</button>
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
  const { data, saveLanding, resetLanding } = useLanding()
  const [draft, setDraft] = useState<LandingContent>(data)
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof LandingContent>(k: K, v: LandingContent[K]) => { setDraft({ ...draft, [k]: v }); setSaved(false) }
  const setCert = (i: number, patch: Partial<{ label: string; sub: string }>) => {
    const certifications = draft.certifications.map((c, j) => (j === i ? { ...c, ...patch } : c))
    setDraft({ ...draft, certifications }); setSaved(false)
  }
  const addCert = () => setDraft({ ...draft, certifications: [...draft.certifications, { label: '', sub: '' }] })
  const delCert = (i: number) => setDraft({ ...draft, certifications: draft.certifications.filter((_, j) => j !== i) })

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* Propósito de la landing (nuevo rumbo): captación, no venta. */}
      <div className="sysnote" style={{ alignItems: 'flex-start' }}>
        <span>
          La landing <b>no vende ni muestra precios</b>: es para <b>captar e informar</b> (info + contacto +
          agente IA + formulario). La compra ocurre <b>después de verificar al doctor</b>, en el Portal.
          Embudo: <b>landing → Prospectos → verificación → Portal</b>.
        </span>
      </div>

      <div className="grid two" style={{ alignItems: 'start', gap: 16 }}>
      {/* Editor */}
      <div className="card">
        <div className="eyebrow" style={{ margin: '0 0 6px' }}>Página pública · captación</div>

        <label style={{ ...label, marginTop: 6 }}>Título de pestaña (SEO)</label>
        <input style={input} value={draft.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} />
        <label style={label}>Descripción (SEO)</label>
        <textarea style={{ ...input, minHeight: 56, resize: 'vertical' }} value={draft.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} />

        <label style={label}>Eyebrow (sobre el título)</label>
        <input style={input} value={draft.heroEyebrow} onChange={(e) => set('heroEyebrow', e.target.value)} />
        <label style={label}>Título principal</label>
        <input style={input} value={draft.heroTitle} onChange={(e) => set('heroTitle', e.target.value)} />
        <label style={label}>Subtítulo</label>
        <textarea style={{ ...input, minHeight: 64, resize: 'vertical' }} value={draft.heroSubtitle} onChange={(e) => set('heroSubtitle', e.target.value)} />

        <div className="form-grid-2">
          <div><label style={label}>Botón principal</label><input style={input} value={draft.ctaPrimary} onChange={(e) => set('ctaPrimary', e.target.value)} /></div>
          <div><label style={label}>Botón secundario</label><input style={input} value={draft.ctaSecondary} onChange={(e) => set('ctaSecondary', e.target.value)} /></div>
        </div>
        <div className="form-grid-2">
          <div><label style={label}>WhatsApp</label><input style={input} value={draft.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="52667…" /></div>
          <div><label style={label}>Correo de contacto</label><input style={input} value={draft.email} onChange={(e) => set('email', e.target.value)} /></div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginTop: 16 }}>
          <label style={{ ...label, marginTop: 0 }}>Certificaciones</label>
          <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={addCert}><Plus size={13} /> Agregar</button>
        </div>
        {draft.certifications.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...input, marginTop: 0, flex: '0 0 34%' }} value={c.label} onChange={(e) => setCert(i, { label: e.target.value })} placeholder="CE" />
            <input style={{ ...input, marginTop: 0, flex: 1 }} value={c.sub} onChange={(e) => setCert(i, { sub: e.target.value })} placeholder="Certificación EU" />
            <button className="btn ghost sm" type="button" onClick={() => delCert(i)}><Trash2 size={14} /></button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn ghost sm" type="button" onClick={() => { resetLanding(); setDraft({ ...data }); }}><RotateCcw size={14} /> Restaurar</button>
          <button className="btn" type="button" style={{ marginLeft: 'auto' }} onClick={() => { saveLanding(draft); setSaved(true) }}>Guardar y publicar</button>
        </div>
        {saved && <div className="sysnote" style={{ marginTop: 12, background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }}><span>Contenido guardado.</span></div>}

        <div className="sysnote" style={{ marginTop: 12, alignItems: 'flex-start' }}>
          <span>La landing es <b>data-driven</b>: lee su contenido por fuera. “Guardar y publicar” es el único punto de escritura; al conectar el backend, ahí se hace el guardado en la base y la página lo toma en vivo.</span>
        </div>
      </div>

      {/* Vista previa */}
      <div className="card" style={{ position: 'sticky', top: 90, overflow: 'hidden', background: 'linear-gradient(177deg,#1b2a26,#0e1714)', color: '#fff', border: 'none' }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--green-soft)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Eye size={13} /> Vista previa
        </div>
        <div style={{ fontSize: 11, letterSpacing: '.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)', marginTop: 18 }}>{draft.heroEyebrow}</div>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.1, marginTop: 8 }} dangerouslySetInnerHTML={{ __html: draft.heroTitle || 'Título principal' }} />
        <p style={{ fontSize: 13.5, color: 'rgba(255,255,255,.78)', lineHeight: 1.55, marginTop: 12 }}>{draft.heroSubtitle}</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <span style={{ background: 'var(--grad-green)', color: '#fff', borderRadius: 11, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{draft.ctaPrimary || 'CTA'}</span>
          <span style={{ border: '1px solid rgba(255,255,255,.3)', color: '#fff', borderRadius: 11, padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>{draft.ctaSecondary}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 22, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.12)' }}>
          {draft.certifications.map((c, i) => (
            <div key={i}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{c.label || '—'}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)', marginTop: 18 }}>
          WhatsApp {draft.whatsapp} · {draft.email}
        </div>
        <a href="/" target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--green-soft)', marginTop: 16, fontWeight: 600 }}>
          <ExternalLink size={13} /> Abrir landing real
        </a>
      </div>
      </div>
    </div>
  )
}
