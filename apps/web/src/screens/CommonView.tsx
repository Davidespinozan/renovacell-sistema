// VISTA COMÚN — hub interno con estilo social cálido (inspirado en Healthy Space
// Club): feed de anuncios/avisos con avatar, "hace X", reacciones, acuse de
// lectura y comentarios en sheet; biblioteca visual. NADA de publicaciones
// públicas: es comunicación interna del equipo. Lectura para todo el staff;
// admin y "comunicación" publican/editan.
import React, { useMemo, useState } from 'react'
import {
  Megaphone, Bell, ThumbsUp, CheckCheck, MessageCircle, Pin, Pencil, Trash2,
  X, Send, Image as ImageIcon, Download, Eye, ShieldCheck, Upload,
} from 'lucide-react'
import { useAssets, type AssetInput } from '../data/hooks/useAssets'
import { timeAgo, initials, avatarColor } from '../lib/format'
import { ROLES, getRole, canManageHub, type RoleKey } from '../app/roles'
import { useRole } from '../auth/RoleContext'
import { useAnnouncements, type AnnouncementKind } from '../data/hooks/useAnnouncements'
import { MOCK_COMMENTS, type MockComment } from '../data/mock/comunicacion'
import type { Announcement, RoleId } from '../data/types'

const kindOf = (a: Announcement): AnnouncementKind => (a.metadata?.kind as AnnouncementKind) ?? 'anuncio'
const isPinned = (a: Announcement): boolean => Boolean(a.metadata?.pinned)
const audienceOf = (a: Announcement): RoleId | null => (a.metadata?.audience as RoleId) ?? null
const authorOf = (a: Announcement): string => (a.metadata?.author as string) ?? 'Equipo'
const baseReactions = (a: Announcement): number => Number(a.metadata?.reactions ?? 0)
const baseReads = (a: Announcement): number => Number(a.metadata?.reads ?? 0)
const roleLabel = (k: RoleId): string => getRole(k as RoleKey).label
const STAFF = ROLES.filter((r) => r.isStaff)

const byPinnedThenDate = (a: Announcement, b: Announcement) =>
  Number(isPinned(b)) - Number(isPinned(a)) || (a.created_at < b.created_at ? 1 : -1)

type Filter = 'todos' | 'anuncio' | 'aviso'

export function CommonView() {
  const { role } = useRole()
  const canManage = canManageHub(role)
  const ann = useAnnouncements()
  const assets = useAssets()

  const [filter, setFilter] = useState<Filter>('todos')
  const [reacted, setReacted] = useState<Set<string>>(new Set())
  const [read, setRead] = useState<Set<string>>(new Set())
  const [comments, setComments] = useState<Record<string, MockComment[]>>(() => ({ ...MOCK_COMMENTS }))
  const [sheetFor, setSheetFor] = useState<Announcement | null>(null)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [assetOpen, setAssetOpen] = useState(false)

  const feed = useMemo(
    () => ann.data.filter((a) => (filter === 'todos' ? true : kindOf(a) === filter)).sort(byPinnedThenDate),
    [ann.data, filter],
  )

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    setter(next)
  }

  const addComment = (id: string, text: string) => {
    const c: MockComment = { id: `c-${Date.now()}`, author: 'Tú', text, created_at: new Date().toISOString() }
    setComments((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), c] }))
  }

  return (
    <div className="grid" style={{ justifyItems: 'center', gap: 18 }}>
      <div className="feed">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Hub Renovacell · Comunicación interna</div>
        </div>

        {/* Composer (solo admin/comm) */}
        {canManage && <Composer onPublish={ann.create} />}

        {/* Filtros */}
        <div className="fchips">
          {([['todos', 'Todos'], ['anuncio', 'Anuncios'], ['aviso', 'Avisos']] as const).map(([k, lbl]) => (
            <button key={k} className={'fchip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)} type="button">{lbl}</button>
          ))}
        </div>

        {/* Feed */}
        {feed.map((a) => (
          <FeedCard
            key={a.id}
            a={a}
            canManage={canManage}
            reacted={reacted.has(a.id)}
            read={read.has(a.id)}
            commentCount={(comments[a.id] ?? []).length}
            onReact={() => toggle(reacted, a.id, setReacted)}
            onRead={() => toggle(read, a.id, setRead)}
            onComments={() => setSheetFor(a)}
            onEdit={() => setEditing(a)}
            onPin={() => ann.togglePin(a.id)}
            onDelete={() => ann.remove(a.id)}
          />
        ))}

        {/* Biblioteca */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <ImageIcon size={18} color="var(--green-deep)" />
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Biblioteca</h2>
          {canManage && (
            <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setAssetOpen(true)}>
              <Upload size={14} /> Subir asset
            </button>
          )}
        </div>
        <div className="libgrid" style={{ width: '100%' }}>
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
        </div>

        {!canManage && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
            Modo lectura · solo Administración publica.
          </div>
        )}
      </div>

      {sheetFor && (
        <CommentsSheet
          announcement={sheetFor}
          comments={comments[sheetFor.id] ?? []}
          onAdd={(t) => addComment(sheetFor.id, t)}
          onClose={() => setSheetFor(null)}
        />
      )}
      {editing && (
        <EditModal
          announcement={editing}
          onClose={() => setEditing(null)}
          onSave={(input) => { ann.update(editing.id, input); setEditing(null) }}
        />
      )}
      {assetOpen && (
        <AssetUploadModal
          onClose={() => setAssetOpen(false)}
          onSave={(input) => { assets.create(input); setAssetOpen(false) }}
        />
      )}
    </div>
  )
}

