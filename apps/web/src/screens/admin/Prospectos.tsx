// PROSPECTOS (Administración): bandeja de leads / CRM ligero. Pipeline de estatus,
// alta manual, notas de seguimiento y CONVERSIÓN a doctor (crea perfil PENDIENTE
// en Doctores → cierra el embudo landing→prospecto→doctor→Portal). PII staff-only.
// Hoy mock (useProspects); la captura automática desde la landing se conecta en la
// fase de Supabase.
import React, { useMemo, useState } from 'react'
import {
  Plus, X, UserPlus, Send, Clock, ArrowRight, Ban, MessageSquare, CheckCircle2,
} from 'lucide-react'
import { fmtDate, initials, avatarColor } from '../../lib/format'
import { useProspects, type ProspectStatus, type ProspectNote } from '../../data/hooks/useProspects'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useProducts } from '../../data/hooks/useProducts'
import type { Prospect } from '../../data/types'

const PIPELINE: ProspectStatus[] = ['nuevo', 'contactado', 'cotizado', 'descartado']
const STATUS_META: Record<ProspectStatus, { label: string; pill: string }> = {
  nuevo: { label: 'Nuevo', pill: 'p-warn' },
  contactado: { label: 'Contactado', pill: 'p-blue' },
  cotizado: { label: 'Cotizado', pill: 'p-blue' },
  convertido: { label: 'Convertido', pill: 'p-ok' },
  descartado: { label: 'Descartado', pill: 'p-neu' },
}
const SOURCES = ['Landing', 'WhatsApp', 'Referido', 'Manual']

const orgOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.organization as string) ?? ''
const interestOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.interest as string[]) ?? []
const notesOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.notes as ProspectNote[]) ?? []
const convertedDoctorOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.convertedDoctorId as string) ?? null
const statusOf = (p: Prospect): ProspectStatus => (p.status as ProspectStatus) ?? 'nuevo'

function Avatar({ name }: { name: string }) {
  return <div className="avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
}

export function Prospectos() {
  const { data: prospects, addProspect, setStatus, addNote, markConverted } = useProspects()
  const { addPending } = useDoctors()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const detail = prospects.find((p) => p.id === detailId) ?? null

  // Nuevos arriba; luego por fecha desc.
  const sorted = useMemo(
    () =>
      prospects.slice().sort((a, b) => {
        const an = statusOf(a) === 'nuevo' ? 0 : 1
        const bn = statusOf(b) === 'nuevo' ? 0 : 1
        return an - bn || (a.created_at < b.created_at ? 1 : -1)
      }),
    [prospects],
  )
  const nuevos = prospects.filter((p) => statusOf(p) === 'nuevo').length

  const convert = (p: Prospect) => {
    const doc = addPending({
      full_name: p.name ?? 'Doctor',
      email: p.email,
      organization: orgOf(p) || null,
      meta: { cedula: p.cedula ?? undefined, fromProspect: p.id },
    })
    markConverted(p.id, doc.id)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Administración · Prospectos</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setNewOpen(true)}>
          <Plus size={14} /> Nuevo prospecto
        </button>
      </div>

      {nuevos > 0 && (
        <div className="alert" style={{ cursor: 'default' }}>
          <div className="ico"><Clock size={20} /></div>
          <div className="x"><b>{nuevos} prospecto(s) nuevo(s) por atender.</b> Contáctalos y muévelos por el pipeline.</div>
        </div>
      )}

      {sorted.map((p) => {
        const st = STATUS_META[statusOf(p)]
        return (
          <div key={p.id} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar name={p.name ?? '?'} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  {orgOf(p)}{orgOf(p) && (p.email || p.phone) ? ' · ' : ''}{p.email ?? p.phone ?? ''}
                </div>
              </div>
              <span className="pill p-neu">{p.source}</span>
              <span className={'pill ' + st.pill}>{st.label}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(p.created_at)}</span>
              <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setDetailId(p.id)}>Ver detalle</button>
            </div>
          </div>
        )
      })}

      {detail && (
        <DetailModal
          p={detail}
          onClose={() => setDetailId(null)}
          onStatus={(s) => setStatus(detail.id, s)}
          onNote={(t) => addNote(detail.id, t)}
          onConvert={() => convert(detail)}
        />
      )}
      {newOpen && (
        <NewModal
          onClose={() => setNewOpen(false)}
          onSave={(input) => { addProspect(input); setNewOpen(false) }}
        />
      )}
    </div>
  )
}

