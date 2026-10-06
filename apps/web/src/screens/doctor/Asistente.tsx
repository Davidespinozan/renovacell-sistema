// ASISTENTE IA del Portal del Doctor — concierge de PEDIDOS (UI-first, mock).
// Conversa, pero TODO sale de data real: catálogo (useProducts) y los pedidos del
// doctor (useOrders). No da consejo clínico: el motor (data/assistant/engine) lo
// defiere. Acciones reales contra ordersStore (createOrder) vía useAssistant.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Send, Plus, RefreshCw, ShoppingBag, ShieldCheck, Leaf } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useAssistant } from '../../data/hooks/useAssistant'
import { usePricing } from '../../data/hooks/usePricing'
import { useStock } from '../../data/hooks/useStock'
import { stockInfoFor } from '../../data/ops/stock'
import { clientOf } from '../../data/mock/profiles'
import { DOCTOR_ID } from '../../data/mock/orders'
import { hasSupabase, currentUserId } from '../../lib/supabase'
import { isAddressUsable, type ShippingAddress } from '../../data/ops/shippingAddress'
import { useDoctorLocations } from '../../data/hooks/useDoctorLocations'
import { initialLocationSelection, locationToShippingAddress } from '../../data/ops/doctorLocation'
import { statusView } from './orderStatus'
import type { AssistantReply } from '../../data/assistant/engine'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'
import { useCarritoCanonico } from '../../data/hooks/useCarritoCanonico'   // CC-7
import { seedReorder } from '../../data/store/reorderStore'
import { useRole } from '../../auth/RoleContext'

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
  const { priceFor } = usePricing()
  // Precio del doctor: el de SU lista (RLS) o el base — igual que el catálogo. Antes el
  // asistente cobraba siempre el precio base e ignoraba la lista Mayoreo/promos del doctor.
  const priceOf = (p: ProductSafe): number | null => priceFor(p.id, p.price)
  const stockMap = useStock()

  // Domicilio base del doctor (mismo cálculo que el checkout del catálogo): el pedido del
  // asistente debe viajar con dirección de entrega, no salir con shipping vacío.
  const myId = hasSupabase ? currentUserId() : DOCTOR_ID
  const ci = clientOf(myId)
  const baseAddr: ShippingAddress | null = ci.address && ci.address !== '—'
    ? { line1: ci.address, city: ci.city !== '—' ? ci.city : '', phone: ci.phone }
    : null

  // Multi-ubicación (Fase 2): resuelve a dónde enviar sin ELEGIR EN SILENCIO. Si hay default o
  // una sola ubicación, la usa; si hay varias sin default, NO crea y pide elegir en el Catálogo;
  // si no hay ninguna, cae al domicilio legacy o pide registrar una.
  const { data: myLocations } = useDoctorLocations()
  const resolveDelivery = (): { ok: true; address: ShippingAddress | null; locationId?: string } | { ok: false; reason: string } => {
    const sel = initialLocationSelection(myLocations)
    if (sel.mode === 'auto' && sel.selectedId) {
      const loc = myLocations.find((l) => l.id === sel.selectedId)
      if (loc) return { ok: true, address: locationToShippingAddress(loc), locationId: loc.id }
    }
    if (sel.mode === 'requires-choice') {
      return { ok: false, reason: 'Tienes varias ubicaciones de entrega y ninguna predeterminada. Elige a cuál enviar desde el Catálogo al crear el pedido, o marca una como predeterminada en Mi perfil.' }
    }
    if (isAddressUsable(baseAddr)) return { ok: true, address: baseAddr }
    return { ok: false, reason: 'Aún no tienes una dirección de entrega registrada. Agrégala en Mi perfil → Ubicaciones de entrega y vuelve a intentarlo.' }
  }

  const seq = useRef(0)
  const nextId = () => `m-${(seq.current += 1)}`
  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    { id: 'm-0', role: 'assistant', text: GREETING },
  ])
  const [draft, setDraft] = useState<DraftLine[]>([])   // solo modo demo (sin backend)
  // CC-7 · Con backend, "pedido en armado" ES el carrito canónico (el mismo del Catálogo y del Chat):
  // agregar aquí pasa por la mutación del servidor (handoff incluido) y la compra se confirma en el Catálogo.
  const canon = useCarritoCanonico(hasSupabase)
  const { setScreen } = useRole()
  const [input, setInput] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const push = (m: Omit<ChatMsg, 'id'>) => setMessages((prev) => [...prev, { id: nextId(), ...m }])

  const busyRef = useRef(false)
  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || busyRef.current) return
    busyRef.current = true
    push({ role: 'user', text })
    setInput('')
    const reply = await ask(text) // motor local instantáneo; IA real solo en charla libre
    push({ role: 'assistant', text: reply.text, reply })
    busyRef.current = false
  }

  const addToDraft = (product: ProductSafe) => {
    // No agregar más de lo disponible en inventario.
    const info = stockInfoFor(stockMap, product.id)
    const max = info.tracked ? info.qty : 0
    const cur = (hasSupabase ? canon.qty[product.id] : draft.find((d) => d.product.id === product.id)?.qty) ?? 0
    if (max <= 0) { push({ role: 'assistant', text: `${product.name} está agotado ahora mismo.` }); return }
    if (cur >= max) { push({ role: 'assistant', text: `Solo hay ${max} u de ${product.name} disponibles.` }); return }
    if (hasSupabase) {
      void canon.fijar(product.id, cur + 1)
      push({ role: 'assistant', text: `Agregué ${product.name} a tu carrito (es el mismo del Catálogo y del Chat).` })
      return
    }
    setDraft((prev) => {
      const found = prev.find((d) => d.product.id === product.id)
      if (found) return prev.map((d) => (d.product.id === product.id ? { ...d, qty: d.qty + 1 } : d))
      return [...prev, { product, qty: 1 }]
    })
    push({ role: 'assistant', text: `Agregué ${product.name} a tu pedido en armado (abajo).` })
  }

  const draftTotal = draft.reduce((s, d) => s + (priceOf(d.product) ?? 0) * d.qty, 0)

  const nArmado = hasSupabase ? Object.keys(canon.qty).length : draft.length
  const totalArmado = hasSupabase ? (canon.cart?.total.estado === 'completo' ? canon.cart.total.monto ?? 0 : null) : draftTotal
  const irAlCatalogo = () => {
    push({ role: 'assistant', text: 'Revisa tu carrito y confirma el pedido en el Catálogo: ahí eliges la dirección de entrega y si quieres factura.' })
    setScreen('catalogo')
  }

  const crearPedido = async () => {
    if (hasSupabase) { irAlCatalogo(); return }   // CC-7 · la compra canónica se confirma en el Catálogo (revisión + confirmación)
    if (draft.length === 0) return
    const d = resolveDelivery()
    if (!d.ok) { push({ role: 'assistant', text: d.reason }); return }
    const r = await createOrder({
      lines: draft.map((dl) => ({ product_id: dl.product.id, qty: dl.qty, unit_price: priceOf(dl.product) })),
      total: draftTotal,
      invoice_requested: false,
      shipping: d.address,
      location_id: d.locationId ?? null,
    })
    // El asistente solo dice "listo" cuando el servidor confirmó el pedido. Si no,
    // lo dice con la misma claridad y conserva el borrador para reintentar.
    if (!r.ok) {
      push({ role: 'assistant', text: `No pude crear tu pedido. ${r.error} Tu selección sigue aquí por si quieres intentarlo de nuevo.` })
      return
    }
    push({
      role: 'assistant',
      text: `¡Listo! Creé tu pedido ${r.order.external_ref} como pago contra pedido. Ya aparece en “Mis pedidos”.`,
      created: { folio: r.order.external_ref ?? '—' },
    })
    setDraft([])
  }

  const reorder = async (o: OrderWithItems) => {
    if (hasSupabase) {   // CC-7 · "Volver a pedir" rearma el carrito canónico en el Catálogo (capado al stock allí)
      seedReorder(o.items.map((it) => ({ product_id: it.product_id ?? '', qty: it.qty })))
      push({ role: 'assistant', text: `Rearmé ${o.external_ref ?? 'tu pedido'} en tu carrito; revísalo y confírmalo en el Catálogo.` })
      setScreen('catalogo')
      return
    }
    // Topa cada renglón al inventario disponible; descarta lo agotado.
    const lines = o.items
      .map((it) => {
        const info = stockInfoFor(stockMap, it.product_id ?? '')
        const max = info.tracked ? info.qty : 0
        return { product_id: it.product_id ?? '', qty: Math.min(it.qty, max), unit_price: it.unit_price }
      })
      .filter((l) => l.qty > 0)
    if (lines.length === 0) {
      push({ role: 'assistant', text: `No pude recrear ${o.external_ref}: esos productos están agotados ahora mismo.` })
      return
    }
    const adjusted = o.items.some((it) => {
      const info = stockInfoFor(stockMap, it.product_id ?? '')
      return it.qty > (info.tracked ? info.qty : 0)
    })
    const total = lines.reduce((s, l) => s + (l.unit_price != null ? l.unit_price * l.qty : 0), 0)
    const del = resolveDelivery()
    if (!del.ok) { push({ role: 'assistant', text: del.reason }); return }
    const r = await createOrder({ lines, total, invoice_requested: false, shipping: del.address, location_id: del.locationId ?? null })
    if (!r.ok) {
      push({ role: 'assistant', text: `No pude recrear ${o.external_ref}. ${r.error}` })
      return
    }
    push({
      role: 'assistant',
      text: `Recreé tu pedido ${o.external_ref} como ${r.order.external_ref} (pago contra pedido).${adjusted ? ' Ajusté algunas cantidades al inventario disponible.' : ''} Lo ves en “Mis pedidos”.`,
      created: { folio: r.order.external_ref ?? '—' },
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
                        <ProductRow key={p.id} p={p} price={priceOf(p)} onAdd={() => addToDraft(p)} />
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
        {nArmado > 0 && (
          <div className="asst-draft">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)', fontWeight: 700 }}>{hasSupabase ? 'Tu carrito' : 'Pedido en armado'}</div>
              <div style={{ fontSize: 13 }}>
                {nArmado} artículo(s){totalArmado != null && <> · <b className="mono">{money(totalArmado)}</b></>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              <button className="btn ghost sm" type="button" onClick={() => (hasSupabase ? void canon.vaciar() : setDraft([]))}>Vaciar</button>
              <button className="btn sm" type="button" onClick={crearPedido}><Plus size={14} /> {hasSupabase ? 'Revisar y pedir' : 'Crear pedido'}</button>
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

function ProductRow({ p, price, onAdd }: { p: ProductSafe; price: number | null; onAdd: () => void }) {
  const isProf = p.line === 'prof'
  return (
    <div className="asst-prod">
      <div className="asst-thumb">
        {p.image_url ? <img src={p.image_url} alt={p.name} /> : <Leaf size={20} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.2 }}>{p.name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.category}</div>
        <div className="mono" style={{ fontSize: 13, marginTop: 2 }}>{money(price ?? p.price)}</div>
      </div>
      <button className="btn sm" type="button" onClick={onAdd}>
        <Plus size={14} /> Agregar
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
