// ASISTENTE IA del Portal del Doctor — concierge de PEDIDOS (UI-first, mock).
// Conversa, pero TODO sale de data real: catálogo (useProducts) y los pedidos del
// doctor (useOrders). No da consejo clínico: el motor (data/assistant/engine) lo
// defiere. Acciones reales contra ordersStore (createOrder) vía useAssistant.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Send, Plus, FileText, RefreshCw, ShoppingBag, ShieldCheck, Leaf } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAssistant } from '../../data/hooks/useAssistant'
import { statusView } from './orderStatus'
import type { AssistantReply } from '../../data/assistant/engine'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'

interface ChatMsg {
  id: string
  role: 'user' | 'assistant'
  text: string
  reply?: AssistantReply
  created?: { folio: string }
}
interface DraftLine { product: ProductSafe; qty: number }

const GREETING =
  '¡Hola, Dra.! Soy tu asistente de pedidos de Renovacell. Te ayudo a descubrir productos del ' +
  'catálogo, armar o reordenar pedidos y ver el estatus de los tuyos. ¿Qué necesitas?'

export function Asistente() {
  const { ask, createOrder } = useAssistant()

  const seq = useRef(0)
  const nextId = () => `m-${(seq.current += 1)}`
  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    { id: 'm-0', role: 'assistant', text: GREETING },
  ])
  const [draft, setDraft] = useState<DraftLine[]>([])
  const [input, setInput] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const push = (m: Omit<ChatMsg, 'id'>) => setMessages((prev) => [...prev, { id: nextId(), ...m }])

  const send = (raw: string) => {
    const text = raw.trim()
    if (!text) return
    push({ role: 'user', text })
    const reply = ask(text)
    push({ role: 'assistant', text: reply.text, reply })
    setInput('')
  }

  const addToDraft = (product: ProductSafe) => {
    setDraft((prev) => {
      const found = prev.find((d) => d.product.id === product.id)
      if (found) return prev.map((d) => (d.product.id === product.id ? { ...d, qty: d.qty + 1 } : d))
      return [...prev, { product, qty: 1 }]
    })
    push({
      role: 'assistant',
      text: `Agregué ${product.name}${product.price == null ? ' (a cotizar)' : ''} a tu pedido en armado (abajo).`,
    })
  }

  const buy = draft.filter((d) => d.product.price != null)
  const quoteCount = draft.length - buy.length
  const draftTotal = buy.reduce((s, d) => s + (d.product.price ?? 0) * d.qty, 0)

  const crearPedido = () => {
    if (draft.length === 0) return
    const order = createOrder({
      lines: draft.map((d) => ({ product_id: d.product.id, qty: d.qty, unit_price: d.product.price })),
      total: draftTotal,
      invoice_requested: false,
    })
    push({
      role: 'assistant',
      text:
        `¡Listo! Creé tu pedido ${order.external_ref} como pago contra pedido` +
        `${quoteCount > 0 ? ', con tus productos a cotizar incluidos' : ''}. Ya aparece en “Mis pedidos”.`,
      created: { folio: order.external_ref ?? '—' },
    })
    setDraft([])
  }

  const reorder = (o: OrderWithItems) => {
    const order = createOrder({
      lines: o.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty, unit_price: it.unit_price })),
      total: o.total ?? 0,
      invoice_requested: false,
    })
    push({
      role: 'assistant',
      text: `Recreé tu pedido ${o.external_ref} como ${order.external_ref} (pago contra pedido). Lo ves en “Mis pedidos”.`,
      created: { folio: order.external_ref ?? '—' },
    })
  }

  const chips = useMemo(
    () => [
      { label: 'Buscar un producto para…', prefill: 'Busco un producto para ' },
      { label: 'Reordenar mi último pedido', query: 'reordenar mi último pedido' },
      { label: 'Estatus de mi pedido', query: 'estatus de mi pedido' },
      { label: 'Ver línea Professional', query: 'ver línea professional' },
    ],
    [],
  )

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="eyebrow">Portal del Doctor · Asistente</div>

      {/* Nota de alcance SIEMPRE visible (cliente regulado) */}
      <div className="sysnote" style={{ background: 'var(--blue-bg)', borderColor: '#CFE0EC', color: 'var(--blue)' }}>
        <ShieldCheck size={18} />
        <span>Asistente de <b>pedidos</b>: catálogo, pedidos y estatus. No da consejo clínico.</span>
      </div>

      <div className="asst-shell">
        <div className="bubbles">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="bubble me">{m.text}</div>
            ) : (
              <div key={m.id} className="asst-row">
                <div className="asst-av"><Sparkles size={16} /></div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="bubble" style={{ maxWidth: '100%' }}>
                    <span style={{ whiteSpace: 'pre-line' }}>{m.text}</span>
                  </div>
                  {m.reply?.products && m.reply.products.length > 0 && (
                    <div className="asst-prods">
                      {m.reply.products.map((p) => (
                        <ProductRow key={p.id} p={p} onAdd={() => addToDraft(p)} />
                      ))}
                    </div>
                  )}
                  {m.reply?.statusOrders && m.reply.statusOrders.length > 0 && (
                    <div className="asst-prods">
                      {m.reply.statusOrders.map((o) => <StatusRow key={o.id} o={o} />)}
                    </div>
                  )}
                  {m.reply?.reorder && (
                    <ReorderRow o={m.reply.reorder} onReorder={() => reorder(m.reply!.reorder!)} />
                  )}
                  {m.created && (
                    <div className="asst-ok"><ShoppingBag size={15} /> Pedido <b>{m.created.folio}</b> creado.</div>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>

        {/* Pedido en armado */}
        {draft.length > 0 && (
          <div className="asst-draft">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)', fontWeight: 700 }}>Pedido en armado</div>
              <div style={{ fontSize: 13 }}>
                {draft.length} artículo(s){quoteCount > 0 ? ` · ${quoteCount} a cotizar` : ''} · <b className="mono">{money(draftTotal)}</b>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button className="btn ghost sm" type="button" onClick={() => setDraft([])}>Vaciar</button>
              <button className="btn sm" type="button" onClick={crearPedido}><Plus size={14} /> Crear pedido</button>
            </div>
          </div>
        )}

        <div className="asst-foot">
          <div className="fchips asst-chips">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                className="fchip"
                onClick={() => (c.query ? send(c.query) : (setInput(c.prefill ?? ''), inputRef.current?.focus()))}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="composer-bar">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && send(input)}
              placeholder="Escribe: “algo para el cabello”, “estatus de mi pedido”…"
            />
            <button className="iconbtn-round" type="button" onClick={() => send(input)} aria-label="Enviar"><Send size={17} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProductRow({ p, onAdd }: { p: ProductSafe; onAdd: () => void }) {
  const isProf = p.line === 'prof'
  return (
    <div className="asst-prod">
      <div className="asst-thumb">
        {p.image_url ? <img src={p.image_url} alt={p.name} /> : <Leaf size={20} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.category}</div>
        <div className="mono" style={{ fontSize: 13, marginTop: 2 }}>{money(p.price)}</div>
      </div>
      <button className={'btn sm' + (isProf ? ' ghost' : '')} type="button" onClick={onAdd}>
        {isProf ? <><FileText size={14} /> Cotización</> : <><Plus size={14} /> Agregar</>}
      </button>
    </div>
  )
}

function StatusRow({ o }: { o: OrderWithItems }) {
  const sv = statusView(o.status)
  return (
    <div className="asst-prod">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{o.external_ref}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(o.created_at)} · {money(o.total)}</div>
      </div>
      <span className={'pill ' + sv.pill}>{sv.label}</span>
    </div>
  )
}

function ReorderRow({ o, onReorder }: { o: OrderWithItems; onReorder: () => void }) {
  return (
    <div className="asst-prod" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{o.external_ref}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>
          {o.items.length} renglón(es) · <b className="mono">{money(o.total)}</b>
        </div>
      </div>
      <button className="btn sm" type="button" onClick={onReorder}><RefreshCw size={14} /> Recrear</button>
    </div>
  )
}
