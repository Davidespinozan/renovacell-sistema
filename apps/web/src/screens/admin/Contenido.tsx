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

// ---- Editor de la landing (todas las secciones, data-driven) ----------------
const fInput: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 5 }
const fLabel: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 12 }

function Fld({ label, value, onChange, hint, mono }: { label: string; value: string; onChange: (v: string) => void; hint?: string; mono?: boolean }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={fLabel}>{label}</span>
      <input style={{ ...fInput, fontFamily: mono ? 'monospace' : 'inherit' }} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  )
}
function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={fLabel}>{label}</span>
      <textarea style={{ ...fInput, minHeight: 60, resize: 'vertical' }} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
function SecCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="eyebrow" style={{ margin: '0 0 4px' }}>{title}</div>
      {children}
    </div>
  )
}

function LandingTab() {
  const { data, saveLanding, resetLanding } = useLanding()
  const [draft, setDraft] = useState<LandingContent>(data)
  const [saved, setSaved] = useState(false)

  const up = (patch: Partial<LandingContent>) => { setDraft((d) => ({ ...d, ...patch })); setSaved(false) }
  const upSec = (k: keyof LandingContent, patch: Record<string, unknown>) => { setDraft((d) => ({ ...d, [k]: { ...(d[k] as object), ...patch } })); setSaved(false) }

  // listas
  const setLink = (i: number, patch: Partial<{ label: string; href: string }>) => upSec('nav', { links: draft.nav.links.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const setTick = (i: number, v: string) => up({ ticker: draft.ticker.map((s, j) => (j === i ? v : s)) })
  const setCert = (i: number, patch: Partial<{ label: string; sub: string }>) => upSec('certifications', { items: draft.certifications.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setFeat = (i: number, patch: Partial<{ title: string; body: string }>) => upSec('features', { items: draft.features.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="sysnote" style={{ alignItems: 'flex-start' }}>
        <span>
          La landing es <b>data-driven</b>: todo lo que ves abajo dibuja la página pública. Es de <b>captación</b>
          (info + formulario + contacto), no de venta. Embudo: <b>landing → Prospectos → verificación → Portal</b>.
          Imágenes/logo por URL hoy; subir archivo entra con Storage.
        </span>
      </div>

      <SecCard title="SEO (buscadores)">
        <Fld label="Título de pestaña" value={draft.seo.title} onChange={(v) => upSec('seo', { title: v })} />
        <Area label="Descripción" value={draft.seo.description} onChange={(v) => upSec('seo', { description: v })} />
      </SecCard>

      <SecCard title="Marca y logo">
        <div className="form-grid-2">
          <Fld label="Nombre" value={draft.brand.name} onChange={(v) => upSec('brand', { name: v })} />
          <Fld label="Tagline" value={draft.brand.tagline} onChange={(v) => upSec('brand', { tagline: v })} />
        </div>
        <Fld label="Logo (URL)" value={draft.brand.logoUrl} onChange={(v) => upSec('brand', { logoUrl: v })} mono hint="Pega una URL de imagen. El subir archivo llega con Storage." />
      </SecCard>

      <SecCard title="Navegación">
        {draft.nav.links.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...fInput, marginTop: 0, flex: 1 }} value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} placeholder="Etiqueta" />
            <input style={{ ...fInput, marginTop: 0, flex: 1, fontFamily: 'monospace' }} value={l.href} onChange={(e) => setLink(i, { href: e.target.value })} placeholder="#seccion" />
            <button className="btn ghost sm" type="button" onClick={() => upSec('nav', { links: draft.nav.links.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => upSec('nav', { links: [...draft.nav.links, { label: '', href: '#' }] })}><Plus size={13} /> Agregar enlace</button>
        <Fld label="Botón (CTA)" value={draft.nav.cta} onChange={(v) => upSec('nav', { cta: v })} />
      </SecCard>

      <SecCard title="Hero (encabezado)">
        <Fld label="Eyebrow" value={draft.hero.eyebrow} onChange={(v) => upSec('hero', { eyebrow: v })} />
        <Fld label="Título (admite HTML, p. ej. <span class=&quot;green&quot;>)" value={draft.hero.title} onChange={(v) => upSec('hero', { title: v })} />
        <Area label="Subtítulo" value={draft.hero.subtitle} onChange={(v) => upSec('hero', { subtitle: v })} />
        <div className="form-grid-2">
          <Fld label="Botón principal" value={draft.hero.ctaPrimary} onChange={(v) => upSec('hero', { ctaPrimary: v })} />
          <Fld label="Botón secundario" value={draft.hero.ctaSecondary} onChange={(v) => upSec('hero', { ctaSecondary: v })} />
        </div>
        <Fld label="Imagen del hero (URL)" value={draft.hero.imageUrl} onChange={(v) => upSec('hero', { imageUrl: v })} mono />
      </SecCard>

      <SecCard title="Ticker (cinta)">
        {draft.ticker.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...fInput, marginTop: 0, flex: 1 }} value={s} onChange={(e) => setTick(i, e.target.value)} />
            <button className="btn ghost sm" type="button" onClick={() => up({ ticker: draft.ticker.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => up({ ticker: [...draft.ticker, ''] })}><Plus size={13} /> Agregar</button>
      </SecCard>

      <SecCard title="Ciencia / Info">
        <Fld label="Eyebrow" value={draft.info.eyebrow} onChange={(v) => upSec('info', { eyebrow: v })} />
        <Fld label="Título" value={draft.info.title} onChange={(v) => upSec('info', { title: v })} />
        <Area label="Texto" value={draft.info.body} onChange={(v) => upSec('info', { body: v })} />
        <Fld label="Imagen (URL)" value={draft.info.imageUrl} onChange={(v) => upSec('info', { imageUrl: v })} mono />
      </SecCard>

      <SecCard title="Certificaciones">
        <Fld label="Eyebrow" value={draft.certifications.eyebrow} onChange={(v) => upSec('certifications', { eyebrow: v })} />
        <Fld label="Título" value={draft.certifications.title} onChange={(v) => upSec('certifications', { title: v })} />
        {draft.certifications.items.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input style={{ ...fInput, marginTop: 0, flex: '0 0 34%' }} value={c.label} onChange={(e) => setCert(i, { label: e.target.value })} placeholder="CE" />
            <input style={{ ...fInput, marginTop: 0, flex: 1 }} value={c.sub} onChange={(e) => setCert(i, { sub: e.target.value })} placeholder="Certificación EU" />
            <button className="btn ghost sm" type="button" onClick={() => upSec('certifications', { items: draft.certifications.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => upSec('certifications', { items: [...draft.certifications.items, { label: '', sub: '' }] })}><Plus size={13} /> Agregar</button>
      </SecCard>

      <SecCard title="Para médicos (features)">
        <Fld label="Eyebrow" value={draft.features.eyebrow} onChange={(v) => upSec('features', { eyebrow: v })} />
        <Fld label="Título" value={draft.features.title} onChange={(v) => upSec('features', { title: v })} />
        {draft.features.items.map((c, i) => (
          <div key={i} style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><Fld label={`Tarjeta ${i + 1}`} value={c.title} onChange={(v) => setFeat(i, { title: v })} /></div>
              <button className="btn ghost sm" type="button" onClick={() => upSec('features', { items: draft.features.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
            <Area label="Texto" value={c.body} onChange={(v) => setFeat(i, { body: v })} />
          </div>
        ))}
        <button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => upSec('features', { items: [...draft.features.items, { title: '', body: '' }] })}><Plus size={13} /> Agregar tarjeta</button>
      </SecCard>

      <SecCard title="Captación (formulario)">
        <Fld label="Eyebrow" value={draft.lead.eyebrow} onChange={(v) => upSec('lead', { eyebrow: v })} />
        <Fld label="Título" value={draft.lead.title} onChange={(v) => upSec('lead', { title: v })} />
        <Area label="Texto" value={draft.lead.body} onChange={(v) => upSec('lead', { body: v })} />
        <div className="form-grid-2">
          <Fld label="Botón de envío" value={draft.lead.submitLabel} onChange={(v) => upSec('lead', { submitLabel: v })} />
          <Fld label="Mensaje de éxito" value={draft.lead.successText} onChange={(v) => upSec('lead', { successText: v })} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>El formulario captará leads hacia Prospectos al conectar el backend.</div>
      </SecCard>

      <SecCard title="Contacto">
        <Fld label="Título" value={draft.contact.title} onChange={(v) => upSec('contact', { title: v })} />
        <div className="form-grid-2">
          <Fld label="WhatsApp (número)" value={draft.contact.whatsapp} onChange={(v) => upSec('contact', { whatsapp: v })} mono />
          <Fld label="Correo" value={draft.contact.email} onChange={(v) => upSec('contact', { email: v })} />
        </div>
        <Fld label="Ubicación" value={draft.contact.address} onChange={(v) => upSec('contact', { address: v })} />
      </SecCard>

      <SecCard title="Footer">
        <Fld label="Texto" value={draft.footer.text} onChange={(v) => upSec('footer', { text: v })} />
      </SecCard>

      <div className="card" style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ghost sm" type="button" onClick={() => { resetLanding(); setDraft({ ...data }); }}><RotateCcw size={14} /> Restaurar</button>
        <a className="btn ghost sm" href="/" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir landing</a>
        <button className="btn" type="button" style={{ marginLeft: 'auto' }} onClick={() => { saveLanding(draft); setSaved(true) }}>Guardar y publicar</button>
        {saved && <span style={{ fontSize: 12.5, color: 'var(--green-deep)', fontWeight: 600 }}>Guardado ✓</span>}
      </div>
    </div>
  )
}
