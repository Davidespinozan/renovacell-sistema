// DISEÑO · Promociones / campañas vigentes. Lista con estado (vigente/próxima/
// finalizada) y alta de campaña. Mock (usePromos).
import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { fmtDate } from '../../lib/format'
import { usePromos, isActive, type Promo } from '../../data/hooks/usePromos'

function estado(p: Promo, today: string): { label: string; pill: string } {
  if (isActive(p, today)) return { label: 'Vigente', pill: 'p-ok' }
  if (today < p.start) return { label: 'Próxima', pill: 'p-blue' }
  return { label: 'Finalizada', pill: 'p-neu' }
}

export function Promociones() {
  const { data: promos, addPromo } = usePromos()
  const today = new Date().toISOString().slice(0, 10)
  const [open, setOpen] = useState(false)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Diseño · Promociones</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setOpen(true)}><Plus size={14} /> Nueva campaña</button>
      </div>

      {promos.map((p) => {
        const e = estado(p, today)
        return (
          <div key={p.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.description}</div>
              </div>
              <span className={'pill ' + e.pill}>{e.label}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              {fmtDate(p.start)} — {fmtDate(p.end)}
            </div>
          </div>
        )
      })}

      {open && <NewPromo onClose={() => setOpen(false)} onSave={(i) => { addPromo(i); setOpen(false) }} />}
    </div>
  )
}

function NewPromo({ onClose, onSave }: { onClose: () => void; onSave: (i: { title: string; description: string; start: string; end: string }) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  const valid = title.trim() && start && end

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Nueva campaña</h3><div className="ms">Promoción / campaña para preparar material.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Título</label>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Campaña Home Care · Julio" />
          <label style={label}>Descripción</label>
          <input style={input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Material / objetivo de la campaña" />
          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div><label style={label}>Inicia</label><input type="date" style={input} value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label style={label}>Termina</label><input type="date" style={input} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!valid} style={!valid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSave({ title: title.trim(), description: description.trim(), start, end })}>
              <Plus size={15} /> Crear campaña
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
