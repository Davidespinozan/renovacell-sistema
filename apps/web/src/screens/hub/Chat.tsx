// CHAT interno (hub) — estilo WhatsApp: solo grupos por área + DMs, staff only.
// Single-pane: por default se ve la LISTA; al abrir un chat ocupa todo el panel
// con una flecha para volver. UI-first: mock detrás de useChat.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Users, Send, MessageCircle, Plus, Search, X, ArrowLeft, Trash2 } from 'lucide-react'
import { timeAgo } from '../../lib/format'
import { UserAvatar } from '../../app/UserAvatar'
import { useChat } from '../../data/hooks/useChat'
import { useUsers, type DirectoryUser } from '../../data/hooks/useUsers'
import { useRole } from '../../auth/RoleContext'
import type { Conversation } from '../../data/types'

export function Chat() {
  const { conversations, messagesByConv, send, ensureDirect, deleteMessage, deleteConversation, me } = useChat()
  const { data: directory } = useUsers({ staffOnly: true })
  const { user } = useRole()
  // Mapa id → foto (incluye la mía) para pintar avatares de otros usuarios.
  const avatarById = useMemo(() => {
    const m: Record<string, string | undefined> = {}
    directory.forEach((u) => { m[u.id] = u.avatarUrl })
    if (me.id) m[me.id] = user?.avatarUrl
    return m
  }, [directory, me.id, user])
  const [selectedId, setSelectedId] = useState<string | null>(null) // ninguno abierto por default
  const [text, setText] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const conv = conversations.find((c) => c.id === selectedId) ?? null
  // Foto del otro miembro de un DM (para la lista y la cabecera del hilo).
  const dmAvatar = (c: Conversation): string | undefined => {
    if (c.kind !== 'dm') return undefined
    const otherId = c.member_ids.find((id) => id !== me.id)
    return otherId ? avatarById[otherId] : undefined
  }
  const msgs = useMemo(() => (conv ? messagesByConv[conv.id] ?? [] : []), [messagesByConv, conv])

  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, selectedId])

  const submit = () => {
    if (!conv || !text.trim()) return
    send(conv.id, text)
    setText('')
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="chat-wrap">
        {conv ? (
          /* Hilo a pantalla completa con botón para volver a la lista */
          <div className="thread">
            <div className="thread-head">
              <button className="chat-back" type="button" aria-label="Volver a conversaciones" onClick={() => setSelectedId(null)}>
                <ArrowLeft size={18} />
              </button>
              <ConvAvatar conv={conv} url={dmAvatar(conv)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{conv.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{conv.kind === 'group' ? 'Grupo' : 'Mensaje directo'}</div>
              </div>
              {conv.kind === 'dm' && (
                <button
                  type="button"
                  className="iconbtn-round"
                  title="Eliminar conversación"
                  aria-label="Eliminar conversación"
                  onClick={() => { if (window.confirm('¿Eliminar esta conversación y sus mensajes?')) { deleteConversation(conv.id); setSelectedId(null) } }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div className="bubbles">
              {msgs.length === 0 && <div style={{ margin: 'auto', color: 'var(--ink-3)', fontSize: 13 }}>Inicia la conversación.</div>}
              {msgs.map((m) => {
                const mine = m.sender_id === me.id
                const showAvatar = !mine && conv.kind === 'group'
                return (
                  <div key={m.id} className={'brow' + (mine ? ' me' : '')}>
                    {showAvatar && <UserAvatar name={m.sender_name ?? '?'} url={avatarById[m.sender_id]} size={28} className="avatar sm" />}
                    <div className={'bubble' + (mine ? ' me' : '')} style={{ position: 'relative' }}>
                      {showAvatar && <div className="who">{m.sender_name}</div>}
                      <div className="btxt">{m.body}</div>
                      <div className="bwhen">{timeAgo(m.created_at)}</div>
                      {mine && (
                        <button
                          type="button"
                          className="bubble-del"
                          title="Eliminar mensaje"
                          aria-label="Eliminar mensaje"
                          onClick={() => { if (window.confirm('¿Eliminar este mensaje?')) deleteMessage(conv.id, m.id) }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>

            <div className="composer-bar">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={`Mensaje a ${conv.title}…`}
              />
              <button className="iconbtn-round" type="button" onClick={submit} aria-label="Enviar"><Send size={17} /></button>
            </div>
          </div>
        ) : (
          /* Lista de conversaciones (nada abierto) */
          <div className="conv-list">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Conversaciones</span>
              <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setNewOpen(true)}><Plus size={14} /> Nuevo</button>
            </div>
            {conversations.map((c) => {
              const arr = messagesByConv[c.id] ?? []
              const last = arr[arr.length - 1]
              const preview = last ? `${last.sender_id === me.id ? 'Tú: ' : ''}${last.body}` : 'Sin mensajes'
              return (
                <div key={c.id} className="conv" onClick={() => setSelectedId(c.id)}>
                  <ConvAvatar conv={c} url={dmAvatar(c)} />
                  <div className="cmeta">
                    <div className="cnm">{c.title}</div>
                    <div className="clast">{preview}</div>
                  </div>
                  <div className="cwhen">{timeAgo(c.last_message_at ?? c.created_at)}</div>
                </div>
              )
            })}
            {conversations.length === 0 && (
              <div style={{ display: 'grid', placeItems: 'center', padding: 40, color: 'var(--ink-3)' }}>
                <div style={{ textAlign: 'center' }}><MessageCircle size={28} /><div style={{ marginTop: 8 }}>Sin conversaciones</div></div>
              </div>
            )}
          </div>
        )}
      </div>

      {newOpen && (
        <NewChatModal
          onClose={() => setNewOpen(false)}
          onPick={(u) => { const id = ensureDirect(u); if (id) setSelectedId(id); setNewOpen(false) }}
        />
      )}
    </div>
  )
}

function NewChatModal({ onClose, onPick }: { onClose: () => void; onPick: (u: DirectoryUser) => void }) {
  const { data: users } = useUsers({ staffOnly: true }) // chat interno: solo staff (sin doctores)
  const [q, setQ] = useState('')
  const filtered = users.filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Nuevo mensaje</h3><div className="ms">Busca a cualquier usuario para abrir un chat.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="searchbox" style={{ width: '100%', marginBottom: 8 }}>
            <Search size={15} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…" />
          </div>
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            {filtered.map((u) => (
              <div key={u.id} className="lrow clickrow" style={{ cursor: 'pointer' }} onClick={() => onPick(u)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <UserAvatar name={u.name} url={u.avatarUrl} size={34} className="avatar sm" />
                  <div>
                    <div className="nm">{u.name}</div>
                    <div className="lt">{u.role}</div>
                  </div>
                </div>
                <span className="pill p-neu">Chatear</span>
              </div>
            ))}
            {filtered.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '14px 0', textAlign: 'center' }}>Sin resultados.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConvAvatar({ conv, url }: { conv: Conversation; url?: string }) {
  if (conv.kind === 'group') {
    return <div className="avatar" style={{ background: 'var(--green-deep)' }} aria-hidden><Users size={18} /></div>
  }
  return <UserAvatar name={conv.title ?? '?'} url={url} />
}