function AssetUploadModal({ onClose, onSave }: { onClose: () => void; onSave: (input: AssetInput) => void }) {
  const [key, setKey] = useState('')
  const [dataUrl, setDataUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [tags, setTags] = useState('')
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }

  const onFile = (f: File | undefined) => {
    if (!f) return
    setFileName(f.name)
    const r = new FileReader()
    r.onload = () => setDataUrl(String(r.result))
    r.readAsDataURL(f)
  }
  const save = () => {
    if (!key.trim()) return
    onSave({ key: key.trim(), url: dataUrl, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Subir asset</h3><div className="ms">Logo, imagen o documento para el equipo. (Mock: sin storage real todavía.)</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Título</label>
          <input style={input} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ej. Logo Renovacell — verde" />

          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }}>Imagen / archivo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
              <Upload size={14} /> {dataUrl ? 'Cambiar' : 'Elegir imagen'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {dataUrl && <img src={dataUrl} alt="preview" style={{ width: 46, height: 46, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--line)' }} />}
            {fileName && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fileName}</span>}
          </div>

          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }}>Etiquetas (coma)</label>
          <input style={input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="logo, marca" />

          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={save}><Upload size={15} /> Subir</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Avatar({ name, sm }: { name: string; sm?: boolean }) {
  return <div className={'avatar' + (sm ? ' sm' : '')} style={{ background: avatarColor(name) }}>{initials(name)}</div>
}

function FeedCard({
  a, canManage, reacted, read, commentCount,
  onReact, onRead, onComments, onEdit, onPin, onDelete,
}: {
  a: Announcement
  canManage: boolean
  reacted: boolean
  read: boolean
  commentCount: number
  onReact: () => void; onRead: () => void; onComments: () => void
  onEdit: () => void; onPin: () => void; onDelete: () => void
}) {
  const kind = kindOf(a)
  const aud = audienceOf(a)
  const reactions = baseReactions(a) + (reacted ? 1 : 0)
  const reads = baseReads(a) + (read ? 1 : 0)
  const author = authorOf(a)

  return (
    <div className={'fcard' + (isPinned(a) ? ' pinned' : '')}>
      <div className="fhead">
        <Avatar name={author} />
        <div style={{ minWidth: 0 }}>
          <div className="fname">{author}</div>
          <div className="fmeta">
            <span>{timeAgo(a.created_at)}</span>
            <span className={'pill ' + (kind === 'aviso' ? 'p-warn' : 'p-neu')}>
              {kind === 'aviso' ? <Bell size={11} /> : <Megaphone size={11} />} {kind === 'aviso' ? 'Aviso' : 'Anuncio'}
            </span>
            {aud && <span className="pill p-blue">{roleLabel(aud)}</span>}
            {isPinned(a) && <span className="pill p-ok"><Pin size={11} /> Fijado</span>}
          </div>
        </div>
        {canManage && (
          <div className="fmanage">
            <button className="fbtn" type="button" onClick={onEdit} title="Editar"><Pencil size={15} /></button>
            <button className="fbtn" type="button" onClick={onPin} title="Fijar"><Pin size={15} /></button>
            <button className="fbtn" type="button" onClick={onDelete} title="Borrar"><Trash2 size={15} className="danger" color="var(--danger)" /></button>
          </div>
        )}
      </div>

      <div className="ftitle">{a.title}</div>
      <div className="fbody">{a.body}</div>

      <div className="factions">
        <button className={'fbtn' + (reacted ? ' on' : '')} type="button" onClick={onReact}>
          <ThumbsUp size={16} /> {reactions || ''} <span style={{ fontWeight: 500 }}>Me sirve</span>
        </button>
        <button className={'fbtn read' + (read ? ' on' : '')} type="button" onClick={onRead}>
          <CheckCheck size={16} /> {read ? 'Leído' : 'Marcar leído'} {reads ? `· ${reads}` : ''}
        </button>
        <button className="fbtn" type="button" onClick={onComments}>
          <MessageCircle size={16} /> {commentCount || ''} <span style={{ fontWeight: 500 }}>Comentar</span>
        </button>
      </div>
    </div>
  )
}

function Composer({ onPublish }: { onPublish: (input: { title: string; body: string; kind: AnnouncementKind; pinned: boolean; audience: RoleId | null }) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<AnnouncementKind>('anuncio')
  const [pinned, setPinned] = useState(false)
  const [audience, setAudience] = useState<RoleId | ''>('')

  const publish = () => {
    if (!title.trim()) return
    onPublish({ title: title.trim(), body: body.trim(), kind, pinned, audience: audience || null })
    setTitle(''); setBody(''); setPinned(false); setAudience(''); setKind('anuncio')
  }

  return (
    <div className="composer">
      <Avatar name="Tú" />
      <div style={{ flex: 1 }}>
        <input
          value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título…"
          style={{ width: '100%', border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, background: 'none' }}
        />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe un anuncio o aviso para el equipo…" rows={2} />
        <div className="composer-actions">
          <div className="fchips">
            <button type="button" className={'fchip' + (kind === 'anuncio' ? ' on' : '')} onClick={() => setKind('anuncio')}>Anuncio</button>
            <button type="button" className={'fchip' + (kind === 'aviso' ? ' on' : '')} onClick={() => setKind('aviso')}>Aviso</button>
          </div>
          <select
            value={audience} onChange={(e) => setAudience(e.target.value as RoleId | '')}
            style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 'var(--pill)', fontFamily: 'inherit', fontSize: 12.5, background: '#fff' }}
          >
            <option value="">Todo el equipo</option>
            {STAFF.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Fijar
          </label>
          <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={publish}><Send size={14} /> Publicar</button>
        </div>
      </div>
    </div>
  )
}

function CommentsSheet({ announcement, comments, onAdd, onClose }: {
  announcement: Announcement
  comments: MockComment[]
  onAdd: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const send = () => { if (text.trim()) { onAdd(text.trim()); setText('') } }

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <MessageCircle size={18} color="var(--green-deep)" />
          <div style={{ fontWeight: 600 }}>Comentarios</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>· {announcement.title}</div>
          <button className="fbtn" style={{ marginLeft: 'auto' }} type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="sheet-body">
          {comments.length === 0 ? (
            <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '16px 0', textAlign: 'center' }}>Sé el primero en comentar.</div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="cmt">
                <Avatar name={c.author} sm />
                <div className="body">
                  <div className="who">{c.author}<span className="when">{timeAgo(c.created_at)}</span></div>
                  <div className="txt">{c.text}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="sheet-foot">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un comentario…" onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="iconbtn-round" type="button" onClick={send}><Send size={17} /></button>
        </div>
      </div>
    </div>
  )
}

function EditModal({ announcement, onClose, onSave }: {
  announcement: Announcement
  onClose: () => void
  onSave: (input: { title: string; body: string; kind: AnnouncementKind; pinned: boolean; audience: RoleId | null }) => void
}) {
  const [title, setTitle] = useState(announcement.title)
  const [body, setBody] = useState(announcement.body ?? '')
  const [kind, setKind] = useState<AnnouncementKind>(kindOf(announcement))
  const [pinned, setPinned] = useState(isPinned(announcement))
  const [audience, setAudience] = useState<RoleId | ''>(audienceOf(announcement) ?? '')
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Editar {kind === 'aviso' ? 'aviso' : 'anuncio'}</h3></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" />
          <textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Mensaje" />
          <div className="fchips" style={{ marginTop: 12 }}>
            <button type="button" className={'fchip' + (kind === 'anuncio' ? ' on' : '')} onClick={() => setKind('anuncio')}>Anuncio</button>
            <button type="button" className={'fchip' + (kind === 'aviso' ? ' on' : '')} onClick={() => setKind('aviso')}>Aviso</button>
          </div>
          <select style={input} value={audience} onChange={(e) => setAudience(e.target.value as RoleId | '')}>
            <option value="">Todo el equipo</option>
            {STAFF.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Fijar arriba
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={() => onSave({ title: title.trim(), body: body.trim(), kind, pinned, audience: audience || null })}>
              <ShieldCheck size={15} /> Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