function DetailModal({
  p, onClose, onStatus, onNote, onConvert,
}: {
  p: Prospect
  onClose: () => void
  onStatus: (s: ProspectStatus) => void
  onNote: (text: string) => void
  onConvert: () => void
}) {
  const [note, setNote] = useState('')
  const status = statusOf(p)
  const notes = notesOf(p)
  const interest = interestOf(p)
  const convertedDoc = convertedDoctorOf(p)
  const send = () => { if (note.trim()) { onNote(note.trim()); setNote('') } }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar name={p.name ?? '?'} />
            <div>
              <h3>{p.name}</h3>
              <div className="ms">{orgOf(p)}{orgOf(p) ? ' · ' : ''}{p.source}</div>
            </div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="form-grid-2" style={{ marginBottom: 14 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Correo</div>{p.email ?? '—'}</div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Teléfono</div>{p.phone ?? '—'}</div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Origen</div>{p.source}</div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Registrado</div>{fmtDate(p.created_at)}</div>
          </div>

          {interest.length > 0 && (
            <>
              <div className="eyebrow">Interés</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {interest.map((i) => <span key={i} className="pill p-blue">{i}</span>)}
              </div>
            </>
          )}

          {/* Pipeline */}
          <div className="eyebrow">Estatus</div>
          {status === 'convertido' ? (
            <div className="sysnote" style={{ marginBottom: 14 }}>
              <CheckCircle2 size={18} />
              <span>Convertido a doctor (pendiente de verificación). Está en <b>Doctores</b> esperando verificación{convertedDoc ? '' : ''}.</span>
            </div>
          ) : (
            <div className="fchips" style={{ marginBottom: 14 }}>
              {PIPELINE.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={'fchip' + (status === s ? ' on' : '')}
                  onClick={() => onStatus(s)}
                >
                  {s === 'descartado' ? <Ban size={13} style={{ marginRight: 5, verticalAlign: '-2px' }} /> : null}
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          )}

          {/* Notas de seguimiento */}
          <div className="eyebrow">Seguimiento</div>
          {notes.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>Sin notas todavía.</div>
          ) : (
            <div style={{ marginBottom: 10 }}>
              {notes.map((n, i) => (
                <div key={i} className="lrow" style={{ alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 9 }}>
                    <MessageSquare size={15} style={{ color: 'var(--ink-3)', marginTop: 2, flex: 'none' }} />
                    <div>
                      <div style={{ fontSize: 13.5 }}>{n.text}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{fmtDate(n.at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Agregar nota de seguimiento…"
              style={{ flex: 1, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none' }}
            />
            <button className="btn ghost sm" type="button" onClick={send}><Send size={14} /> Agregar</button>
          </div>

          {/* Conversión */}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            {status === 'convertido' ? (
              <button className="btn ghost" type="button" disabled style={{ opacity: 0.6, cursor: 'default' }}>
                <CheckCircle2 size={15} /> Ya convertido
              </button>
            ) : (
              <button className="btn" type="button" onClick={onConvert}>
                <UserPlus size={15} /> Convertir a doctor <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NewModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (input: { name: string; email: string | null; phone: string | null; organization: string | null; source: string; interest: string[] }) => void
}) {
  const { data: products } = useProducts()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [org, setOrg] = useState('')
  const [source, setSource] = useState('Manual')
  const [interest, setInterest] = useState('')

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  const save = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      organization: org.trim() || null,
      source,
      interest: interest ? [interest] : [],
    })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Nuevo prospecto</h3><div className="ms">Registra un lead que llegó por WhatsApp, llamada o referido.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dra. / Dr. Nombre Apellido" />

          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div>
              <label style={label}>Correo</label>
              <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@clinica.mx" />
            </div>
            <div>
              <label style={label}>Teléfono</label>
              <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 0000 0000" />
            </div>
          </div>

          <label style={label}>Clínica / organización</label>
          <input style={input} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Nombre de la clínica" />

          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div>
              <label style={label}>Origen</label>
              <select style={input} value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Producto de interés (opcional)</label>
              <select style={input} value={interest} onChange={(e) => setInterest(e.target.value)}>
                <option value="">—</option>
                {products.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={save} disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
              <Plus size={15} /> Registrar prospecto
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
