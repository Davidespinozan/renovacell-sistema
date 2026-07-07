// DISEÑO (capability) · Solicitudes y pendientes de recurso. Quien tenga la
// responsabilidad de Diseño atiende aquí lo que el equipo pide desde la Vista
// Común Y ADEMÁS puede crear sus propios pendientes (planear diseños por
// iniciativa propia, sin que nadie los haya solicitado).
import React, { useState } from 'react'
import { Play, Check, Upload, Eye, Plus, Sparkles, X } from 'lucide-react'
import { fmtDate } from '../lib/format'
import { uploadImage } from '../lib/uploads'
import { useResources, type ResourceStatus } from '../data/hooks/useResources'
import { useAssets } from '../data/hooks/useAssets'
import { useRole } from '../auth/RoleContext'

const META: Record<ResourceStatus, { label: string; pill: string }> = {
  solicitado: { label: 'Solicitado', pill: 'p-warn' },
  en_proceso: { label: 'En proceso', pill: 'p-blue' },
  entregado: { label: 'Entregado', pill: 'p-ok' },
}

export function Solicitudes() {
  const { data, addRequest, setStatus, deliver } = useResources()
  const { create: addAsset } = useAssets()
  const { user } = useRole()
  const [toast, setToast] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(false)

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2600) }

  const onDeliver = async (id: string, file: File | undefined) => {
    if (!file) return
    // Sube el recurso a Storage y guarda su URL (no data-URI).
    const url = await uploadImage(file, 'design')
    deliver(id, url)
    // El recurso entregado también entra a la Biblioteca de la Vista Común.
    const req = data.find((x) => x.id === id)
    addAsset({ key: req?.title ?? 'Recurso', url, tags: ['recurso'] })
    flash('Recurso entregado · disponible en la Biblioteca.')
  }

  const onCrearPendiente = (title: string, description: string) => {
    addRequest({ title, description, requestedBy: user?.name ?? 'Diseño', origin: 'propio', status: 'en_proceso' })
    setNuevo(false)
    flash('Pendiente creado · ya está en tu tablero.')
  }

  const sorted = data.slice().sort((a, b) => {
    const order = { solicitado: 0, en_proceso: 1, entregado: 2 }
    return order[a.status] - order[b.status] || (a.at < b.at ? 1 : -1)
  })
  const abiertas = data.filter((r) => r.status !== 'entregado').length

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Diseño · Solicitudes y pendientes</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setNuevo(true)}>
          <Plus size={14} /> Nuevo pendiente
        </button>
      </div>

      {abiertas > 0 && (
        <div className="alert" style={{ cursor: 'default' }}>
          <div className="ico"><Play size={18} /></div>
          <div className="x"><b>{abiertas} pendiente(s) abierto(s).</b> Lo que el equipo pidió y tus propios proyectos de diseño.</div>
        </div>
      )}

      {sorted.map((r) => {
        const m = META[r.status]
        const propio = r.origin === 'propio'
        return (
          <div key={r.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.description}</div>
              </div>
              {propio && <span className="pill p-neu" title="Proyecto propio de Diseño"><Sparkles size={11} /> Propio</span>}
              <span className={'pill ' + m.pill}>{m.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                {propio ? 'Plan propio' : `Pidió ${r.requestedBy}`} · {fmtDate(r.at)}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                {r.status === 'solicitado' && <button className="btn ghost sm" type="button" onClick={() => setStatus(r.id, 'en_proceso')}><Play size={14} /> Tomar</button>}
                {r.status === 'en_proceso' && (
                  <label className="btn sm" style={{ cursor: 'pointer' }}>
                    <Upload size={14} /> Subir y entregar
                    <input type="file" style={{ display: 'none' }} onChange={(e) => onDeliver(r.id, e.target.files?.[0])} />
                  </label>
                )}
                {r.status === 'entregado' && (r.assetUrl
                  ? <a className="btn ghost sm" href={r.assetUrl} target="_blank" rel="noreferrer" download><Eye size={14} /> Ver recurso</a>
                  : <span className="pill p-ok"><Check size={12} /> Listo</span>)}
              </div>
            </div>
          </div>
        )
      })}
      {sorted.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Sin pendientes. Crea uno con “Nuevo pendiente”.</div>}

      {nuevo && <NuevoPendiente onCreate={onCrearPendiente} onClose={() => setNuevo(false)} />}
      {toast && <div className="toast show"><Check size={16} /> {toast}</div>}
    </div>
  )
}

const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

function NuevoPendiente({ onCreate, onClose }: { onCreate: (title: string, description: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const save = () => { if (title.trim()) onCreate(title.trim(), description.trim()) }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>Nuevo pendiente de diseño</h3>
            <div className="ms">Un proyecto que planeas por iniciativa propia (no hace falta que alguien lo pida).</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Título</label>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Campaña de lanzamiento — agosto" autoFocus />
          <label style={label}>Descripción</label>
          <textarea style={{ ...input, minHeight: 84, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Qué quieres diseñar, formato, dónde se usará…" />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={save} disabled={!title.trim()} style={!title.trim() ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
              <Plus size={14} /> Crear pendiente
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
