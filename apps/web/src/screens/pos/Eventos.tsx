// VENTAS / POS · Eventos. En expos/congresos: arma el inventario del evento
// (descuenta del almacén), véndelo en el stand con un showcase muy visual, y al
// cerrar el sobrante regresa al almacén. Todo sobre data real (mock).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { Plus, X, Store, PackagePlus, Check, ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import { money } from '../../lib/format'
import { ExportButton } from '../../app/ExportButton'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useEvents, remaining, type SalesEvent } from '../../data/hooks/useEvents'
import { useTeam } from '../../data/hooks/useTeam'
import { useLots } from '../../data/hooks/useLots'
import { stockByProduct, stockInfoFor } from '../../data/ops/stock'
import { useRole } from '../../auth/RoleContext'
import { VentaTicketPrint, enviarReciboWhatsApp, imprimirVenta, type Pago } from './ventaRecibo'
import type { ProductSafe } from '../../data/types'
import type { OrderWithItems } from '../../data/hooks/useOrders'

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
        <ExportButton name="eventos" rows={mine} style={{ marginLeft: 'auto' }} columns={[
          { key: 'name', label: 'Evento' },
          { key: 'venue', label: 'Sede' },
          { key: 'date', label: 'Fecha' },
          { key: 'status', label: 'Estatus', format: (v) => (v === 'activo' ? 'Activo' : 'Cerrado') },
        ]} />
        <button className="btn sm" type="button" onClick={() => setCreating(true)}><Plus size={14} /> Nuevo evento</button>
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
  const { sellAtEvent, unassignStock, closeEvent, updateEvent, deleteEvent } = useEvents()
  const { data: team } = useTeam()
  const { user } = useRole()
  const [editOpen, setEditOpen] = useState(false)
  const memberNames = event.members
    .map((em) => team.find((u) => u.email === em)?.name.split('·')[0].trim() ?? em)
    .join(', ')
  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, ProductSafe | undefined>, [products])

  const [cart, setCart] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<'efectivo' | 'tarjeta'>('efectivo')
  const [recibido, setRecibido] = useState('') // efectivo con el que paga el cliente
  const [assignOpen, setAssignOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [done, setDone] = useState<OrderWithItems | null>(null) // venta hecha → recibo
  const [lastPago, setLastPago] = useState<Pago | null>(null)
  const productName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const closed = event.status === 'cerrado'

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2400) }
  const left = (productId: string) => {
    const it = event.items.find((x) => x.product_id === productId)
    return it ? remaining(it) : 0
  }
  // Regresar al almacén stock sobre-asignado al stand, sin cerrar el evento (tope = en stand).
  const regresar = (productId: string, rem: number, name: string) => {
    const raw = window.prompt(`¿Cuántas unidades de ${name} regresar al almacén? (máx. ${rem})`, String(rem))
    if (raw == null) return
    const n = Math.floor(Number(raw))
    if (!Number.isFinite(n) || n <= 0) { flash('Cantidad inválida.'); return }
    const r = unassignStock(event.id, productId, n)
    if (r.ok) flash(`Regresaste ${r.returned} u de ${name} al almacén.`)
    else flash('No se pudo regresar (¿ya se vendió?).')
  }
  const add = (id: string) => setCart((c) => ({ ...c, [id]: Math.min((c[id] ?? 0) + 1, left(id)) }))
  const dec = (id: string) => setCart((c) => { const q = (c[id] ?? 0) - 1; if (q <= 0) { const { [id]: _x, ...r } = c; return r } return { ...c, [id]: q } })

  const lines = Object.entries(cart).map(([id, qty]) => ({ p: byId[id], qty })).filter((l) => l.p)
  const total = lines.reduce((s, l) => s + (l.p!.price ?? 0) * l.qty, 0)
  const vendido = event.items.reduce((s, it) => s + it.sold * (byId[it.product_id]?.price ?? 0), 0)
  const recibidoN = Math.max(0, Number(recibido) || 0)
  const cambio = recibidoN - total
  // En efectivo no se cobra si el recibido no alcanza el total (evita cambio negativo).
  const efectivoOk = method !== 'efectivo' || recibido === '' ? true : recibidoN >= total

  const cobrar = () => {
    if (lines.length === 0 || !efectivoOk) return
    const order = sellAtEvent(event.id, lines.map((l) => ({ product_id: l.p!.id, qty: l.qty, unit_price: l.p!.price ?? 0 })), total, method, user?.email ?? null)
    if (!order) { flash('No se pudo cobrar — revisa el stock del stand.'); return }
    const pago = method === 'efectivo' && recibido !== '' ? { recibido: recibidoN, cambio } : null
    setLastPago(pago)
    setDone(order)
    setCart({})
    setRecibido('')
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
        {event.items.length > 0 && (
          <ExportButton
            name={`evento-${event.name}`}
            rows={event.items.map((it) => { const p = byId[it.product_id]; return { producto: p?.name ?? 'Producto', precio: p?.price ?? null, asignado: it.assigned, vendido: it.sold, restante: remaining(it), valor_vendido: (p?.price ?? 0) * it.sold } })}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'precio', label: 'Precio', format: (v) => money(v as number) },
              { key: 'asignado', label: 'Asignado' },
              { key: 'vendido', label: 'Vendido' },
              { key: 'restante', label: 'En stand' },
              { key: 'valor_vendido', label: 'Valor vendido', format: (v) => money(v as number) },
            ]}
          />
        )}
        {!closed && <button className="btn ghost sm" type="button" onClick={() => setAssignOpen(true)}><PackagePlus size={14} /> Asignar inventario</button>}
        {!closed && <button className="btn ghost sm" type="button" onClick={() => setEditOpen(true)}><Pencil size={14} /> Editar</button>}
        {!closed && event.items.length > 0 && <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => { closeEvent(event.id); flash('Evento cerrado · sobrante regresó al almacén') }}>Cerrar evento</button>}
        <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => { if (window.confirm('¿Eliminar este evento? El sobrante asignado regresa al almacén.')) { deleteEvent(event.id); onBack() } }}><Trash2 size={14} /> Eliminar</button>
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
                    {p.image_url ? <img src={p.image_url} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff', padding: 8 }} /> : <Icon name="leaf" />}
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
                    {!closed && rem > 0 && (
                      <button type="button" onClick={() => regresar(p.id, rem, p.name)} style={{ marginTop: 6, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--ink-3)', fontSize: 11, fontFamily: 'inherit', textDecoration: 'underline' }}>Regresar al almacén</button>
                    )}
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
                <div style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700, margin: '14px 0 6px' }}>Pago</div>
                <div className="seg">
                  <button type="button" className={method === 'efectivo' ? 'active' : undefined} onClick={() => setMethod('efectivo')}>Efectivo</button>
                  <button type="button" className={method === 'tarjeta' ? 'active' : undefined} onClick={() => setMethod('tarjeta')}>Tarjeta</button>
                </div>
                {method === 'efectivo' && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-3)', minWidth: 56 }}>Recibí</span>
                      <input type="number" min={0} value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="¿con cuánto paga? (opcional)"
                        style={{ flex: 1, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 15, outline: 'none', background: '#fff' }} />
                    </div>
                    {recibido !== '' && (
                      <div className="tket-total" style={{ marginTop: 8, color: cambio < 0 ? 'var(--danger)' : 'var(--green-deep)' }}>
                        <span>{cambio < 0 ? 'Falta' : 'Cambio'}</span><b>{money(Math.abs(cambio))}</b>
                      </div>
                    )}
                  </div>
                )}
                <button className="btn" type="button" style={{ width: '100%', marginTop: 14, ...(!efectivoOk ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }} onClick={cobrar} disabled={!efectivoOk}><Check size={16} /> Cobrar {money(total)}</button>
              </>
            )}
          </div>
        </div>
      )}

      {assignOpen && <AssignModal event={event} onClose={() => setAssignOpen(false)} onDone={(m) => { setAssignOpen(false); flash(m) }} />}
      {editOpen && <EditEvent event={event} onClose={() => setEditOpen(false)} onSave={(patch) => { updateEvent(event.id, patch); setEditOpen(false); flash('Evento actualizado') }} />}

      {done && (
        <div className="overlay" onClick={() => setDone(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mbody">
              <div className="success">
                <div className="ck"><Check size={20} /></div>
                <h3>Venta registrada</h3>
                <p>
                  <b>{done.external_ref}</b> · {money(done.total)} · {done.payment_method === 'tarjeta' ? 'Tarjeta' : 'Efectivo'} · {event.name}.
                  Descontado del stand. Ya suma en “Ventas del evento”.
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn ghost" type="button" onClick={imprimirVenta}><Icon name="download" /> Imprimir recibo</button>
                  <button className="btn ghost" type="button" onClick={() => enviarReciboWhatsApp(done, productName, lastPago)}><Icon name="chat" /> Enviar por WhatsApp</button>
                  <button className="btn" type="button" onClick={() => setDone(null)}>Nueva venta</button>
                </div>
              </div>
            </div>
          </div>
          <VentaTicketPrint order={done} productName={productName} pago={lastPago} clientName={`Evento · ${event.name}`} />
        </div>
      )}

      {toast && <div className="toast show"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function AssignModal({ event, onClose, onDone }: { event: SalesEvent; onClose: () => void; onDone: (msg: string) => void }) {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { assignStock } = useEvents()
  const sellable = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p)), [products])
  const stockMap = useMemo(() => stockByProduct(lots), [lots])

  // Se arma la carga tocando productos (como en el punto de venta), en vez de
  // elegirlos uno por uno en un desplegable: con catálogo grande eso es tedioso.
  const [cart, setCart] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const disponible = (id: string) => { const i = stockInfoFor(stockMap, id); return i.tracked ? i.qty : 0 }
  const enCarga = (id: string) => cart[id] ?? 0
  const add = (id: string) => setCart((c) => {
    const next = (c[id] ?? 0) + 1
    return next > disponible(id) ? c : { ...c, [id]: next }   // nunca más de lo que hay
  })
  const dec = (id: string) => setCart((c) => { const n = (c[id] ?? 0) - 1; if (n <= 0) { const { [id]: _x, ...r } = c; return r } return { ...c, [id]: n } })

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? sellable.filter((p) => `${p.name} ${p.category ?? ''}`.toLowerCase().includes(t)) : sellable
  }, [sellable, q])

  const lineas = Object.entries(cart)
  const totalU = lineas.reduce((s, [, n]) => s + n, 0)

  const save = () => {
    if (lineas.length === 0) return
    const fallos: string[] = []
    lineas.forEach(([id, n]) => {
      const res = assignStock(event.id, id, n)
      if (!res.ok) fallos.push(`${sellable.find((p) => p.id === id)?.name ?? 'Producto'}${res.missing != null ? ` (faltan ${res.missing})` : ''}`)
    })
    if (fallos.length > 0) { setErr(`Sin stock suficiente en almacén: ${fallos.join(', ')}.`); return }
    onDone(`Inventario asignado al evento · ${totalU} u en ${lineas.length} producto(s)`)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, width: '94vw' }}>
        <div className="mhead">
          <div><h3>Asignar inventario</h3><div className="ms">Toca los productos que llevas al evento. Se descuenta del almacén.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="searchbox" style={{ width: '100%', marginBottom: 12 }}>
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o categoría…" autoFocus />
          </div>

          <div className="posgrid" style={{ maxHeight: '46vh', overflow: 'auto' }}>
            {visibles.map((p) => {
              const disp = disponible(p.id)
              const n = enCarga(p.id)
              const agotado = disp <= 0
              return (
                <div key={p.id} className="poscard" style={agotado ? { opacity: 0.5 } : undefined} onClick={() => { if (!agotado) { add(p.id); setErr(null) } }}>
                  <span className={'ltag ' + (p.line === 'prof' ? 'prof' : 'cosm')}>{p.line === 'prof' ? 'Professional' : 'Home Care'}</span>
                  <h5>{p.name}</h5>
                  <div className="lt">{p.category}</div>
                  {agotado
                    ? <span className="pill p-dang" style={{ marginTop: 6 }}>Sin existencia</span>
                    : <div className="pr" style={{ fontSize: 13 }}>{disp} disponibles</div>}
                  {n > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" type="button" onClick={() => dec(p.id)}><Icon name="minus" /></button>
                      <span className="mono" style={{ minWidth: 20, textAlign: 'center' }}>{n}</span>
                      <button className="btn sm" type="button" disabled={n >= disp} onClick={() => add(p.id)}><Icon name="plus" /></button>
                    </div>
                  )}
                </div>
              )
            })}
            {visibles.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13, padding: 8 }}>Ningún producto coincide.</div>}
          </div>

          {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><span>{err}</span></div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {totalU > 0 ? <><b style={{ color: 'var(--ink)' }}>{totalU} u</b> en {lineas.length} producto(s)</> : 'Nada seleccionado todavía'}
            </div>
            <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
              <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
              <button className="btn" type="button" disabled={totalU === 0} style={totalU === 0 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={save}>
                <PackagePlus size={15} /> Asignar {totalU > 0 ? `${totalU} u` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditEvent({ event, onClose, onSave }: { event: SalesEvent; onClose: () => void; onSave: (patch: { name: string; venue: string; date: string; members: string[] }) => void }) {
  const { data: team } = useTeam()
  const candidates = team.filter((u) => u.active && u.capabilities.includes('eventos'))
  const [name, setName] = useState(event.name)
  const [venue, setVenue] = useState(event.venue)
  const [date, setDate] = useState(event.date === '—' ? '' : event.date)
  const [members, setMembers] = useState<string[]>(event.members)
  const toggle = (email: string) => setMembers((m) => (m.includes(email) ? m.filter((x) => x !== email) : [...m, email]))
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
  const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><div><h3>Editar evento</h3><div className="ms">Datos del evento (no toca el inventario asignado).</div></div><button className="mclose" type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Nombre</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="form-grid-2" style={{ marginTop: 0 }}>
            <div><label style={label}>Sede</label><input style={input} value={venue} onChange={(e) => setVenue(e.target.value)} /></div>
            <div><label style={label}>Fecha</label><input style={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <label style={label}>Equipo del evento</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {candidates.map((u) => (
              <button key={u.id} type="button" className={'fchip' + (members.includes(u.email) ? ' on' : '')} onClick={() => toggle(u.email)}>
                {members.includes(u.email) ? '✓ ' : '+ '}{u.name.split('·')[0].trim()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!name.trim()} style={!name.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={() => onSave({ name: name.trim(), venue: venue.trim() || 'Por definir', date: date || '—', members })}>Guardar cambios</button>
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
