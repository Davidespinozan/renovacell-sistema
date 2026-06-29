// DISEÑO (capability) · Solicitudes de recurso. Quien tenga la responsabilidad de
// Diseño atiende aquí los recursos que el equipo pide desde la Vista Común.
import React, { useState } from 'react'
import { Play, Check, Upload, Eye } from 'lucide-react'
import { fmtDate } from '../lib/format'
import { useResources, type ResourceStatus } from '../data/hooks/useResources'

const META: Record<ResourceStatus, { label: string; pill: string }> = {
  solicitado: { label: 'Solicitado', pill: 'p-warn' },
  en_proceso: { label: 'En proceso', pill: 'p-blue' },
  entregado: { label: 'Entregado', pill: 'p-ok' },
}

export function Solicitudes() {
  const { data, setStatus, deliver } = useResources()
  const [toast, setToast] = useState<string | null>(null)

  const onDeliver = (id: string, file: File | undefined) => {
    if (!file) return
    const r = new FileReader()
    r.onload = () => { deliver(id, String(r.result)); setToast('Recurso entregado y adjunto.'); window.setTimeout(() => setToast(null), 2400) }
    r.readAsDataURL(file)
  }
  const sorted = data.slice().sort((a, b) => {
    const order = { solicitado: 0, en_proceso: 1, entregado: 2 }
    return order[a.status] - order[b.status] || (a.at < b.at ? 1 : -1)
  })
  const abiertas = data.filter((r) => r.status !== 'entregado').length

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Diseño · Solicitudes de recurso</div>
      {abiertas > 0 && (
        <div className="alert" style={{ cursor: 'default' }}>
          <div className="ico"><Play size={18} /></div>
          <div className="x"><b>{abiertas} solicitud(es) abiertas.</b> Recursos que el equipo pidió desde la Vista Común.</div>
        </div>
      )}
      {sorted.map((r) => {
        const m = META[r.status]
        return (
          <div key={r.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.description}</div>
              </div>
              <span className={'pill ' + m.pill}>{m.label}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Pidió {r.requestedBy} · {fmtDate(r.at)}</span>
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
      {sorted.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Sin solicitudes.</div>}
      {toast && <div className="toast show"><Check size={16} /> {toast}</div>}
    </div>
  )
}
