// VENTAS / POS · Eventos. En expos/congresos: arma el inventario del evento
// (descuenta del almacén), véndelo en el stand con un showcase muy visual, y al
// cerrar el sobrante regresa al almacén. Todo sobre data real (mock).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { Plus, X, Store, PackagePlus, Check, ArrowLeft } from 'lucide-react'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useEvents, remaining, type SalesEvent } from '../../data/hooks/useEvents'
import { useTeam } from '../../data/hooks/useTeam'
import { useRole } from '../../auth/RoleContext'
import type { ProductSafe } from '../../data/types'

export function Eventos() {
  const { data: events } = useEvents()
  const { role, user } = useRole()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const active = events.find((e) => e.id === openId) ?? null

  // Solo veo los eventos donde soy miembro (Admin ve todos).
  const mine = useMemo(
    () => (role === 'admin' ? events : events.filter((e) => e.members.includes(user?.email ?? ''))),
    [events, role, user],
  )

  if (active) return <EventDetail event={active} onBack={() => setOpenId(null)} />

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Ventas · Eventos</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}><Plus size={14} /> Nuevo evento</button>
      </div>

      {mine.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          No tienes eventos asignados. Crea uno (expo, congreso) y arma su equipo e inventario.
        </div>
      ) : (
        mine.map((e) => (
          <button key={e.id} type="button" className="card clickrow" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--line)' }} onClick={() => setOpenId(e.id)}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--ok-bg)', color: 'var(--green-deep)', display: 'grid', placeItems: 'center', flex: 'none' }}><Store size={19} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{e.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{e.venue} · {e.date}</div>
            </div>
            <span className={'pill ' + (e.status === 'activo' ? 'p-ok' : 'p-neu')}>{e.status === 'activo' ? 'Activo' : 'Cerrado'}</span>
          </button>
        ))
      )}

      {creating && <NewEvent onClose={() => setCreating(false)} onOpen={(id) => { setCreating(false); setOpenId(id) }} />}
    </div>
  )
}

