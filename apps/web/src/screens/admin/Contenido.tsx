// ADMIN · Contenido. Un solo lugar para editar lo que ve el cliente, sin abrir
// mil interfaces: el CATÁLOGO del Portal del Doctor (hoy, editable de punta a
// punta) y la LANDING pública (siguiente paso, mismo editor). El acceso se da
// con la capability "contenido" desde Equipo.
import React, { useEffect, useMemo, useState } from 'react'
import { Plus, X, Eye, EyeOff, Pencil, Trash2, RotateCcw } from 'lucide-react'
import { money } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { ImageField } from '../../app/ImageField'
import { useCatalogAdmin, type ProductInput } from '../../data/hooks/useProducts'
import { getProductCost, setProductCost } from '../../data/store/productsStore'
import { reloadInventory } from '../../data/store/lotsStore'
import { useLanding, type LandingContent, type HeroSlide } from '../../data/hooks/useLanding'
import type { ProductSafe } from '../../data/types'

// Pantalla "Catálogo" (Comercial): edita los productos del Portal del Doctor.
export function CatalogoAdmin() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Catálogo">
        Lo que ven los doctores <b>verificados</b> en su portal para comprar. Crea, edita precios
        y muestra/oculta productos; el Portal lo refleja al instante.
      </PageHead>
      <ProductsEditor />
    </div>
  )
}

// Pantalla "Sitio web" (Comercial): edita la landing pública (captación).
export function SitioWeb() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Sitio web">
        La página pública (landing): <b>captación e información</b>, no venta. Edítala completa abajo;
        el embudo es landing → Prospectos → verificación → Portal.
      </PageHead>
      <LandingTab />
    </div>
  )
}

function ProductsEditor() {
  const { data, createProduct, updateProduct, toggleActive, deleteProduct } = useCatalogAdmin()
  const [editing, setEditing] = useState<ProductSafe | 'new' | null>(null)

  const onDelete = async (p: ProductSafe) => {
    if (!window.confirm(`¿Eliminar "${p.name}" del catálogo? Si ya tuvo pedidos, mejor ocúltalo.`)) return
    const r = await deleteProduct(p.id)
    if (!r.ok) window.alert(r.error ?? 'No se pudo eliminar.')
  }

  const groups = useMemo(() => ({
    cosm: data.filter((p) => p.line === 'cosm'),
    prof: data.filter((p) => p.line === 'prof'),
  }), [data])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="eyebrow" style={{ margin: 0 }}>{data.length} productos</div>
        <ExportButton name="catalogo" rows={data} style={{ marginLeft: 'auto', marginRight: 10 }} columns={[
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Nombre' },
          { key: 'line', label: 'Línea', format: (v) => (v === 'cosm' ? 'Home Care' : 'Professional') },
          { key: 'category', label: 'Categoría' },
          { key: 'price', label: 'Precio', format: (v) => money(v as number) },
          { key: 'active', label: 'Estado', format: (v) => (v ? 'Visible' : 'Oculto') },
        ]} />
        <button className="btn sm" type="button" onClick={() => setEditing('new')}><Plus size={14} /> Nuevo producto</button>
      </div>

      <Section title="Home Care" items={groups.cosm} onEdit={setEditing} onToggle={toggleActive} onDelete={onDelete} />
      <Section title="Professional" items={groups.prof} onEdit={setEditing} onToggle={toggleActive} onDelete={onDelete} />

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

function Section({ title, items, onEdit, onToggle, onDelete }: {
  title: string
  items: ProductSafe[]
  onEdit: (p: ProductSafe) => void
  onToggle: (id: string) => void
  onDelete: (p: ProductSafe) => void
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
                    <button className="btn ghost sm" type="button" style={{ marginLeft: 6, color: 'var(--danger)' }} title="Eliminar producto" onClick={() => onDelete(p)}><Trash2 size={14} /></button>
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
  // El costo no viene con el producto: vive en otra tabla y se pide aparte.
  const [cost, setCost] = useState('')
  const [costLoading, setCostLoading] = useState(Boolean(product))
  useEffect(() => {
    if (!product) { setCostLoading(false); return }
    let vivo = true
    getProductCost(product.id).then((c) => { if (vivo) { setCost(c == null ? '' : String(c)); setCostLoading(false) } })
    return () => { vivo = false }
  }, [product])

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

          <div className="form-grid-2">
            <div>
              <label style={label}>Costo (MXN)</label>
              <input style={input} type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)}
                placeholder={costLoading ? 'Cargando…' : 'Sin costo registrado'} disabled={costLoading} />
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.45 }}>
                Solo lo ven Dirección y Facturación. Alimenta el margen en Finanzas; el doctor nunca lo ve.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <ImageField label="Imagen del producto" value={imageUrl} onChange={setImageUrl} folder="catalog" ratio="4 / 3"
              hint="Se ve en el catálogo del doctor y en la ficha de la página pública." />
          </div>

          <label style={label}>Descripción</label>
          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción que ve el doctor" />

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Visible en el catálogo del doctor
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => {
                onSave({ name: name.trim(), sku: sku.trim(), line, category: category.trim(), description: description.trim(), price: priceNum, image_url: imageUrl.trim() || null, active })
                // El costo va a `product_costs`, no a `products`: se guarda aparte.
                if (product) {
                  const c = cost.trim() === '' ? null : Number(cost)
                  if (c == null || Number.isFinite(c)) {
                    void setProductCost(product.id, c, name.trim()).then(reloadInventory)
                  }
                }
              }}>
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

