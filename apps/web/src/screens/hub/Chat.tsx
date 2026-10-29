// CHAT interno (hub) — con el mismo lenguaje visual del chat de mensajería (piel rc-chat--wa): lista de chats con
// foto, adelanto, hora y no leídos; hilo con encabezado verde, separadores de día, burbujas con cola, hora dentro de
// la burbuja y nombre del autor en los grupos. En escritorio lista y hilo van lado a lado; en teléfono, uno a la vez.
// Solo staff (grupos por área + directos).
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Users, Send, MessageCircle, Plus, Search, X, ArrowLeft, Trash2, CheckCheck } from 'lucide-react'
import { UserAvatar } from '../../app/UserAvatar'
import { useChat } from '../../data/hooks/useChat'
import { useUsers, type DirectoryUser } from '../../data/hooks/useUsers'
import { useRole } from '../../auth/RoleContext'
import { conEnlaces } from '../chat/ChatCanonico'
import { cuandoLista, diaDe, horaDe } from '../../lib/cuando'
import type { Conversation, Message } from '../../data/types'

// Color estable por persona para su nombre dentro de un grupo (como en un mensajero).
const COLORES_AUTOR = ['#0b7a3e', '#1f6fb2', '#a0522d', '#7b3fa0', '#b8860b', '#c2185b', '#00838f']
const colorAutor = (id: string): string => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORES_AUTOR[h % COLORES_AUTOR.length] }

// Hasta dónde leyó cada quien cada chat. Vive en este navegador (por usuario): sirve para resaltar lo nuevo, no es
// un acuse de lectura para los demás.
const claveLeido = (uid: string) => `rc_chat_leido_${uid}`
const leerLeido = (uid: string): Record<string, string> => { try { return JSON.parse(localStorage.getItem(claveLeido(uid)) ?? '{}') as Record<string, string> } catch { return {} } }
const guardarLeido = (uid: string, m: Record<string, string>) => { try { localStorage.setItem(claveLeido(uid), JSON.stringify(m)) } catch { /* sin almacenamiento: no pasa nada */ } }