function EventDetail({ event, onBack }: { event: SalesEvent; onBack: () => void }) {
  const { data: products } = useProducts()
  const { sellAtEvent, closeEvent } = useEvents()
  const { data: team } = useTeam()
  const { user } = useRole()
  const memberNames = event.members
    .map((em) => team.find((u) => u.email === em)?.name.split('·')[0].trim() ?? em)
    .join(', ')
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, ProductSafe | undefined>, [products])

  const [cart, setCart] = useState<Record<string, number>>({})
  const [assignOpen, setAssignOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const closed = event.status === 'cerrado'

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400) }
  const left = (productId: string) => {
    const it = event.items.find((x) => x.product_id === productId)
    return it ? remaining(it) : 0
  }
  const add = (id: string) => setCart((c) => ({ ...c, [id]: Math.min((c[id] ?? 0) + 1, left(id)) }))
  const dec = (id: string) => setCart((c) => { const q = (c[id] ?? 0) - 1; if (q <= 0) { const { [id]: _x, ...r } = c; return r } return { ...c, [id]: q } })

  const lines = Object.entries(cart).map(([id, qty]) => ({ p: byId[id], qty })).filter((l) => l.p)
  const total = lines.reduce((s, l) => s + (l.p!.price ?? 0) * l.qty, 0)
  const vendido = event.items.reduce((s, it) => s + it.sold * (byId[it.product_id]?.price ?? 0), 0)

  const cobrar = () => {
    if (lines.length === 0) return
    const order = sellAtEvent(event.id, lines.map((l) => ({ product_id: l.p!.id, qty: l.qty, unit_price: l.p!.price ?? 0 })), total, 'efectivo', user?.email ?? null)
    if (!order) { flash('No se pudo cobrar — revisa el stock del stand.'); return }
    setCart({})
    flash(`Venta registrada · ${money(total)}`)
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn ghost sm" type="button" onClick={onBack}><ArrowLeft size={14} /> Eventos</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{event.name}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{event.venue} · {event.date}{memberNames ? ` · Equipo: ${memberNames}` : ''}</div>
        </div>
        <span className={'pill ' + (closed ? 'p-neu' : 'p-ok')} style={{ marginLeft: 'auto' }}>{closed ? 'Cerrado' : 'Activo'}</span>
        {!closed && <button className="btn ghost sm" type="button" onClick={() => setAssignOpen(true)}><PackagePlus size={14} /> Asignar inventario</button>}
        {!closed && event.items.length > 0 && <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => { closeEvent(event.id); flash('Evento cerrado · sobrante regresó al almacén') }}>Cerrar evento</button>}
      </div>

      <div className="grid sigs">
        <div className="card sig"><div className="chip"><Icon name="store" /></div><div className="v">{money(vendido)}</div><div className="k">Vendido</div><div className="s">en el evento</div></div>
        <div className="card sig"><div className="chip"><Icon name="box" /></div><div className="v">{event.items.reduce((s, it) => s + remaining(it), 0)}</div><div className="k">Piezas en stand</div><div className="s">disponibles</div></div>
      </div>

      {event.items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Sin inventario asignado. Usa “Asignar inventario” para llevar productos a este evento.
        </div>
      ) : (
        <div className="grid pos-wrap">
          {/* Showcase visual */}
          <div className="pgrid">
            {event.items.map((it) => {
              const p = byId[it.product_id]
              if (!p) return null
              const rem = remaining(it)
              const qty = cart[p.id] ?? 0
              return (
                <div key={it.product_id} className="pcard">
                  <div className="ptile cosm" style={p.image_url ? { padding: 0, overflow: 'hidden' } : undefined}>
                    {p.image_url ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="leaf" />}
                  </div>
                  <div className="pb">
                    <h5>{p.name}</h5>
                    <div style={{ fontSize: 11, color: rem > 0 ? 'var(--ink-3)' : 'var(--danger)', marginTop: 3 }}>{rem > 0 ? `Quedan ${rem}` : 'Agotado en stand'}</div>
                    <div className="pr">{money(p.price)}</div>
                    {!closed && (qty === 0 ? (
                      <button className="addb" type="button" disabled={rem <= 0} style={rem <= 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => add(p.id)}><Plus size={15} /> Vender</button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                        <button className="btn ghost sm" type="button" onClick={() => dec(p.id)}><Icon name="minus" /></button>
                        <span className="mono" style={{ fontSize: 15 }}>{qty}</span>
                        <button className="btn sm" type="button" disabled={qty >= rem} onClick={() => add(p.id)}><Icon name="plus" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Ticket */}
          <div className="card ticket" style={{ position: 'sticky', top: 90 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <Store size={18} style={{ color: 'var(--green-deep)' }} />
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Venta</h3>
              {lines.length > 0 && <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setCart({})}>Vaciar</button>}
            </div>
            {lines.length === 0 ? (
              <div className="empty">Toca un producto del stand para venderlo.</div>
            ) : (
              <>
                {lines.map((l) => (
                  <div key={l.p!.id} className="titem">
                    <div><div>{l.p!.name}</div><div className="tl">{money(l.p!.price)} × {l.qty}</div></div>
                    <span className="mono">{money((l.p!.price ?? 0) * l.qty)}</span>
                  </div>
                ))}
                <div className="tket-total" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}><span>Total</span><b>{money(total)}</b></div>
                <button className="btn" type="button" style={{ width: '100%', marginTop: 14 }} onClick={cobrar}><Check size={16} /> Cobrar {money(total)}</button>
              </>
            )}
          </div>
        </div>
      )}

      {assignOpen && <AssignModal event={event} onClose={() => setAssignOpen(false)} onDone={(m) => { setAssignOpen(false); flash(m) }} />}
      {toast && <div className="toast show"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function AssignModal({ event, onClose, onDone }: { event: SalesEvent; onClose: () => void; onDone: (msg: string) => void }) {
  const { data: products } = useProducts()
  const { assignStock } = useEvents()
  const sellable = products.filter((p) => p.price != null && isActiveProduct(p))
  const [productId, setProductId] = useState(sellable[0]?.id ?? '')
  const [qty, setQty] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }

  const save = () => {
    const n = Number(qty)
    if (!productId || n <= 0) return
    const res = assignStock(event.id, productId, n)
    if (!res.ok) { setErr(res.missing != null ? `Sin stock suficiente en almacén (faltan ${res.missing}).` : 'No se pudo asignar.'); return }
    onDone(`Inventario asignado al evento (+${n} u)`)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><div><h3>Asignar inventario</h3><div className="ms">Lo que lleves al evento se descuenta del almacén.</div></div><button className="mclose" type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody">
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)' }}>Producto</label>
          <select style={input} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {sellable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--ink-3)', display: 'block', marginTop: 14 }}>Cantidad a llevar</label>
          <input style={input} type="number" min={1} value={qty} onChange={(e) => { setQty(e.target.value); setErr(null) }} placeholder="0" />
          {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><span>{err}</span></div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={save}><PackagePlus size={15} /> Asignar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NewEvent({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const { createEvent } = useEvents()
  const { data: team } = useTeam()
  const { user } = useRole()
  const candidates = team.filter((u) => u.active && u.capabilities.includes('eventos'))
  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState('')
  const [members, setMembers] = useState<string[]>(user?.email ? [user.email] : [])
  const toggle = (email: string) => setMembers((m) => (m.includes(email) ? m.filter((x) => x !== email) : [...m, email]))
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  const create = () => {
    const final = members.length > 0 ? members : (user?.email ? [user.email] : [])
    onOpen(createEvent({ name: name.trim(), venue: venue.trim() || 'Por definir', date: date || '—', members: final }).id)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><div><h3>Nuevo evento</h3><div className="ms">Expo, congreso o stand.</div></div><button className="mclose" type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Congreso Derma CDMX" />
          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div><label style={label}>Sede</label><input style={input} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="WTC CDMX" /></div>
            <div><label style={label}>Fecha</label><input style={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <label style={label}>Equipo del evento (quién lo atiende)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {candidates.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Nadie tiene la responsabilidad “Eventos” aún (asígnala en Equipo).</span>}
            {candidates.map((u) => (
              <button key={u.id} type="button" className={'fchip' + (members.includes(u.email) ? ' on' : '')} onClick={() => toggle(u.email)}>
                {members.includes(u.email) ? '✓ ' : '+ '}{u.name.split('·')[0].trim()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={create}>
              <Plus size={15} /> Crear y armar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