function Fld({ label, value, onChange, hint, mono, type }: { label: string; value: string; onChange: (v: string) => void; hint?: string; mono?: boolean; type?: string }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={fLabel}>{label}</span>
      <input type={type} style={{ ...fInput, fontFamily: mono ? 'monospace' : 'inherit' }} value={value} onChange={(e) => onChange(e.target.value)} />
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
  const upSec = (k: keyof LandingContent, patch: Record<string, unknown>) => {
    setDraft((d) => ({ ...d, [k]: { ...(d[k] as object), ...patch } })); setSaved(false)
  }
  const upSlide = (i: number, patch: Partial<HeroSlide>) =>
    upSec('hero', { slides: draft.hero.slides.map((sl, j) => (j === i ? { ...sl, ...patch } : sl)) })
  const setTick = (i: number, v: string) => up({ ticker: draft.ticker.map((t, j) => (j === i ? v : t)) })
  const setPaso = (i: number, patch: Partial<{ titulo: string; texto: string }>) =>
    upSec('acceso', { pasos: draft.acceso.pasos.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setIns = (i: number, patch: Partial<{ titulo: string; texto: string }>) =>
    upSec('hero', { insignias: draft.hero.insignias.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setEspec = (i: number, patch: Partial<{ nombre: string; valor: string }>) =>
    upSec('ciencia', { especs: draft.ciencia.especs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setPunto = (i: number, patch: Partial<{ titulo: string; texto: string }>) =>
    upSec('ciencia', { puntos: draft.ciencia.puntos.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setCert = (i: number, patch: Partial<{ codigo: string; nombre: string; texto: string; ref: string }>) =>
    upSec('cumplimiento', { certs: draft.cumplimiento.certs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setReg = (i: number, patch: Partial<{ nombre: string; valor: string }>) =>
    upSec('pie', { regs: draft.pie.regs.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setCat = (i: number, v: string) =>
    upSec('pie', { categorias: draft.pie.categorias.map((x, j) => (j === i ? v : x)) })

  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const area: React.CSSProperties = { ...inp, minHeight: 74, resize: 'vertical' }

  // Campo de texto de una línea.
  const T = ({ label, value, onChange, hint, placeholder }: {
    label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string
  }) => (
    <div>
      <label style={lbl}>{label}</label>
      <input style={inp} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>{hint}</div>}
    </div>
  )
  // Campo de texto largo.
  const A = ({ label, value, onChange, hint }: {
    label: string; value: string; onChange: (v: string) => void; hint?: string
  }) => (
    <div>
      <label style={lbl}>{label}</label>
      <textarea style={area} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 5 }}>{hint}</div>}
    </div>
  )

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="sysnote" style={{ alignItems: 'flex-start' }}>
        <span>
          Las secciones de abajo son <b>las mismas que ves en la página pública</b>, en el mismo orden.
          Lo que escribas aquí se publica al guardar. Las imágenes se suben desde aquí.
        </span>
      </div>

      <SecCard title="Banda de anuncios (arriba de todo)">
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>
          Cinta animada en la parte superior, para promociones, festejos o avisos. Si dejas las fechas
          vacías se muestra siempre mientras esté encendida; si las pones, <b>se enciende y se apaga sola</b>.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={draft.announcement.enabled}
            onChange={(e) => upSec('announcement', { enabled: e.target.checked })} />
          Mostrar la banda en la página pública
        </label>
        <T label="Mensaje" value={draft.announcement.text} onChange={(v) => upSec('announcement', { text: v })} />
        <T label="Enlace al hacer clic (opcional)" value={draft.announcement.link} onChange={(v) => upSec('announcement', { link: v })} />
        <div className="form-grid-2">
          <div><label style={lbl}>Desde (opcional)</label>
            <input type="date" style={inp} value={draft.announcement.startsAt} onChange={(e) => upSec('announcement', { startsAt: e.target.value })} /></div>
          <div><label style={lbl}>Hasta (opcional)</label>
            <input type="date" style={inp} value={draft.announcement.endsAt} onChange={(e) => upSec('announcement', { endsAt: e.target.value })} /></div>
        </div>
      </SecCard>

      <SecCard title="Marca y menú">
        <div className="form-grid-2">
          <T label="Nombre" value={draft.brand.name} onChange={(v) => upSec('brand', { name: v })} hint="Admite HTML, p. ej. RENOVACELL<sup>®</sup>" />
          <T label="Bajada" value={draft.brand.tagline} onChange={(v) => upSec('brand', { tagline: v })} />
        </div>
        <ImageField label="Logo" value={draft.brand.logoUrl} onChange={(v) => upSec('brand', { logoUrl: v })} folder="landing" ratio="1 / 1"
          hint="Se usa en la barra superior y en el pie." />
        <div className="form-grid-2">
          <T label="Menú · Ciencia" value={draft.nav.ciencia} onChange={(v) => upSec('nav', { ciencia: v })} />
          <T label="Menú · Cumplimiento" value={draft.nav.cumplimiento} onChange={(v) => upSec('nav', { cumplimiento: v })} />
          <T label="Menú · Catálogo" value={draft.nav.catalogo} onChange={(v) => upSec('nav', { catalogo: v })} />
          <T label="Menú · El acceso" value={draft.nav.acceso} onChange={(v) => upSec('nav', { acceso: v })} />
        </div>
        <T label="Botón del menú" value={draft.nav.cta} onChange={(v) => upSec('nav', { cta: v })} hint="Lleva al sistema (/sistema). Es para quien ya tiene cuenta." />
      </SecCard>

      <SecCard title="Hero (lo primero que se ve)">
        <T label="Antetítulo" value={draft.hero.eyebrow} onChange={(v) => upSec('hero', { eyebrow: v })} />
        <A label="Título" value={draft.hero.title} onChange={(v) => upSec('hero', { title: v })}
          hint="Admite HTML: <br> corta línea y <span class=&quot;green&quot;>…</span> pinta de verde." />
        <A label="Subtítulo" value={draft.hero.subtitle} onChange={(v) => upSec('hero', { subtitle: v })} />
        <div className="form-grid-2">
          <T label="Botón principal" value={draft.hero.ctaPrimary} onChange={(v) => upSec('hero', { ctaPrimary: v })} />
          <T label="Botón secundario" value={draft.hero.ctaSecondary} onChange={(v) => upSec('hero', { ctaSecondary: v })} />
        </div>
        <ImageField label="Imagen · escritorio" value={draft.hero.imageUrl} onChange={(v) => upSec('hero', { imageUrl: v })} folder="landing" />
        <ImageField label="Imagen · móvil (opcional)" value={draft.hero.imageMobileUrl} onChange={(v) => upSec('hero', { imageMobileUrl: v })} folder="landing" ratio="3 / 4"
          hint="Si la dejas vacía, en celular se usa la de escritorio." />

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div className="eyebrow" style={{ margin: 0 }}>Insignias bajo el hero</div>
          {draft.hero.insignias.map((x, i) => (
            <div key={i} className="form-grid-2">
              <T label={`Insignia ${i + 1}`} value={x.titulo} onChange={(v) => setIns(i, { titulo: v })} />
              <T label="Texto" value={x.texto} onChange={(v) => setIns(i, { texto: v })} />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>
            <b>Hero rotativo (opcional).</b> Con dos diapositivas o más, el hero rota solo. Con una o ninguna,
            se queda fijo con lo de arriba.
          </div>
          {draft.hero.slides.map((sl, i) => (
            <div key={i} className="card" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div className="eyebrow" style={{ margin: 0 }}>Diapositiva {i + 1}</div>
                <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto', color: 'var(--danger)' }}
                  onClick={() => upSec('hero', { slides: draft.hero.slides.filter((_, j) => j !== i) })}>
                  <Trash2 size={13} /> Quitar
                </button>
              </div>
              <T label="Antetítulo" value={sl.eyebrow} onChange={(v) => upSlide(i, { eyebrow: v })} />
              <A label="Título" value={sl.title} onChange={(v) => upSlide(i, { title: v })} />
              <A label="Subtítulo" value={sl.subtitle} onChange={(v) => upSlide(i, { subtitle: v })} />
              <ImageField label="Imagen escritorio" value={sl.imageUrl} onChange={(v) => upSlide(i, { imageUrl: v })} folder="landing" />
              <ImageField label="Imagen móvil (opcional)" value={sl.imageMobileUrl} onChange={(v) => upSlide(i, { imageMobileUrl: v })} folder="landing" ratio="3 / 4" />
            </div>
          ))}
          <button className="btn ghost sm" type="button"
            onClick={() => upSec('hero', { slides: [...draft.hero.slides, { eyebrow: '', title: '', subtitle: '', imageUrl: '', imageMobileUrl: '' }] })}>
            <Plus size={14} /> Agregar diapositiva
          </button>
        </div>
      </SecCard>

      <SecCard title="Cinta de sellos">
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 4 }}>
          La cinta que se desplaza bajo el hero.
        </div>
        {draft.ticker.map((t, i) => (
          <input key={i} style={inp} value={t} onChange={(e) => setTick(i, e.target.value)} />
        ))}
      </SecCard>

      <SecCard title="Ciencia">
        <div className="form-grid-2">
          <T label="Antetítulo" value={draft.ciencia.kicker} onChange={(v) => upSec('ciencia', { kicker: v })} />
          <T label="Nota a la derecha" value={draft.ciencia.meta} onChange={(v) => upSec('ciencia', { meta: v })} />
        </div>
        <T label="Rótulo pequeño" value={draft.ciencia.small} onChange={(v) => upSec('ciencia', { small: v })} />
        <A label="Título" value={draft.ciencia.title} onChange={(v) => upSec('ciencia', { title: v })} hint="Admite HTML." />
        <A label="Texto" value={draft.ciencia.body} onChange={(v) => upSec('ciencia', { body: v })} hint="Admite HTML." />
        <T label="Pie de la imagen" value={draft.ciencia.foto} onChange={(v) => upSec('ciencia', { foto: v })} />
        <div className="eyebrow" style={{ marginTop: 16, marginBottom: 0 }}>Ficha sobre la imagen</div>
        {draft.ciencia.especs.map((x, i) => (
          <div key={i} className="form-grid-2">
            <T label={`Dato ${i + 1}`} value={x.nombre} onChange={(v) => setEspec(i, { nombre: v })} />
            <T label="Valor" value={x.valor} onChange={(v) => setEspec(i, { valor: v })} />
          </div>
        ))}
        <div className="eyebrow" style={{ marginTop: 16, marginBottom: 0 }}>Puntos numerados</div>
        {draft.ciencia.puntos.map((x, i) => (
          <div key={i} style={{ marginTop: 10 }}>
            <T label={`Punto ${i + 1}`} value={x.titulo} onChange={(v) => setPunto(i, { titulo: v })} />
            <A label="Texto" value={x.texto} onChange={(v) => setPunto(i, { texto: v })} />
          </div>
        ))}
      </SecCard>

      <SecCard title="Cumplimiento">
        <div className="form-grid-2">
          <T label="Antetítulo" value={draft.cumplimiento.kicker} onChange={(v) => upSec('cumplimiento', { kicker: v })} />
          <T label="Nota a la derecha" value={draft.cumplimiento.meta} onChange={(v) => upSec('cumplimiento', { meta: v })} />
        </div>
        <A label="Título" value={draft.cumplimiento.title} onChange={(v) => upSec('cumplimiento', { title: v })} hint="Admite HTML." />
        {draft.cumplimiento.certs.map((c, i) => (
          <div key={i} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <div className="eyebrow" style={{ margin: 0 }}>Certificación {i + 1}</div>
            <div className="form-grid-2">
              <T label="Sigla" value={c.codigo} onChange={(v) => setCert(i, { codigo: v })} />
              <T label="Referencia" value={c.ref} onChange={(v) => setCert(i, { ref: v })} />
            </div>
            <T label="Nombre" value={c.nombre} onChange={(v) => setCert(i, { nombre: v })} />
            <A label="Descripción" value={c.texto} onChange={(v) => setCert(i, { texto: v })} />
          </div>
        ))}
      </SecCard>

      <SecCard title="Catálogo">
        <T label="Antetítulo" value={draft.catalogo.kicker} onChange={(v) => upSec('catalogo', { kicker: v })} />
        <A label="Título" value={draft.catalogo.title} onChange={(v) => upSec('catalogo', { title: v })} />
        <A label="Texto de entrada" value={draft.catalogo.body} onChange={(v) => upSec('catalogo', { body: v })} />
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10 }}>
          Los productos que aparecen abajo salen del <b>Catálogo</b>, no de aquí.
        </div>
      </SecCard>

      <SecCard title="Recursos clínicos">
        <div className="form-grid-2">
          <T label="Antetítulo" value={draft.recursos.kicker} onChange={(v) => upSec('recursos', { kicker: v })} />
          <T label="Nota a la derecha" value={draft.recursos.meta} onChange={(v) => upSec('recursos', { meta: v })} />
        </div>
        <T label="Rótulo grande" value={draft.recursos.display} onChange={(v) => upSec('recursos', { display: v })} />
        <A label="Título" value={draft.recursos.title} onChange={(v) => upSec('recursos', { title: v })} hint="Admite HTML." />
      </SecCard>

      <SecCard title="El acceso (los tres pasos)">
        <T label="Antetítulo" value={draft.acceso.kicker} onChange={(v) => upSec('acceso', { kicker: v })} />
        <A label="Título" value={draft.acceso.title} onChange={(v) => upSec('acceso', { title: v })} hint="Admite HTML." />
        <A label="Texto de entrada" value={draft.acceso.body} onChange={(v) => upSec('acceso', { body: v })} />
        {draft.acceso.pasos.map((ps, i) => (
          <div key={i} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <div className="eyebrow" style={{ margin: 0 }}>Paso {i + 1}</div>
            <T label="Título" value={ps.titulo} onChange={(v) => setPaso(i, { titulo: v })} />
            <A label="Texto" value={ps.texto} onChange={(v) => setPaso(i, { texto: v })} />
          </div>
        ))}
        <T label="Botón" value={draft.acceso.cta} onChange={(v) => upSec('acceso', { cta: v })} />
        <A label="Frase de cierre" value={draft.acceso.nota} onChange={(v) => upSec('acceso', { nota: v })} hint="Admite HTML." />
      </SecCard>

      <SecCard title="Cierre (franja verde)">
        <T label="Rótulo grande" value={draft.cierre.display} onChange={(v) => upSec('cierre', { display: v })} />
        <A label="Título" value={draft.cierre.title} onChange={(v) => upSec('cierre', { title: v })} hint="Admite HTML." />
        <A label="Texto" value={draft.cierre.body} onChange={(v) => upSec('cierre', { body: v })} />
        <div className="form-grid-2">
          <T label="Botón principal" value={draft.cierre.btnPrimary} onChange={(v) => upSec('cierre', { btnPrimary: v })} />
          <T label="Botón secundario" value={draft.cierre.btnSecondary} onChange={(v) => upSec('cierre', { btnSecondary: v })} />
        </div>
        <T label="Sello bajo los botones" value={draft.cierre.sello} onChange={(v) => upSec('cierre', { sello: v })} />
      </SecCard>

      <SecCard title="Verificación de cédula (el formulario)">
        <T label="Antetítulo" value={draft.verificacion.kicker} onChange={(v) => upSec('verificacion', { kicker: v })} />
        <A label="Título" value={draft.verificacion.title} onChange={(v) => upSec('verificacion', { title: v })} hint="Admite HTML." />
        <A label="Texto" value={draft.verificacion.body} onChange={(v) => upSec('verificacion', { body: v })} />
        <T label="Botón" value={draft.verificacion.boton} onChange={(v) => upSec('verificacion', { boton: v })} />
      </SecCard>

      <SecCard title="Contacto">
        <div className="form-grid-2">
          <T label="WhatsApp" value={draft.contacto.whatsapp} onChange={(v) => upSec('contacto', { whatsapp: v })} hint="Solo dígitos con clave de país, p. ej. 526675310910" />
          <T label="Correo" value={draft.contacto.email} onChange={(v) => upSec('contacto', { email: v })} />
        </div>
        <T label="Enlace de la barra superior" value={draft.topbar.link} onChange={(v) => upSec('topbar', { link: v })} />
      </SecCard>

      <SecCard title="Pie de página">
        <A label="Descripción de la marca" value={draft.pie.desc} onChange={(v) => upSec('pie', { desc: v })} />
        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 0 }}>Sellos</div>
        {draft.pie.regs.map((x, i) => (
          <div key={i} className="form-grid-2">
            <T label={`Sello ${i + 1}`} value={x.nombre} onChange={(v) => setReg(i, { nombre: v })} />
            <T label="Valor" value={x.valor} onChange={(v) => setReg(i, { valor: v })} />
          </div>
        ))}
        <T label="Columna 1 · título" value={draft.pie.col1Titulo} onChange={(v) => upSec('pie', { col1Titulo: v })} />
        <div className="form-grid-2">
          {draft.pie.categorias.map((c, i) => (
            <T key={i} label={`Categoría ${i + 1}`} value={c} onChange={(v) => setCat(i, v)} />
          ))}
        </div>
        <T label="Columna 2 · título" value={draft.pie.col2Titulo} onChange={(v) => upSec('pie', { col2Titulo: v })} />
        <div className="form-grid-2">
          <T label="Sede México · nombre" value={draft.pie.mxNombre} onChange={(v) => upSec('pie', { mxNombre: v })} />
          <T label="Sede México · dirección" value={draft.pie.mxDir} onChange={(v) => upSec('pie', { mxDir: v })} hint="Admite <br> para cortar línea." />
        </div>
        <T label="Columna 3 · título" value={draft.pie.col3Titulo} onChange={(v) => upSec('pie', { col3Titulo: v })} />
        <div className="form-grid-2">
          <T label="Sede Europa · nombre" value={draft.pie.euNombre} onChange={(v) => upSec('pie', { euNombre: v })} />
          <T label="Sede Europa · dirección" value={draft.pie.euDir} onChange={(v) => upSec('pie', { euDir: v })} hint="Admite <br>." />
          <T label="Certificación · nombre" value={draft.pie.euCertNombre} onChange={(v) => upSec('pie', { euCertNombre: v })} />
          <T label="Certificación · texto" value={draft.pie.euCert} onChange={(v) => upSec('pie', { euCert: v })} hint="Admite <br>." />
        </div>
        <T label="Aviso legal" value={draft.footer.text} onChange={(v) => upSec('footer', { text: v })} />
        <T label="Crédito" value={draft.pie.credito} onChange={(v) => upSec('pie', { credito: v })} hint="Admite HTML." />
      </SecCard>

      <SecCard title="Buscadores (SEO)">
        <T label="Título de pestaña" value={draft.seo.title} onChange={(v) => upSec('seo', { title: v })} />
        <A label="Descripción" value={draft.seo.description} onChange={(v) => upSec('seo', { description: v })} />
      </SecCard>

      <div className="card" style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ghost sm" type="button" onClick={() => { setDraft(resetLanding()); setSaved(false) }}>
          <RotateCcw size={14} /> Restaurar
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Los cambios se ven en la página pública al recargarla.</span>
        <button className="btn" type="button" style={{ marginLeft: 'auto' }} onClick={() => { saveLanding(draft); setSaved(true) }}>
          Guardar y publicar
        </button>
        {saved && <span style={{ fontSize: 12.5, color: 'var(--green-deep)', fontWeight: 600 }}>Guardado ✓</span>}
      </div>
    </div>
  )
}