export function Chat() {
  const { conversations, messagesByConv, send, ensureDirect, deleteMessage, deleteConversation, me } = useChat()
  const { data: directory } = useUsers({ staffOnly: true })
  const { user } = useRole()
  const porId = useMemo(() => {
    const m: Record<string, DirectoryUser> = {}
    directory.forEach((u) => { m[u.id] = u })
    return m
  }, [directory])
  const avatarDe = (id: string): string | undefined => (id === me.id ? user?.avatarUrl : porId[id]?.avatarUrl)
  const otroDe = (c: Conversation): string | undefined => (c.kind === 'dm' ? c.member_ids.find((id) => id !== me.id) : undefined)
  // Título visible: en un directo SIEMPRE el nombre de la otra persona (nunca el propio).
  const tituloDe = (c: Conversation): string => {
    if (c.kind !== 'dm') return c.title ?? 'Grupo'
    const otro = otroDe(c)
    const nombre = (otro && porId[otro]?.name) || c.title
    return nombre && nombre !== me.name ? nombre : 'Mensaje directo'
  }

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [buscar, setBuscar] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const conv = conversations.find((c) => c.id === selectedId) ?? null
  const msgs = useMemo(() => (conv ? messagesByConv[conv.id] ?? [] : []), [messagesByConv, conv])

  const [leido, setLeido] = useState<Record<string, string>>(() => leerLeido(me.id))
  useEffect(() => { setLeido(leerLeido(me.id)) }, [me.id])
  const noLeidos = (c: Conversation): number => {
    const desde = leido[c.id] ?? ''
    return (messagesByConv[c.id] ?? []).filter((m) => m.sender_id !== me.id && m.created_at > desde).length
  }
  // Al tener un chat abierto, lo que llega ya se considera leído.
  useEffect(() => {
    if (!conv) return
    const ultimo = msgs[msgs.length - 1]?.created_at
    if (!ultimo || (leido[conv.id] ?? '') >= ultimo) return
    const n = { ...leido, [conv.id]: ultimo }
    setLeido(n); guardarLeido(me.id, n)
  }, [conv, msgs, leido, me.id])

  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }) }, [msgs.length, selectedId])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const t = inputRef.current; if (!t) return; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 120)}px` }, [text])

  const submit = () => {
    if (!conv || !text.trim()) return
    send(conv.id, text)
    setText('')
  }

  const lista = conversations.filter((c) => !buscar.trim() || tituloDe(c).toLowerCase().includes(buscar.trim().toLowerCase()))

  // Hilo: separador por día y "inicio" de racha (cola de la burbuja + nombre del autor en grupos).
  const hilo: React.ReactNode[] = []
  if (conv) {
    let diaPrevio = ''; let autorPrevio: string | null = null
    for (const m of msgs) {
      const dia = diaDe(m.created_at)
      if (dia && dia !== diaPrevio) { hilo.push(<div key={`d-${m.id}`} className="rc-day"><span>{dia}</span></div>); diaPrevio = dia; autorPrevio = null }
      const mine = m.sender_id === me.id
      const inicio = m.sender_id !== autorPrevio
      autorPrevio = m.sender_id
      hilo.push(<Burbuja key={m.id} m={m} mine={mine} inicio={inicio} grupo={conv.kind === 'group'}
        nombre={mine ? me.name : (porId[m.sender_id]?.name ?? m.sender_name ?? 'Equipo')}
        onDelete={() => { if (window.confirm('¿Eliminar este mensaje?')) deleteMessage(conv.id, m.id) }} />)
    }
  }

  const otro = conv ? otroDe(conv) : undefined
  const subtitulo = !conv ? '' : conv.kind === 'group'
    ? (conv.member_ids.length ? `${conv.member_ids.length} integrantes` : 'Grupo del equipo')
    : (otro && porId[otro]?.role) || 'Mensaje directo'

  return (
    <div className={'tc' + (conv ? ' tc--abierto' : '')} data-testid="chat-equipo">
      <aside className="tc-lista" aria-label="Conversaciones">
        <div className="tc-lista-head">
          <span className="tc-lista-titulo">Conversaciones</span>
          <button className="tc-nuevo" type="button" onClick={() => setNewOpen(true)} aria-label="Nuevo mensaje"><Plus size={16} /> Nuevo</button>
        </div>
        <div className="tc-buscar">
          <Search size={15} aria-hidden />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar un chat" aria-label="Buscar un chat" />
        </div>
        <div className="tc-filas">
          {lista.map((c) => {
            const arr = messagesByConv[c.id] ?? []
            const last = arr[arr.length - 1]
            const n = noLeidos(c)
            const titulo = tituloDe(c)
            const autorLast = last && c.kind === 'group' && last.sender_id !== me.id ? `${(porId[last.sender_id]?.name ?? last.sender_name ?? '').split(' ')[0]}: ` : ''
            return (
              <button key={c.id} type="button" className={'tc-row' + (c.id === selectedId ? ' on' : '') + (n ? ' nueva' : '')} onClick={() => setSelectedId(c.id)} aria-current={c.id === selectedId ? 'true' : undefined}>
                <ConvAvatar conv={c} name={titulo} url={otroDe(c) ? avatarDe(otroDe(c) as string) : undefined} />
                <span className="tc-row-meta">
                  <span className="tc-row-top">
                    <span className="tc-row-nombre">{titulo}</span>
                    <span className="tc-row-cuando">{cuandoLista(last?.created_at ?? c.last_message_at ?? c.created_at)}</span>
                  </span>
                  <span className="tc-row-bottom">
                    <span className="tc-row-adelanto">
                      {last ? <>{last.sender_id === me.id && <CheckCheck size={15} className="tc-row-tick" aria-label="Tú" />}{autorLast}{last.body}</> : <i>Sin mensajes</i>}
                    </span>
                    {n > 0 && <span className="tc-badge" aria-label={`${n} sin leer`}>{n > 99 ? '99+' : n}</span>}
                  </span>
                </span>
              </button>
            )
          })}
          {conversations.length === 0 && (
            <div className="tc-vacio"><MessageCircle size={28} /><div>Aún no hay conversaciones.</div><button className="btn sm" type="button" onClick={() => setNewOpen(true)}><Plus size={14} /> Escribirle a alguien</button></div>
          )}
          {conversations.length > 0 && lista.length === 0 && <div className="tc-vacio"><div>Sin resultados.</div></div>}
        </div>
      </aside>

      <section className="tc-panel">
        {conv ? (
          <div className="rc-chat rc-chat--wa tc-hilo">
            <header className="rc-head">
              <button className="rc-ico tc-volver" type="button" aria-label="Volver a conversaciones" onClick={() => setSelectedId(null)}><ArrowLeft size={18} /></button>
              <ConvAvatar conv={conv} name={tituloDe(conv)} url={otro ? avatarDe(otro) : undefined} size={40} />
              <div className="rc-title">
                <div className="rc-name">{tituloDe(conv)}</div>
                <div className="rc-state">{subtitulo}</div>
              </div>
              {conv.kind === 'dm' && (
                <div className="rc-actions">
                  <button type="button" className="rc-ico" title="Eliminar conversación" aria-label="Eliminar conversación"
                    onClick={() => { if (window.confirm('¿Eliminar esta conversación y sus mensajes?')) { deleteConversation(conv.id); setSelectedId(null) } }}>
                    <Trash2 size={17} />
                  </button>
                </div>
              )}
            </header>
            <div className="rc-thread" aria-live="polite">
              {msgs.length === 0 && <div className="rc-sys">Escribe el primer mensaje para {tituloDe(conv)}.</div>}
              {hilo}
              <div ref={endRef} />
            </div>
            <div className="rc-composer">
              <textarea
                ref={inputRef} className="rc-input" rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                placeholder={`Mensaje a ${tituloDe(conv)}…`}
                aria-label="Escribe un mensaje"
              />
              <button className="rc-send" type="button" onClick={submit} disabled={!text.trim()} aria-label="Enviar"><Send size={18} /></button>
            </div>
          </div>
        ) : (
          <div className="tc-reposo">
            <div className="tc-reposo-ico"><MessageCircle size={30} /></div>
            <div className="tc-reposo-t">Chat del equipo</div>
            <div className="tc-reposo-s">Elige una conversación o escríbele a alguien del equipo.</div>
          </div>
        )}
      </section>

      {newOpen && (
        <NewChatModal
          onClose={() => setNewOpen(false)}
          onPick={(u) => { const id = ensureDirect(u); if (id) setSelectedId(id); setNewOpen(false) }}
        />
      )}
    </div>
  )
}

function Burbuja({ m, mine, inicio, grupo, nombre, onDelete }: { m: Message; mine: boolean; inicio: boolean; grupo: boolean; nombre: string; onDelete: () => void }) {
  return (
    <div className={`rc-msg ${mine ? 'rc-msg--own' : 'rc-msg--seller'}${inicio ? ' rc-msg--inicio' : ''} tc-msg`} data-testid={mine ? 'tc-propio' : 'tc-ajeno'}>
      {/* tabIndex: en táctil, tocar la burbuja propia muestra el botón de borrar (no hay hover). */}
      <div className="rc-bubble-wrap" tabIndex={mine ? 0 : undefined}>
        {inicio && grupo && !mine && <div className="rc-meta" style={{ color: colorAutor(m.sender_id) }}>{nombre}</div>}
        <div className="rc-bubble">{conEnlaces(m.body)}</div>
        <time className="rc-hora" dateTime={m.created_at}>{horaDe(m.created_at)}{mine && <CheckCheck className="rc-tick" size={15} aria-label="Enviado" />}</time>
        {mine && (
          <button type="button" className="tc-del" title="Eliminar mensaje" aria-label="Eliminar mensaje" onClick={onDelete}><Trash2 size={13} /></button>
        )}
      </div>
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
          <div><h3>Nuevo mensaje</h3><div className="ms">Elige a alguien del equipo para escribirle.</div></div>
          <button className="mclose" type="button" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="searchbox" style={{ width: '100%', marginBottom: 8 }}>
            <Search size={15} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar persona…" />
          </div>
          <div className="tc-directorio">
            {filtered.map((u) => (
              <button key={u.id} type="button" className="tc-pick" onClick={() => onPick(u)}>
                <UserAvatar name={u.name} url={u.avatarUrl} size={40} className="avatar" />
                <span className="tc-pick-meta"><span className="tc-pick-nombre">{u.name}</span><span className="tc-pick-rol">{u.role}</span></span>
              </button>
            ))}
            {filtered.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13.5, padding: '14px 0', textAlign: 'center' }}>Sin resultados.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConvAvatar({ conv, name, url, size = 46 }: { conv: Conversation; name: string; url?: string; size?: number }) {
  if (conv.kind === 'group') {
    return <div className="avatar tc-av-grupo" style={{ width: size, height: size }} aria-hidden><Users size={Math.round(size * 0.42)} /></div>
  }
  return <UserAvatar name={name} url={url} size={size} />
}
