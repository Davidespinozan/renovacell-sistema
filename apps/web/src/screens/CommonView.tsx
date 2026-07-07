// VISTA COMÚN — hub interno con estilo social cálido (inspirado en Healthy Space
// Club): feed de anuncios/avisos con avatar, "hace X", reacciones, acuse de
// lectura y comentarios en sheet; biblioteca visual. NADA de publicaciones
// públicas: es comunicación interna del equipo. Lectura para todo el staff;
// admin y "comunicación" publican/editan.
import React, { useMemo, useState } from 'react'
import {
  Megaphone, Bell, ThumbsUp, CheckCheck, MessageCircle, Pin, Pencil, Trash2,
  X, Send, Image as ImageIcon, Download, Eye, ShieldCheck, Upload, Plus,
} from 'lucide-react'
import { useAssets, type AssetInput } from '../data/hooks/useAssets'
import { useResources } from '../data/hooks/useResources'
import { timeAgo } from '../lib/format'
import { uploadImage } from '../lib/uploads'
import { UserAvatar } from '../app/UserAvatar'
import { useUsers } from '../data/hooks/useUsers'
import { ROLES, getRole, canManageHub, type RoleKey } from '../app/roles'
import { useRole } from '../auth/RoleContext'
import { Icon } from '../app/icons'
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
  const { role, user, capabilities } = useRole()
  const r = getRole(role)
  const canManage = canManageHub(role) || capabilities.includes('anuncios')
  const hi = user?.name?.split('·')[0].trim() || 'Equipo'
  const ann = useAnnouncements()
  const assets = useAssets()
  const resources = useResources()
  // Fotos del equipo (para el autor de cada anuncio) — del directorio seguro.
  const { data: directory } = useUsers({ staffOnly: true })
  const avatarById = useMemo(() => {
    const m: Record<string, string | undefined> = {}
    directory.forEach((u) => { m[u.id] = u.avatarUrl })
    return m
  }, [directory])
  const [reqOpen, setReqOpen] = useState(false)

  const [filter, setFilter] = useState<Filter>('todos')
  const [reacted, setReacted] = useState<Set<string>>(new Set())
  const [read, setRead] = useState<Set<string>>(new Set())
  const [comments, setComments] = useState<Record<string, MockComment[]>>(() => ({ ...MOCK_COMMENTS }))
  const [sheetFor, setSheetFor] = useState<Announcement | null>(null)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [assetOpen, setAssetOpen] = useState(false)

  const feed = useMemo(
    () => ann.data
      .filter((a) => (filter === 'todos' ? true : kindOf(a) === filter))
      // Segmentación real: si el anuncio es para un área, solo esa área (o quien gestiona) lo ve.
      .filter((a) => { const aud = audienceOf(a); return aud == null || aud === role || canManage })
      .sort(byPinnedThenDate),
    [ann.data, filter, role, canManage],
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
        <div className="welcome">
          <Avatar name={user?.name ?? 'Equipo'} url={user?.avatarUrl} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="wk">Bienvenido a Renovacell</div>
            <div className="wh">Hola, {hi}</div>
          </div>
          <span className="role-badge"><Icon name={r.icon} /> {r.label}</span>
        </div>

        {/* Composer (solo admin/comm) */}
        {canManage && <Composer onPublish={ann.create} meUrl={user?.avatarUrl} meName={user?.name} />}

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
            authorUrl={avatarById[a.created_by ?? ''] ?? (authorOf(a) === user?.name ? user?.avatarUrl : undefined)}
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

        {/* Solicitudes de recurso — para esto es la Vista Común: pedir artes/recursos */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <ImageIcon size={18} color="var(--green-deep)" />
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Solicitudes de recurso</h2>
          <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setReqOpen(true)}><Plus size={14} /> Solicitar recurso</button>
        </div>
        <div className="grid" style={{ gap: 8, width: '100%' }}>
          {resources.data.slice(0, 5).map((rr) => {
            const pill = rr.status === 'entregado' ? 'p-ok' : rr.status === 'en_proceso' ? 'p-blue' : 'p-warn'
            const lbl = rr.status === 'entregado' ? 'Entregado' : rr.status === 'en_proceso' ? 'En proceso' : 'Solicitado'
            return (
              <div key={rr.id} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{rr.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Pidió {rr.requestedBy}</div>
                </div>
                {rr.status === 'entregado' && rr.assetUrl && (
                  <a className="btn ghost sm" href={rr.assetUrl} target="_blank" rel="noreferrer" download><Eye size={14} /> Ver</a>
                )}
                <span className={'pill ' + pill}>{lbl}</span>
              </div>
            )
          })}
          {resources.data.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Aún no hay solicitudes.</div>}
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
      {reqOpen && (
        <ResourceRequestModal
          onClose={() => setReqOpen(false)}
          onSave={(i) => { resources.addRequest({ ...i, requestedBy: user?.name ?? 'Equipo' }); setReqOpen(false) }}
        />
      )}
    </div>
  )
}

function ResourceRequestModal({ onClose, onSave }: { onClose: () => void; onSave: (i: { title: string; description: string }) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Solicitar recurso</h3><div className="ms">Pide un arte o material; lo atiende quien tenga Diseño.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>¿Qué necesitas?</label>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Banner para congreso CDMX" />
          <label style={label}>Detalle</label>
          <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para qué es, medidas, línea, fecha…" />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!title.trim()} style={!title.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSave({ title: title.trim(), description: description.trim() })}>
              <Plus size={15} /> Enviar solicitud
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssetUploadModal({ onClose, onSave }: { onClose: () => void; onSave: (input: AssetInput) => void }) {
  const [key, setKey] = useState('')
  const [dataUrl, setDataUrl] = useState('') // preview local
  const [file, setFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }

  const onFile = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    setFileName(f.name)
    const r = new FileReader()
    r.onload = () => setDataUrl(String(r.result))
    r.readAsDataURL(f)
  }
  const save = async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    // Sube la imagen a Storage y guarda su URL (no el data-URI).
    const url = file ? await uploadImage(file, 'library') : dataUrl
    onSave({ key: key.trim(), url, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) })
    setBusy(false)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Subir asset</h3><div className="ms">Logo, imagen o documento para el equipo.</div></div>
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
            <button className="btn" type="button" onClick={save} disabled={busy || !key.trim()} style={busy || !key.trim() ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}><Upload size={15} /> {busy ? 'Subiendo…' : 'Subir'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Avatar({ name, sm, url }: { name: string; sm?: boolean; url?: string }) {
  return <UserAvatar name={name} url={url} size={sm ? 30 : 40} className={'avatar' + (sm ? ' sm' : '')} />
}

function FeedCard({
  a, authorUrl, canManage, reacted, read, commentCount,
  onReact, onRead, onComments, onEdit, onPin, onDelete,
}: {
  a: Announcement
  authorUrl?: string
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
        <Avatar name={author} url={authorUrl} />
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

function Composer({ onPublish, meUrl, meName }: { onPublish: (input: { title: string; body: string; kind: AnnouncementKind; pinned: boolean; audience: RoleId | null }) => void; meUrl?: string; meName?: string }) {
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
      <Avatar name={meName ?? 'Tú'} url={meUrl} />
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
