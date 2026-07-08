// PROSPECTOS (Administración): bandeja de leads / CRM ligero. Pipeline de estatus,
// alta manual, notas de seguimiento y CONVERSIÓN a doctor (crea perfil PENDIENTE
// en Doctores → cierra el embudo landing→prospecto→doctor→Portal). PII staff-only.
// Hoy mock (useProspects); la captura automática desde la landing se conecta en la
// fase de Supabase.
import React, { useMemo, useState } from 'react'
import {
  Plus, X, UserPlus, Send, Clock, ArrowRight, Ban, MessageSquare, CheckCircle2, Pencil, Trash2,
  Zap, Users, TrendingUp, Shuffle, Radio,
} from 'lucide-react'
import { fmtDate, initials, avatarColor } from '../../lib/format'
import { useProspects, CHANNELS, type ProspectStatus, type ProspectNote } from '../../data/hooks/useProspects'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useProducts } from '../../data/hooks/useProducts'
import { useRole } from '../../auth/RoleContext'
import { hasSupabase } from '../../lib/supabase'
import type { Prospect } from '../../data/types'

// Nombres legibles de los vendedores demo (assigned_to es email en demo / uuid con backend).
const SELLER_NAMES: Record<string, string> = {
  'ventas1@renovacell.mx': 'Lucía · Ventas',
  'ventas2@renovacell.mx': 'Diego · Ventas',
}
const sellerLabel = (id?: string | null): string => (id ? (SELLER_NAMES[id] ?? id) : 'Sin asignar')

const PIPELINE: ProspectStatus[] = ['nuevo', 'contactado', 'cotizado', 'descartado']
const STATUS_META: Record<ProspectStatus, { label: string; pill: string }> = {
  nuevo: { label: 'Nuevo', pill: 'p-warn' },
  contactado: { label: 'Contactado', pill: 'p-blue' },
  cotizado: { label: 'Cotizado', pill: 'p-blue' },
  convertido: { label: 'Convertido', pill: 'p-ok' },
  descartado: { label: 'Descartado', pill: 'p-neu' },
}
const SOURCES = ['Puerta a puerta', 'Landing', 'WhatsApp', 'Referido', 'Evento', 'Manual']

const orgOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.organization as string) ?? ''
const interestOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.interest as string[]) ?? []
const notesOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.notes as ProspectNote[]) ?? []
const convertedDoctorOf = (p: Prospect) => ((p.meta as Record<string, unknown>)?.convertedDoctorId as string) ?? null
const statusOf = (p: Prospect): ProspectStatus => (p.status as ProspectStatus) ?? 'nuevo'

function Avatar({ name }: { name: string }) {
  return <div className="avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
}

