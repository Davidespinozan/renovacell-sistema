// CHAT interno (hub) — tipo WhatsApp: grupos por área + DMs. Solo staff (add-on
// Comunicación). UI-first: mock detrás de useChat (forma conversations/messages).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Users, Send, MessageCircle } from 'lucide-react'
import { timeAgo, initials, avatarColor } from '../../lib/format'
import { useChat } from '../../data/hooks/useChat'
import type { Conversation } from '../../data/types'

export function Chat() {
  const { conversations, messagesByConv, send, me } = useChat()
  const [selectedId, setSelectedId] = useState<string>(conversations[0]?.id ?? '')
  const [text, setText] = useState('')
  const conv = conversations.find((c) => c.id === selectedId) ?? conversations[0]
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
      <div className="eyebrow">Hub Renovacell · Chat</div>
      <div className="chat-wrap">
        {/* Lista de conversaciones */}
        <div className="conv-list">
          {conversations.map((c) => {
            const arr = messagesByConv[c.id] ?? []
            const last = arr[arr.length - 1]
            const preview = last ? `${last.sender_id === me.id ? 'Tú: ' : ''}${last.body}` : 'Sin mensajes'
            return (
              <div key={c.id} className={'conv' + (c.id === conv?.id ? ' on' : '')} onClick={() => setSelectedId(c.id)}>
                <ConvAvatar conv={c} />
                <div className="cmeta">
                  <div className="cnm">{c.title}</div>
                  <div className="clast">{preview}</div>
                </div>
                <div className="cwhen">{timeAgo(c.last_message_at ?? c.created_at)}</div>
              </div>
            )
          })}
        </div>

        {/* Hilo */}
        {conv ? (
          <div className="thread">
            <div className="thread-head">
              <ConvAvatar conv={conv} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{conv.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{conv.kind === 'group' ? 'Grupo' : 'Mensaje directo'}</div>
              </div>
            </div>

            <div className="bubbles">
              {msgs.length === 0 && <div style={{ margin: 'auto', color: 'var(--ink-3)', fontSize: 13 }}>Inicia la conversación.</div>}
              {msgs.map((m) => {
                const mine = m.sender_id === me.id
                return (
                  <div key={m.id} className={'bubble' + (mine ? ' me' : '')}>
                    {!mine && conv.kind === 'group' && <div className="who">{m.sender_name}</div>}
                    <div className="btxt">{m.body}</div>
                    <div className="bwhen">{timeAgo(m.created_at)}</div>
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
          <div style={{ display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
            <div style={{ textAlign: 'center' }}><MessageCircle size={28} /><div style={{ marginTop: 8 }}>Sin conversaciones</div></div>
          </div>
        )}
      </div>
    </div>
  )
}

function ConvAvatar({ conv }: { conv: Conversation }) {
  if (conv.kind === 'group') {
    return (
      <div className="avatar" style={{ background: avatarColor(conv.title ?? 'g') }} aria-hidden>
        <Users size={18} />
      </div>
    )
  }
  return <div className="avatar" style={{ background: avatarColor(conv.title ?? '?') }}>{initials(conv.title ?? '?')}</div>
}
