// VISTA COMÚN ("Avisos del equipo") — comunicación interna del equipo, con el mismo cuidado visual que el chat:
// muro de avisos con autor y puesto, lo nuevo resaltado, "Enterado" como acuse de lectura, reacciones y comentarios;
// la Biblioteca y las Solicitudes de recurso en sus propias pestañas para que el muro no se pierda entre tarjetas.
// Lectura para todo el staff; Dirección y quien tenga 'anuncios' publican/editan.
import React, { useMemo, useState } from 'react'
import {
  Megaphone, Bell, ThumbsUp, CheckCheck, Check, MessageCircle, Pin, Pencil, Trash2,
  X, Send, Image as ImageIcon, Download, Eye, ShieldCheck, Upload, Plus,
} from 'lucide-react'
import { useAssets, type AssetInput } from '../data/hooks/useAssets'
import { useResources } from '../data/hooks/useResources'
import { timeAgo } from '../lib/format'
import { cuandoPublicado } from '../lib/cuando'
import { uploadImage } from '../lib/uploads'
import { UserAvatar } from '../app/UserAvatar'
import { useUsers } from '../data/hooks/useUsers'
import { ROLES, getRole, canManageHub, type RoleKey } from '../app/roles'
import { useRole } from '../auth/RoleContext'
import { currentUserId } from '../lib/supabase'
import { Pestanas } from '../app/Pestanas'
import { conEnlaces } from './chat/ChatCanonico'
import { useAnnouncements, type AnnouncementKind } from '../data/hooks/useAnnouncements'
import { useAnnSocial, type AnnComment } from '../data/hooks/useAnnSocial'
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

type Filter = 'todos' | 'sinleer' | 'anuncio' | 'aviso'