export function Prospectos() {
  const { data: prospects, addProspect, setStatus, addNote, markConverted, updateProspect, deleteProspect, captureLead, reassign } = useProspects()
  const [editP, setEditP] = useState<{ id: string; name: string; email: string; phone: string; org: string } | null>(null)
  const onDeleteProspect = async (id: string, name: string) => {
    if (!window.confirm(`¿Eliminar el prospecto "${name}"?`)) return
    const r = await deleteProspect(id)
    if (!r.ok) window.alert(r.error ?? 'No se pudo eliminar.')
  }
  const { addPending } = useDoctors()
  const { role, user } = useRole()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const detail = prospects.find((p) => p.id === detailId) ?? null
  const isAdmin = role === 'admin'

  // Roster de vendedores (para reasignar y para el reparto). En demo, lista fija.
  const roster = useMemo(() => {
    const s = [...new Set(prospects.map((p) => p.assigned_to).filter((x): x is string => !!x))]
    return s.length ? s : (hasSupabase ? [] : ['ventas1@renovacell.mx', 'ventas2@renovacell.mx'])
  }, [prospects])

  // Aislamiento por vendedor: Admin ve todo; el vendedor solo SUS prospectos.
  // Con backend el RLS ya acota (assigned_to = auth.uid()), no re-filtramos.
  const visible = useMemo(
    () => (role === 'admin' || hasSupabase ? prospects : prospects.filter((p) => p.assigned_to === user?.email)),
    [prospects, role, user],
  )

  // Nuevos arriba; luego por fecha desc.
  const sorted = useMemo(
    () =>
      visible.slice().sort((a, b) => {
        const an = statusOf(a) === 'nuevo' ? 0 : 1
        const bn = statusOf(b) === 'nuevo' ? 0 : 1
        return an - bn || (a.created_at < b.created_at ? 1 : -1)
      }),
    [visible],
  )
  const nuevos = visible.filter((p) => statusOf(p) === 'nuevo').length

  const convert = (p: Prospect) => {
    const doc = addPending({
      full_name: p.name ?? 'Doctor',
      email: p.email,
      organization: orgOf(p) || null,
      meta: { cedula: p.cedula ?? undefined, fromProspect: p.id, owner: role === 'admin' ? undefined : user?.email },
    })
    markConverted(p.id, doc.id)
  }

  const onCapture = (input: { name: string; email: string | null; phone: string | null; organization: string | null; channel: string; interest: string[] }) => {
    const res = captureLead(input, roster.length ? roster : undefined)
    setCaptureOpen(false)
    setFlash(res.duplicate
      ? `Ese contacto ya existía (${res.prospect.name}). Registramos el nuevo mensaje en su seguimiento — no se duplicó.`
      : `Lead capturado por ${input.channel} y asignado automáticamente a ${sellerLabel(res.assignedTo)}.`)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="eyebrow" style={{ margin: 0 }}>{isAdmin ? 'Administración' : 'Ventas'} · Prospectos</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setCaptureOpen(true)}>
          <Zap size={14} /> Captar lead
        </button>
        <button className="btn ghost sm" type="button" onClick={() => setNewOpen(true)}>
          <Plus size={14} /> Nuevo prospecto
        </button>
      </div>

      {isAdmin && <CaptacionPanel prospects={visible} roster={roster} />}

      {flash && (
        <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#BFE3CC', color: 'var(--green-deep)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle2 size={18} />
          <span style={{ flex: 1 }}>{flash}</span>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={() => setFlash(null)}><X size={15} /></button>
        </div>
      )}

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
            <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(p.created_at)}</span>
              {isAdmin && (
                <span className="pill p-neu" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Users size={12} /> {sellerLabel(p.assigned_to)}
                </span>
              )}
              <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setDetailId(p.id)}>Ver detalle</button>
              <button className="btn ghost sm" type="button" onClick={() => setEditP({ id: p.id, name: p.name ?? '', email: p.email ?? '', phone: p.phone ?? '', org: orgOf(p) })}><Pencil size={14} /> Editar</button>
              <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => onDeleteProspect(p.id, p.name ?? 'este prospecto')}><Trash2 size={14} /> Eliminar</button>
            </div>
          </div>
        )
      })}

      {detail && (
        <DetailModal
          p={detail}
          canReassign={isAdmin}
          roster={roster}
          onReassign={(sid) => reassign(detail.id, sid)}
          onClose={() => setDetailId(null)}
          onStatus={(s) => setStatus(detail.id, s)}
          onNote={(t) => addNote(detail.id, t)}
          onConvert={() => convert(detail)}
        />
      )}
      {captureOpen && <CaptureModal onClose={() => setCaptureOpen(false)} onCapture={onCapture} />}
      {editP && (
        <EditProspectModal
          initial={editP}
          onClose={() => setEditP(null)}
          onSave={(patch) => { updateProspect(editP.id, patch); setEditP(null) }}
        />
      )}
      {newOpen && (
        <NewModal
          onClose={() => setNewOpen(false)}
          onSave={(input) => { addProspect({ ...input, assignedTo: role === 'admin' ? null : user?.email ?? null }); setNewOpen(false) }}
        />
      )}
    </div>
  )
}

