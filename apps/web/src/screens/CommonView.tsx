// VISTA COMÚN — home del hub (sistema de comunicación). La ve todo el staff.
// Lectura para todos; admin y rol "comunicación" pueden crear/editar.
// Datos mock (forma de announcements + assets) detrás de hooks.
import React, { useMemo, useState } from 'react'
import { Icon } from '../app/icons'
import { ROLES, getRole, canManageHub, type RoleKey } from '../app/roles'
import { useRole } from '../auth/RoleContext'
import type { RoleId } from '../data/types'
import {
  useAnnouncements,
  type AnnouncementInput,
  type AnnouncementKind,
} from '../data/hooks/useAnnouncements'
import { useAssets, type AssetInput } from '../data/hooks/useAssets'
import type { Announcement } from '../data/types'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
  borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
  textTransform: 'uppercase', color: 'var(--ink-3)', margin: '14px 0 6px',
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

const kindOf = (a: Announcement): AnnouncementKind => ((a.metadata?.kind as AnnouncementKind) ?? 'anuncio')
const isPinned = (a: Announcement): boolean => Boolean(a.metadata?.pinned)
const audienceOf = (a: Announcement): RoleId | null => ((a.metadata?.audience as RoleId) ?? null)
const roleLabel = (key: RoleId): string => getRole(key as RoleKey).label

const byPinnedThenDate = (a: Announcement, b: Announcement) =>
  Number(isPinned(b)) - Number(isPinned(a)) || (a.created_at < b.created_at ? 1 : -1)

