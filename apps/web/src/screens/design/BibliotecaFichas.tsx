// DISEÑO · Biblioteca y fichas técnicas. Biblioteca multimedia unificada (assets)
// + especificaciones técnicas del material (catálogo). Cierra el "flujo informal
// por WhatsApp": todo en un lugar con trazabilidad.
import React, { useState } from 'react'
import { Image as ImageIcon, Eye, Download, Upload, X, FileText } from 'lucide-react'
import { useAssets, type AssetInput } from '../../data/hooks/useAssets'
import { useProducts } from '../../data/hooks/useProducts'

export function BibliotecaFichas() {
  const assets = useAssets()
  const { data: products } = useProducts()
  const [open, setOpen] = useState(false)

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="eyebrow">Diseño · Biblioteca y fichas</div>

      {/* Biblioteca multimedia */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ImageIcon size={18} color="var(--green-deep)" />
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Biblioteca</h2>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}><Upload size={14} /> Subir asset</button>
      </div>
      <div className="libgrid">
        {assets.data.map((as) => (
          <div key={as.id} className="libcard">
            {as.url && as.url.startsWith('data:image') ? (
              <img src={as.url} alt={as.key ?? ''} style={{ width: '100%', height: 92, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div className="libtile"><ImageIcon /></div>
            )}
            <div className="libbody">
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{as.key}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{(as.tags ?? []).join(' · ')}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <a className="btn ghost sm" href={as.url || '#'} target="_blank" rel="noreferrer"><Eye size={14} /> Ver</a>
                <a className="btn sm" href={as.url || '#'} download><Download size={14} /> Descargar</a>
              </div>
            </div>
          </div>
        ))}
        {assets.data.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Aún no hay material. Sube el primero.</div>}
      </div>

      {/* Fichas técnicas (especificaciones del material/catálogo) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <FileText size={18} color="var(--green-deep)" />
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Fichas técnicas</h2>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead><tr><th>Producto</th><th>Línea</th><th>Categoría</th><th>Especificación</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td data-label="Producto">{p.name}</td>
                  <td data-label="Línea"><span className={'ltag ' + (p.line === 'prof' ? 'prof' : 'cosm')}>{p.line === 'prof' ? 'Professional' : 'Home Care'}</span></td>
                  <td data-label="Categoría">{p.category}</td>
                  <td data-label="Especificación" style={{ color: 'var(--ink-2)' }}>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && <UploadModal onClose={() => setOpen(false)} onSave={(i) => { assets.create(i); setOpen(false) }} />}
    </div>
  )
}

function UploadModal({ onClose, onSave }: { onClose: () => void; onSave: (i: AssetInput) => void }) {
  const [key, setKey] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [tags, setTags] = useState('')
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }

  const onFile = (f: File | undefined) => {
    if (!f) return
    const r = new FileReader()
    r.onload = () => setDataUrl(String(r.result))
    r.readAsDataURL(f)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Subir asset</h3><div className="ms">Material gráfico para el equipo.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Título</label>
          <input style={input} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ej. Banner campaña Home Care" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
              <Upload size={14} /> {dataUrl ? 'Cambiar' : 'Elegir imagen'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {dataUrl && <img src={dataUrl} alt="preview" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--line)' }} />}
          </div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }}>Etiquetas (coma)</label>
          <input style={input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="campaña, banner" />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!key.trim()} style={!key.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSave({ key: key.trim(), url: dataUrl, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })}>
              <Upload size={15} /> Subir
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