function DetailModal({
  p, canReassign, roster, onReassign, onClose, onStatus, onNote, onConvert,
}: {
  p: Prospect
  canReassign: boolean
  roster: string[]
  onReassign: (sellerId: string | null) => void
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

          {canReassign && (
            <>
              <div className="eyebrow">Vendedor asignado</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Shuffle size={15} style={{ color: 'var(--ink-3)', flex: 'none' }} />
                <select
                  value={p.assigned_to ?? ''}
                  onChange={(e) => onReassign(e.target.value || null)}
                  style={{ flex: 1, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff' }}
                >
                  <option value="">Sin asignar</option>
                  {roster.map((s) => <option key={s} value={s}>{sellerLabel(s)}</option>)}
                </select>
              </div>
            </>
          )}

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
              <button className="btn" type="button" onClick={onConvert} title="Lo da de alta como doctor; Dirección lo verifica (cédula) antes de que pueda comprar">
                <UserPlus size={15} /> Convertir en cliente <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Panel de captación (Dirección): embudo de conversión por etapa, desempeño por
// canal y reparto de carga entre vendedores. Todo derivado de los prospectos reales.
function CaptacionPanel({ prospects, roster }: { prospects: Prospect[]; roster: string[] }) {
  const stats = useMemo(() => {
    const byStage: Record<string, number> = { nuevo: 0, contactado: 0, cotizado: 0, convertido: 0, descartado: 0 }
    const byChannel: Record<string, { total: number; conv: number }> = {}
    const bySeller: Record<string, number> = {}
    prospects.forEach((p) => {
      const st = statusOf(p)
      byStage[st] = (byStage[st] ?? 0) + 1
      const ch = p.source ?? 'Manual'
      const c = (byChannel[ch] ??= { total: 0, conv: 0 })
      c.total += 1
      if (st === 'convertido') c.conv += 1
      if (p.assigned_to && st !== 'convertido' && st !== 'descartado') bySeller[p.assigned_to] = (bySeller[p.assigned_to] ?? 0) + 1
    })
    return { byStage, byChannel, bySeller }
  }, [prospects])

  const total = prospects.length
  const conv = stats.byStage.convertido ?? 0
  const rate = total ? Math.round((conv / total) * 100) : 0
  const channels = Object.entries(stats.byChannel).sort((a, b) => b[1].total - a[1].total)
  const maxCh = Math.max(1, ...channels.map(([, c]) => c.total))
  const sellers = (roster.length ? roster : Object.keys(stats.bySeller))
  const maxLoad = Math.max(1, ...sellers.map((s) => stats.bySeller[s] ?? 0))

  const STAGES: { k: ProspectStatus; label: string }[] = [
    { k: 'nuevo', label: 'Nuevos' }, { k: 'contactado', label: 'Contactados' },
    { k: 'cotizado', label: 'Cotizados' }, { k: 'convertido', label: 'Convertidos' },
  ]
  const maxStage = Math.max(1, ...STAGES.map((s) => stats.byStage[s.k] ?? 0))

  const bar = (pct: number, color = 'var(--green-soft)') => (
    <div style={{ height: 7, background: 'var(--line)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6, transition: 'width .3s' }} />
    </div>
  )

  return (
    <div className="card" style={{ padding: 0 }}>
      <div style={{ padding: '16px 18px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Radio size={16} style={{ color: 'var(--green-deep)' }} />
        <div className="eyebrow" style={{ margin: 0 }}>Captación · embudo multicanal</div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1, background: 'var(--line)', margin: '10px 0' }}>
        {[
          { n: total, l: 'Leads totales' },
          { n: stats.byStage.nuevo ?? 0, l: 'Nuevos sin atender' },
          { n: conv, l: 'Convertidos' },
          { n: `${rate}%`, l: 'Tasa de conversión' },
        ].map((k) => (
          <div key={k.l} style={{ background: '#fff', padding: '12px 16px' }}>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.02em' }}>{k.n}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>{k.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
        {/* Embudo por etapa */}
        <div style={{ padding: '10px 18px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10 }}>
            <TrendingUp size={13} /> Embudo por etapa
          </div>
          {STAGES.map((s) => {
            const v = stats.byStage[s.k] ?? 0
            return (
              <div key={s.k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 34px', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{s.label}</span>
                {bar((v / maxStage) * 100, s.k === 'convertido' ? 'var(--green-deep)' : 'var(--green-soft)')}
                <span className="mono" style={{ fontSize: 12.5, textAlign: 'right' }}>{v}</span>
              </div>
            )
          })}
        </div>

        {/* Por canal */}
        <div style={{ padding: '10px 18px 6px', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10 }}>
            <Zap size={13} /> Desempeño por canal
          </div>
          {channels.length === 0 ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Sin leads aún.</div> : channels.map(([ch, c]) => (
            <div key={ch} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: 10, marginBottom: 7 }}>
              <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{ch}</span>
              {bar((c.total / maxCh) * 100)}
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                {c.total} · <span style={{ color: c.conv > 0 ? 'var(--green-deep)' : 'var(--ink-3)' }}>{c.total ? Math.round((c.conv / c.total) * 100) : 0}% conv.</span>
              </span>
            </div>
          ))}
        </div>

        {/* Reparto por vendedor */}
        {sellers.length > 0 && (
          <div style={{ padding: '10px 18px 16px', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10 }}>
              <Users size={13} /> Reparto de carga (prospectos abiertos)
            </div>
            {sellers.map((s) => {
              const v = stats.bySeller[s] ?? 0
              return (
                <div key={s} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 28px', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sellerLabel(s)}</span>
                  {bar((v / maxLoad) * 100, 'var(--blue, #6aa9d8)')}
                  <span className="mono" style={{ fontSize: 12.5, textAlign: 'right' }}>{v}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Captación multicanal: un lead de cualquier canal pasa por el motor (dedup +
// auto-asignación). Los canales con "auto" pueden llegar por integración (seam).
function CaptureModal({ onClose, onCapture }: {
  onClose: () => void
  onCapture: (input: { name: string; email: string | null; phone: string | null; organization: string | null; channel: string; interest: string[] }) => void
}) {
  const { data: products } = useProducts()
  const [channel, setChannel] = useState('WhatsApp')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [interest, setInterest] = useState('')

  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  const save = () => {
    if (!name.trim()) return
    onCapture({ name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, organization: org.trim() || null, channel, interest: interest ? [interest] : [] })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>Captar lead</h3>
            <div className="ms">Entra por el motor multicanal: se <b>deduplica</b> y se <b>asigna solo</b> al vendedor con menos carga.</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Canal</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            {CHANNELS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setChannel(c.key)}
                className={'fchip' + (channel === c.key ? ' on' : '')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                {c.webhook && <Zap size={12} />}{c.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Zap size={11} /> los canales con rayo pueden entrar automáticamente por integración (WhatsApp / Meta / sitio web).
          </div>

          <label style={label}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dra. / Dr. Nombre Apellido" autoFocus />

          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div>
              <label style={label}>Teléfono</label>
              <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 0000 0000" />
            </div>
            <div>
              <label style={label}>Correo</label>
              <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@clinica.mx" />
            </div>
          </div>

          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div>
              <label style={label}>Clínica / organización</label>
              <input style={input} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Nombre de la clínica" />
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
              <Zap size={15} /> Captar y asignar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (input: { name: string; email: string | null; phone: string | null; organization: string | null; source: string; interest: string[]; cedula: string | null }) => void
}) {
  const { data: products } = useProducts()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [org, setOrg] = useState('')
  const [cedula, setCedula] = useState('')
  const [source, setSource] = useState('Puerta a puerta')
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
      cedula: cedula.trim() || null,
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

          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div>
              <label style={label}>Clínica / organización</label>
              <input style={input} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Nombre de la clínica" />
            </div>
            <div>
              <label style={label}>Cédula profesional (si la trae)</label>
              <input style={input} value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="Para poder verificarlo al convertir" />
            </div>
          </div>

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

function EditProspectModal({ initial, onClose, onSave }: {
  initial: { name: string; email: string; phone: string; org: string }
  onClose: () => void
  onSave: (patch: { name: string; email: string | null; phone: string | null; organization: string | null }) => void
}) {
  const [name, setName] = useState(initial.name)
  const [email, setEmail] = useState(initial.email)
  const [phone, setPhone] = useState(initial.phone)
  const [org, setOrg] = useState(initial.org)
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><div><h3>Editar prospecto</h3></div><button className="mclose" type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label style={label}>Correo</label>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@clinica.mx" />
          <label style={label}>Teléfono</label>
          <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55 0000 0000" />
          <label style={label}>Clínica</label>
          <input style={input} value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Nombre de la clínica" />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => onSave({ name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, organization: org.trim() || null })}>Guardar cambios</button>
          </div>
        </div>
      </div>
    </div>
  )
}