export function CommonView() {
  const { role } = useRole()
  const canManage = canManageHub(role)
  const ann = useAnnouncements()
  const assets = useAssets()

  const avisos = useMemo(() => ann.data.filter((a) => kindOf(a) === 'aviso').sort(byPinnedThenDate), [ann.data])
  const anuncios = useMemo(() => ann.data.filter((a) => kindOf(a) === 'anuncio').sort(byPinnedThenDate), [ann.data])

  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; kind: AnnouncementKind; row?: Announcement } | null>(null)
  const [assetOpen, setAssetOpen] = useState(false)

  return (
    <div className="grid" style={{ gap: 22 }}>
      <div className="eyebrow">Hub Renovacell · Comunicación interna</div>

      {/* AVISOS */}
      <Section
        title="Avisos"
        icon="bell"
        action={canManage ? { label: 'Nuevo aviso', onClick: () => setEditing({ mode: 'create', kind: 'aviso' }) } : undefined}
      >
        {avisos.length === 0 ? (
          <Empty text="Sin avisos." />
        ) : (
          <div className="grid two">
            {avisos.map((a) => (
              <div key={a.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {isPinned(a) && <span className="pill p-warn"><Icon name="pin" style={{ width: 12, height: 12 }} /> Fijado</span>}
                  {audienceOf(a) && <span className="pill p-blue">{roleLabel(audienceOf(a)!)}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>{fmtDate(a.created_at)}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{a.title}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.45 }}>{a.body}</div>
                {canManage && <ManageRow onEdit={() => setEditing({ mode: 'edit', kind: 'aviso', row: a })} onPin={() => ann.togglePin(a.id)} onDelete={() => ann.remove(a.id)} />}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ANUNCIOS */}
      <Section
        title="Anuncios"
        icon="megaphone"
        action={canManage ? { label: 'Nuevo anuncio', onClick: () => setEditing({ mode: 'create', kind: 'anuncio' }) } : undefined}
      >
        {anuncios.length === 0 ? (
          <Empty text="Sin anuncios." />
        ) : (
          <div className="grid" style={{ gap: 14 }}>
            {anuncios.map((a) => (
              <div key={a.id} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                  {isPinned(a) && <span className="pill p-warn"><Icon name="pin" style={{ width: 12, height: 12 }} /> Fijado</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(a.created_at)}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 5 }}>{a.title}</div>
                <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{a.body}</div>
                {canManage && <ManageRow onEdit={() => setEditing({ mode: 'edit', kind: 'anuncio', row: a })} onPin={() => ann.togglePin(a.id)} onDelete={() => ann.remove(a.id)} />}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* BIBLIOTECA DE ASSETS */}
      <Section
        title="Biblioteca"
        icon="image"
        action={canManage ? { label: 'Subir asset', onClick: () => setAssetOpen(true) } : undefined}
      >
        <div className="posgrid">
          {assets.data.map((as) => (
            <div key={as.id} className="poscard" style={{ cursor: 'default' }}>
              <div style={{ height: 72, borderRadius: 10, background: 'var(--ok-bg)', color: 'var(--green-deep)', display: 'grid', placeItems: 'center', marginBottom: 10 }}>
                <Icon name="image" style={{ width: 26, height: 26 }} />
              </div>
              <h5 style={{ margin: '0 0 4px' }}>{as.key}</h5>
              <div className="lt">{(as.tags ?? []).join(' · ')}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <a className="btn ghost sm" href={as.url || '#'} target="_blank" rel="noreferrer"><Icon name="eye" /> Ver</a>
                <a className="btn sm" href={as.url || '#'} download><Icon name="download" /> Descargar</a>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {!canManage && (
        <div className="footnote">
          <span className="d" />
          Estás viendo la vista común en modo lectura. Solo Administración y Comunicación pueden crear o editar.
        </div>
      )}

      {editing && (
        <AnnouncementModal
          mode={editing.mode}
          kind={editing.kind}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            if (editing.mode === 'edit' && editing.row) ann.update(editing.row.id, input)
            else ann.create(input)
            setEditing(null)
          }}
        />
      )}
      {assetOpen && (
        <AssetModal
          onClose={() => setAssetOpen(false)}
          onSave={(input) => {
            assets.create(input)
            setAssetOpen(false)
          }}
        />
      )}
    </div>
  )
}

function Section({ title, icon, action, children }: {
  title: string
  icon: Parameters<typeof Icon>[0]['name']
  action?: { label: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <section className="grid" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} style={{ width: 18, height: 18, color: 'var(--green-deep)' }} />
        <h2 style={{ fontSize: 17, fontWeight: 600 }}>{title}</h2>
        {action && (
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={action.onClick} type="button">
            <Icon name="plus" /> {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function ManageRow({ onEdit, onPin, onDelete }: { onEdit: () => void; onPin: () => void; onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <button className="btn ghost sm" onClick={onEdit} type="button"><Icon name="edit" /> Editar</button>
      <button className="btn ghost sm" onClick={onPin} type="button"><Icon name="pin" /> Fijar</button>
      <button className="btn ghost sm" onClick={onDelete} type="button" style={{ color: 'var(--danger)' }}><Icon name="trash" /> Borrar</button>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="card" style={{ color: 'var(--ink-3)', fontSize: 13.5, textAlign: 'center' }}>{text}</div>
}

const STAFF_AUDIENCE = ROLES.filter((r) => r.isStaff)

function AnnouncementModal({ mode, kind, row, onClose, onSave }: {
  mode: 'create' | 'edit'
  kind: AnnouncementKind
  row?: Announcement
  onClose: () => void
  onSave: (input: AnnouncementInput) => void
}) {
  const [title, setTitle] = useState(row?.title ?? '')
  const [body, setBody] = useState(row?.body ?? '')
  const [k, setK] = useState<AnnouncementKind>(row ? kindOf(row) : kind)
  const [pinned, setPinned] = useState(row ? isPinned(row) : false)
  const [audience, setAudience] = useState<RoleId | ''>(row ? (audienceOf(row) ?? '') : '')

  const save = () => {
    if (!title.trim()) return
    onSave({ title: title.trim(), body: body.trim(), kind: k, pinned, audience: audience || null })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>{mode === 'edit' ? 'Editar' : 'Nuevo'} {k === 'aviso' ? 'aviso' : 'anuncio'}</h3>
            <div className="ms">Visible para todo el staff en la vista común.</div>
          </div>
          <button className="mclose" onClick={onClose} type="button"><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <label style={labelStyle}>Tipo</label>
          <select style={inputStyle} value={k} onChange={(e) => setK(e.target.value as AnnouncementKind)}>
            <option value="anuncio">Anuncio</option>
            <option value="aviso">Aviso</option>
          </select>

          <label style={labelStyle}>Título</label>
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título…" />

          <label style={labelStyle}>Cuerpo</label>
          <textarea style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensaje…" />

          <label style={labelStyle}>Dirigido a (opcional)</label>
          <select style={inputStyle} value={audience} onChange={(e) => setAudience(e.target.value as RoleId | '')}>
            <option value="">Todo el equipo</option>
            {STAFF_AUDIENCE.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Fijar arriba
          </label>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose} type="button">Cancelar</button>
            <button className="btn" onClick={save} type="button"><Icon name="plus" /> {mode === 'edit' ? 'Guardar' : 'Publicar'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssetModal({ onClose, onSave }: { onClose: () => void; onSave: (input: AssetInput) => void }) {
  const [key, setKey] = useState('')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState('')

  const save = () => {
    if (!key.trim()) return
    onSave({ key: key.trim(), url: url.trim(), tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>Subir asset</h3>
            <div className="ms">Logo, imagen o documento para el equipo.</div>
          </div>
          <button className="mclose" onClick={onClose} type="button"><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <label style={labelStyle}>Nombre</label>
          <input style={inputStyle} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ej. Logo Renovacell — verde" />
          <label style={labelStyle}>URL</label>
          <input style={inputStyle} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… (mock por ahora)" />
          <label style={labelStyle}>Etiquetas (separadas por coma)</label>
          <input style={inputStyle} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="logo, marca" />
          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose} type="button">Cancelar</button>
            <button className="btn" onClick={save} type="button"><Icon name="plus" /> Subir</button>
          </div>
        </div>
      </div>
    </div>
  )
}