export function CommonView() {
  const { role, user, capabilities } = useRole()
  const r = getRole(role)
  const canManage = canManageHub(role) || capabilities.includes('anuncios')
  // Quien gestiona Diseño (admin o capability 'diseno') puede pasar una solicitud
  // entregada a la Biblioteca y eliminar tanto assets como solicitudes.
  const canDesign = canManageHub(role) || capabilities.includes('diseno')
  const toLibrary = (rr: { title: string; assetUrl?: string }) => {
    if (!rr.assetUrl) return
    assets.create({ key: rr.title, url: rr.assetUrl, tags: ['solicitud'] })
  }
  const ann = useAnnouncements()
  const assets = useAssets()
  const resources = useResources()
  // Fotos y puesto del equipo (para el autor de cada aviso) — del directorio seguro.
  const { data: directory } = useUsers({ staffOnly: true })
  const equipo = useMemo(() => {
    const m: Record<string, { url?: string; rol: string }> = {}
    directory.forEach((u) => { m[u.id] = { url: u.avatarUrl, rol: u.role } })
    return m
  }, [directory])
  const [reqOpen, setReqOpen] = useState(false)

  const [filter, setFilter] = useState<Filter>('todos')
  const social = useAnnSocial() // comentarios/reacciones/leído persistentes
  const [sheetFor, setSheetFor] = useState<Announcement | null>(null)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [assetOpen, setAssetOpen] = useState(false)

  // Segmentación real: si el anuncio es para un área, solo esa área (o quien gestiona) lo ve.
  const visibles = useMemo(
    () => ann.data.filter((a) => { const aud = audienceOf(a); return aud == null || aud === role || canManage }).sort(byPinnedThenDate),
    [ann.data, role, canManage],
  )
  const sinLeer = visibles.filter((a) => !social.read(a.id))
  const feed = visibles.filter((a) => (filter === 'todos' ? true : filter === 'sinleer' ? !social.read(a.id) : kindOf(a) === filter))
  const pendientes = resources.data.filter((rr) => rr.status !== 'entregado').length
  const autorDe = (a: Announcement) => {
    const mio = !!a.created_by && a.created_by === currentUserId()
    const e = equipo[a.created_by ?? '']
    return { url: e?.url ?? (mio || authorOf(a) === user?.name ? user?.avatarUrl : undefined), rol: e?.rol ?? (mio ? r.label : '') }
  }

  const muro = (
    <div className="av-muro">
      {canManage && <Composer onPublish={ann.create} meUrl={user?.avatarUrl} meName={user?.name} />}

      <div className="av-barra">
        <div className="fchips" role="group" aria-label="Filtrar avisos">
          {([['todos', 'Todos'], ['sinleer', 'Sin leer'], ['aviso', 'Avisos'], ['anuncio', 'Anuncios']] as const).map(([k, lbl]) => (
            <button key={k} className={'fchip' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)} type="button">
              {lbl}{k === 'sinleer' && sinLeer.length > 0 ? ` · ${sinLeer.length}` : ''}
            </button>
          ))}
        </div>
        {sinLeer.length > 1 && (
          <button type="button" className="av-todo-leido" onClick={() => sinLeer.forEach((a) => social.markRead(a.id))}><CheckCheck size={15} /> Marcar todo como leído</button>
        )}
      </div>

      {feed.map((a) => {
        const autor = autorDe(a)
        return (
          <FeedCard
            key={a.id}
            a={a}
            authorUrl={autor.url}
            authorRole={autor.rol}
            canManage={canManage}
            reacted={social.reacted(a.id)}
            read={social.read(a.id)}
            reactionCount={social.reactionCount(a.id)}
            readCount={social.readCount(a.id)}
            commentCount={social.comments(a.id).length}
            onReact={() => social.toggleReaction(a.id)}
            onRead={() => social.markRead(a.id)}
            onComments={() => { social.markRead(a.id); setSheetFor(a) }}
            onEdit={() => setEditing(a)}
            onPin={() => ann.togglePin(a.id)}
            onDelete={() => { if (window.confirm('¿Borrar esta publicación?')) ann.remove(a.id) }}
          />
        )
      })}

      {feed.length === 0 && (
        <div className="av-vacio">
          <div className="av-vacio-ico">{filter === 'sinleer' ? <CheckCheck size={26} /> : <Megaphone size={26} />}</div>
          <div className="av-vacio-t">{filter === 'sinleer' ? 'Estás al día' : 'Aún no hay publicaciones'}</div>
          <div className="av-vacio-s">{filter === 'sinleer' ? 'Ya leíste todos los avisos del equipo.' : canManage ? 'Publica el primer aviso para el equipo.' : 'Aquí verás los avisos y anuncios del equipo.'}</div>
        </div>
      )}

      {!canManage && <div className="av-nota">Aquí publican Dirección y quien administra los avisos. Para hablar con alguien, usa el Chat del equipo.</div>}
    </div>
  )

  const biblioteca = (
    <div className="av-seccion">
      <div className="av-seccion-head">
        <div><h2>Biblioteca</h2><p>Logos, imágenes y materiales listos para usar.</p></div>
        {canManage && <button className="btn sm" type="button" onClick={() => setAssetOpen(true)}><Upload size={14} /> Subir material</button>}
      </div>
      <div className="libgrid" style={{ width: '100%' }}>
        {assets.data.map((as) => (
          <div key={as.id} className="libcard" style={{ position: 'relative' }}>
            {canDesign && (
              <button
                type="button" className="libdel" title="Eliminar de la biblioteca"
                onClick={() => { if (window.confirm('¿Eliminar este asset de la biblioteca?')) assets.remove(as.id) }}
              >
                <Trash2 size={15} color="var(--danger)" />
              </button>
            )}
            {as.url && (as.url.startsWith('data:image') || /^https?:\/\//.test(as.url)) ? (
              <img src={as.url} alt={as.key ?? ''} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
            ) : (
              <div className="libtile"><ImageIcon /></div>
            )}
            <div className="libbody">
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{as.key}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{(as.tags ?? []).join(' · ')}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                {as.url ? (
                  <>
                    <a className="btn ghost sm" style={{ flex: '1 1 auto' }} href={as.url} target="_blank" rel="noreferrer"><Eye size={14} /> Ver</a>
                    <a className="btn sm" style={{ flex: '1 1 auto' }} href={as.url} download><Download size={14} /> Descargar</a>
                  </>
                ) : (
                  <span style={{ flex: '1 1 auto', fontSize: 11.5, color: 'var(--ink-3)' }}>Sin archivo</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {assets.data.length === 0 && <div className="av-vacio"><div className="av-vacio-ico"><ImageIcon size={26} /></div><div className="av-vacio-t">La biblioteca está vacía</div><div className="av-vacio-s">{canManage ? 'Sube el primer material para el equipo.' : 'Aquí aparecerán los materiales que suba Dirección.'}</div></div>}
    </div>
  )

  // Solicitudes de recurso — pedir artes/recursos a quien tenga Diseño
  const solicitudes = (
    <div className="av-seccion">
      <div className="av-seccion-head">
        <div><h2>Solicitudes de recurso</h2><p>Pide un arte o material; lo atiende quien tenga Diseño.</p></div>
        <button className="btn sm" type="button" onClick={() => setReqOpen(true)}><Plus size={14} /> Solicitar recurso</button>
      </div>
      <div className="av-lista">
        {resources.data.map((rr) => {
          const pill = rr.status === 'entregado' ? 'p-ok' : rr.status === 'en_proceso' ? 'p-blue' : 'p-warn'
          const lbl = rr.status === 'entregado' ? 'Entregado' : rr.status === 'en_proceso' ? 'En proceso' : 'Solicitado'
          return (
            <div key={rr.id} className="av-sol">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{rr.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Pidió {rr.requestedBy}</div>
              </div>
              {rr.status === 'entregado' && rr.assetUrl && (
                <a className="btn ghost sm" href={rr.assetUrl} target="_blank" rel="noreferrer" download><Eye size={14} /> Ver</a>
              )}
              {canDesign && rr.status === 'entregado' && rr.assetUrl && (
                <button className="btn sm" type="button" title="Pasar a la Biblioteca" onClick={() => toLibrary(rr)}>
                  <ImageIcon size={14} /> A biblioteca
                </button>
              )}
              <span className={'pill ' + pill}>{lbl}</span>
              {canDesign && (
                <button className="fbtn" type="button" title="Eliminar solicitud"
                  onClick={() => { if (window.confirm('¿Eliminar esta solicitud de recurso?')) resources.remove(rr.id) }}>
                  <Trash2 size={15} color="var(--danger)" />
                </button>
              )}
            </div>
          )
        })}
        {resources.data.length === 0 && <div className="av-vacio"><div className="av-vacio-ico"><ImageIcon size={26} /></div><div className="av-vacio-t">Aún no hay solicitudes</div><div className="av-vacio-s">Pide un arte o material y aquí verás cómo va.</div></div>}
      </div>
    </div>
  )

  return (
    <div className="av">
      <Pestanas grupo="avisos_equipo" pestanas={[
        { key: 'muro', label: 'Avisos', conteo: sinLeer.length, render: () => muro },
        { key: 'biblioteca', label: 'Biblioteca', render: () => biblioteca },
        { key: 'solicitudes', label: 'Solicitudes', conteo: pendientes, render: () => solicitudes },
      ]} />

      {sheetFor && (
        <CommentsSheet
          announcement={sheetFor}
          comments={social.comments(sheetFor.id)}
          onAdd={(t) => social.addComment(sheetFor.id, t, user?.name ?? 'Equipo')}
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
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)', marginTop: 6 }
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
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)', marginTop: 6 }

  const onFile = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    setFileName(f.name)
    const r = new FileReader()
    r.onload = () => setDataUrl(String(r.result))
    r.readAsDataURL(f)
  }
  const save = async () => {
    if (!key.trim() || (!file && !dataUrl) || busy) return // sin imagen no se sube (evita asset muerto)
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
          <div><h3>Subir material</h3><div className="ms">Logo, imagen o documento para el equipo.</div></div>
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
            <button className="btn" type="button" onClick={save} disabled={busy || !key.trim() || (!file && !dataUrl)} style={busy || !key.trim() || (!file && !dataUrl) ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}><Upload size={15} /> {busy ? 'Subiendo…' : 'Subir'}</button>
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
  a, authorUrl, authorRole, canManage, reacted, read, reactionCount, readCount, commentCount,
  onReact, onRead, onComments, onEdit, onPin, onDelete,
}: {
  a: Announcement
  authorUrl?: string
  authorRole?: string
  canManage: boolean
  reacted: boolean
  read: boolean
  reactionCount: number
  readCount: number
  commentCount: number
  onReact: () => void; onRead: () => void; onComments: () => void
  onEdit: () => void; onPin: () => void; onDelete: () => void
}) {
  const kind = kindOf(a)
  const aud = audienceOf(a)
  const author = authorOf(a)
  const fijado = isPinned(a)

  return (
    <article className={`av-card av-card--${kind}${fijado ? ' fijado' : ''}${read ? '' : ' nuevo'}`} data-testid="aviso">
      <header className="av-head">
        <Avatar name={author} url={authorUrl} />
        <div className="av-quien">
          <div className="av-autor">{author}</div>
          <div className="av-meta"><span title={new Date(a.created_at).toLocaleString('es-MX')}>{cuandoPublicado(a.created_at)}</span>{authorRole && <><span aria-hidden>·</span><span>{authorRole}</span></>}</div>
        </div>
        <div className="av-etiquetas">
          {fijado && <span className="av-tag av-tag--fijado"><Pin size={12} /> Fijado</span>}
          <span className={`av-tag av-tag--${kind}`}>{kind === 'aviso' ? <Bell size={12} /> : <Megaphone size={12} />} {kind === 'aviso' ? 'Aviso' : 'Anuncio'}</span>
        </div>
        {canManage && (
          <div className="av-gestion">
            <button className="fbtn" type="button" onClick={onEdit} title="Editar" aria-label="Editar"><Pencil size={15} /></button>
            <button className={'fbtn' + (fijado ? ' on' : '')} type="button" onClick={onPin} title={fijado ? 'Quitar de arriba' : 'Fijar arriba'} aria-label="Fijar"><Pin size={15} /></button>
            <button className="fbtn" type="button" onClick={onDelete} title="Borrar" aria-label="Borrar"><Trash2 size={15} color="var(--danger)" /></button>
          </div>
        )}
      </header>

      <h3 className="av-titulo">{!read && <span className="av-punto" aria-label="Nuevo" />}{a.title}</h3>
      {a.body && <div className="av-cuerpo">{conEnlaces(a.body)}</div>}
      {aud && <div className="av-para">Para: <b>{roleLabel(aud)}</b></div>}

      <footer className="av-pie">
        <button className={'av-accion' + (reacted ? ' on' : '')} type="button" onClick={onReact} aria-pressed={reacted}>
          <ThumbsUp size={16} /> Me sirve{reactionCount ? <span className="av-num">{reactionCount}</span> : null}
        </button>
        <button className="av-accion" type="button" onClick={onComments}>
          <MessageCircle size={16} /> {commentCount ? `${commentCount} ${commentCount === 1 ? 'comentario' : 'comentarios'}` : 'Comentar'}
        </button>
        <span className="av-pie-sep" />
        {read
          ? <span className="av-leido"><CheckCheck size={16} /> Enterado{canManage && readCount ? ` · lo leyeron ${readCount}` : ''}</span>
          : <button className="av-enterado" type="button" onClick={onRead}><Check size={16} /> Enterado</button>}
      </footer>
    </article>
  )
}

function Composer({ onPublish, meUrl, meName }: { onPublish: (input: { title: string; body: string; kind: AnnouncementKind; pinned: boolean; audience: RoleId | null }) => void; meUrl?: string; meName?: string }) {
  const [abierto, setAbierto] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<AnnouncementKind>('anuncio')
  const [pinned, setPinned] = useState(false)
  const [audience, setAudience] = useState<RoleId | ''>('')

  const limpiar = () => { setTitle(''); setBody(''); setPinned(false); setAudience(''); setKind('anuncio'); setAbierto(false) }
  const publish = () => {
    if (!title.trim()) return
    onPublish({ title: title.trim(), body: body.trim(), kind, pinned, audience: audience || null })
    limpiar()
  }

  if (!abierto) {
    return (
      <button type="button" className="av-escribir" onClick={() => setAbierto(true)}>
        <Avatar name={meName ?? 'Tú'} url={meUrl} />
        <span>Publica un aviso o anuncio para el equipo…</span>
        <span className="av-escribir-btn"><Plus size={15} /> Publicar</span>
      </button>
    )
  }

  return (
    <div className="av-composer">
      <div className="av-composer-tipo" role="radiogroup" aria-label="Tipo de publicación">
        <button type="button" role="radio" aria-checked={kind === 'anuncio'} className={kind === 'anuncio' ? 'on' : ''} onClick={() => setKind('anuncio')}><Megaphone size={15} /> Anuncio<small>Información general</small></button>
        <button type="button" role="radio" aria-checked={kind === 'aviso'} className={kind === 'aviso' ? 'on aviso' : ''} onClick={() => setKind('aviso')}><Bell size={15} /> Aviso<small>Algo que el equipo debe atender</small></button>
      </div>
      <input className="av-campo av-campo--titulo" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" aria-label="Título" />
      <textarea className="av-campo" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe el mensaje para el equipo…" rows={4} aria-label="Mensaje" />
      <div className="av-composer-pie">
        <label className="av-select">
          <span>Para</span>
          <select aria-label="Destinatario del anuncio" value={audience} onChange={(e) => setAudience(e.target.value as RoleId | '')}>
            <option value="">Todo el equipo</option>
            {STAFF.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        <label className="av-check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Fijar arriba</label>
        <span className="av-pie-sep" />
        <button className="btn ghost sm" type="button" onClick={limpiar}>Cancelar</button>
        <button className="btn sm" type="button" onClick={publish} disabled={!title.trim()}><Send size={14} /> Publicar</button>
      </div>
    </div>
  )
}

function CommentsSheet({ announcement, comments, onAdd, onClose }: {
  announcement: Announcement
  comments: AnnComment[]
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
                  <div className="txt">{c.body}</div>
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
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', backgroundColor: 'var(--cp-surface)', marginTop: 6 }

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
