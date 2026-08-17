// Caja (Punto de Venta): venta en persona. Selecciona productos, arma la venta,
// cobra (efectivo/tarjeta) y completa. Al cobrar: crea orden POS pagada/entregada
// y descuenta inventario por lote (FEFO de Almacén, reutilizada).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { enviarReciboWhatsApp, imprimirVenta, VentaTicketPrint } from './ventaRecibo'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useLots } from '../../data/hooks/useLots'
import { useDoctors } from '../../data/hooks/useDoctors'
import { useEvents } from '../../data/hooks/useEvents'
import { useRole } from '../../auth/RoleContext'
import { stockByProduct, stockInfoFor, LOW_STOCK, type StockInfo } from '../../data/ops/stock'
import { venderPOS, type PosResult } from '../../data/ops/pos'
import { clientOf } from '../../data/mock/profiles'
import type { OrderWithItems } from '../../data/hooks/useOrders'
import type { ProductSafe, Profile } from '../../data/types'

type PayMethod = 'efectivo' | 'tarjeta'
interface Line { product: ProductSafe; qty: number }
interface Client { id: string; name: string }

export function Caja() {
  const { data: products } = useProducts()
  const { data: lots } = useLots()
  const { data: doctors } = useDoctors()
  const { data: events, sellAtEvent } = useEvents()
  const { user } = useRole()
  const eventosActivos = useMemo(() => events.filter((e) => e.status === 'activo'), [events])
  // Contexto de venta: mostrador (null) o un evento activo. Se asigna a la venta para
  // que el arqueo por evento y "Ventas del evento" cuadren (antes nunca se asignaba).
  const [eventId, setEventId] = useState<string | null>(null)
  // Solo productos activos y con precio (no se vende lo oculto).
  const sellable = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p)), [products])
  // En un evento se vende del STAND (lo asignado − lo vendido), NO del almacén. Antes
  // Caja mostraba/limitaba por almacén y cobraba con venderPOS, que descontaba el almacén
  // OTRA VEZ (el stock ya se había movido al stand al asignarlo) — doble descuento y el
  // stand nunca bajaba. Con evento seleccionado, el stock disponible es el del stand.
  const stockMap = useMemo(() => {
    if (eventId) {
      const ev = events.find((e) => e.id === eventId)
      const m: Record<string, StockInfo> = {}
      ev?.items.forEach((it) => {
        const q = it.assigned - it.sold
        m[it.product_id] = { qty: q, tracked: true, status: q <= 0 ? 'out' : q <= LOW_STOCK ? 'low' : 'ok' }
      })
      return m
    }
    return stockByProduct(lots)
  }, [eventId, events, lots])
  const productName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])) as Record<string, string>, [products])
  const [buscar, setBuscar] = useState('')
  // Buscador: por nombre, categoría o SKU (útil en un evento con fila; también sirve para
  // teclear/escanear el código y encontrarlo sin scrollear 64 productos).
  const filtered = useMemo(() => {
    const s = buscar.trim().toLowerCase()
    if (!s) return sellable
    return sellable.filter((p) => `${p.name} ${p.category ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(s))
  }, [sellable, buscar])

  const [cart, setCart] = useState<Record<string, number>>({})
  const [method, setMethod] = useState<PayMethod>('efectivo')
  const [client, setClient] = useState<Client | null>(null) // opcional: null = mostrador
  const [pickOpen, setPickOpen] = useState(false)
  const [done, setDone] = useState<OrderWithItems | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cobrando, setCobrando] = useState(false)
  const [recibido, setRecibido] = useState('') // efectivo con el que paga el cliente
  const [lastPago, setLastPago] = useState<{ recibido: number; cambio: number } | null>(null) // para el recibo
  // CFDI: el cliente puede pedir factura en la venta. Si hay doctor ligado, se factura con
  // sus datos fiscales (perfil); si es mostrador, se capturan aquí (RFC, razón, uso, correo).
  const [invoiceReq, setInvoiceReq] = useState(false)
  const [fiscal, setFiscal] = useState({ rfc: '', razon: '', uso: 'G03', email: '' })
  // Ventas del turno (en memoria) para poder REIMPRIMIR el recibo si el cliente vuelve.
  type VentaTurno = { order: OrderWithItems; clientName: string; pago: { recibido: number; cambio: number } | null }
  const [ventasTurno, setVentasTurno] = useState<VentaTurno[]>([])
  const [reprint, setReprint] = useState<VentaTurno | null>(null)
  const clientNameFor = (o: OrderWithItems) => (o.doctor_id ? (doctors.find((d) => d.id === o.doctor_id)?.full_name ?? 'Cliente') : 'Mostrador · público general')

  const lines: Line[] = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ product: sellable.find((p) => p.id === id), qty }))
        .filter((l): l is Line => Boolean(l.product)),
    [cart, sellable],
  )
  const total = lines.reduce((s, l) => s + (l.product.price ?? 0) * l.qty, 0)
  const recibidoN = Math.max(0, Number(recibido) || 0)
  const cambio = recibidoN - total
  // En efectivo, no se cobra hasta que el recibido alcance el total (evita cambio negativo).
  const efectivoOk = method !== 'efectivo' || recibido === '' ? true : recibidoN >= total

  // No vender más de lo disponible en inventario.
  const add = (id: string) => setCart((c) => {
    const info = stockInfoFor(stockMap, id)
    const max = info.tracked ? info.qty : 0
    const next = (c[id] ?? 0) + 1
    return next > max ? c : { ...c, [id]: next }
  })
  const dec = (id: string) =>
    setCart((c) => {
      const q = (c[id] ?? 0) - 1
      if (q <= 0) { const { [id]: _d, ...rest } = c; return rest }
      return { ...c, [id]: q }
    })

  const cobrar = async () => {
    if (cobrando) return
    setCobrando(true)
    const posLines = lines.map((l) => ({ product_id: l.product.id, qty: l.qty, unit_price: l.product.price ?? 0 }))
    // Venta en evento → sellAtEvent (descuenta el STAND, registra el lote entregado y
    // cuadra "Ventas del evento"). Mostrador → venderPOS (descuenta el almacén por FEFO).
    let res: PosResult
    if (eventId) {
      const order = sellAtEvent(eventId, posLines, total, method, user?.email ?? null)
      res = order
        ? { ok: true, order }
        : { ok: false, error: 'No hay suficiente stock en el stand del evento para esta venta. Revisa Eventos.' }
    } else {
      // CFDI: mostrador → datos fiscales capturados; con doctor ligado → se factura con su
      // perfil (Facturación), aquí solo se marca la solicitud.
      const invoiceMeta = invoiceReq && !client
        ? { rfc: fiscal.rfc.trim(), razon_social: fiscal.razon.trim(), uso_cfdi: fiscal.uso, email: fiscal.email.trim() }
        : null
      res = await venderPOS(posLines, total, method, { doctorId: client?.id ?? null, seller: user?.email ?? null, invoiceRequested: invoiceReq, invoiceMeta })
    }
    setCobrando(false)
    if (res.ok && res.order) {
      const order = res.order
      const pago = method === 'efectivo' && recibido !== '' ? { recibido: recibidoN, cambio } : null
      setLastPago(pago)
      setVentasTurno((v) => [{ order, clientName: clientNameFor(order), pago }, ...v].slice(0, 50))
      setReprint(null)
      setDone(order)
      setCart({})
      setClient(null)
      setRecibido('')
      setInvoiceReq(false)
      setFiscal({ rfc: '', razon: '', uso: 'G03', email: '' })
    } else {
      // La RPC atómica falla ANTES de cobrar si el inventario no alcanza: no hay venta fantasma.
      setErr(res.error ?? 'No se pudo completar la venta. Verifica existencias en Almacén.')
      window.setTimeout(() => setErr(null), 4000)
    }
  }

  // Reimprime el recibo de una venta del turno: monta su ticket y abre el diálogo.
  const reimprimir = (v: VentaTurno) => {
    setReprint(v)
    requestAnimationFrame(() => requestAnimationFrame(() => imprimirVenta()))
  }

  return (
    <div className="grid pos-wrap">
      {/* Catálogo POS (solo productos con precio) */}
      <div className="grid" style={{ gap: 16 }}>
        <div className="eyebrow">Punto de Venta · Caja</div>
        <input
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar producto por nombre, categoría o SKU…"
          style={{ width: '100%', padding: '11px 14px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', background: '#fff' }}
        />
        {filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>Ningún producto coincide con “{buscar}”.</div>
        ) : (
        <div className="posgrid">
          {filtered.map((p) => {
            const qty = cart[p.id] ?? 0
            const stock = stockInfoFor(stockMap, p.id)
            const out = !stock.tracked || stock.qty <= 0
            return (
              <div key={p.id} className="poscard" style={out ? { opacity: 0.55 } : undefined} onClick={() => { if (!out) add(p.id) }}>
                {p.image_url && (
                  <img src={p.image_url} alt="" loading="lazy" className="posthumb" />
                )}
                <h5>{p.name}</h5>
                <div className="lt">{p.category}</div>
                <div className="pr">{money(p.price)}</div>
                {out ? <span className="pill p-dang" style={{ marginTop: 6 }}>Agotado</span>
                  : stock.status === 'low' ? <span className="pill p-warn" style={{ marginTop: 6 }}>Quedan {stock.qty}</span> : null}
                {qty > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost sm" type="button" onClick={() => dec(p.id)}><Icon name="minus" /></button>
                    <span className="mono">{qty}</span>
                    <button className="btn sm" type="button" onClick={() => add(p.id)}><Icon name="plus" /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        )}
      </div>

      {/* Ticket */}
      <div className="card ticket" style={{ position: 'sticky', top: 90 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
          <Icon name="store" style={{ width: 18, height: 18, color: 'var(--green-deep)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>Venta</h3>
          {lines.length > 0 && <button className="btn ghost sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setCart({})}>Vaciar</button>}
        </div>

        {eventosActivos.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12.5, color: 'var(--ink-3)' }}>
            <Icon name="store" style={{ width: 15, height: 15, color: eventId ? 'var(--green-deep)' : 'var(--ink-3)' }} />
            <span style={{ whiteSpace: 'nowrap' }}>Vendiendo en</span>
            <select value={eventId ?? ''} onChange={(e) => { setEventId(e.target.value || null); setCart({}) }}
              style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, background: '#fff', outline: 'none', fontWeight: eventId ? 600 : 400 }}>
              <option value="">Mostrador (sin evento)</option>
              {eventosActivos.map((e) => <option key={e.id} value={e.id}>Evento · {e.name}</option>)}
            </select>
          </label>
        )}

        {/* Cliente OPCIONAL: por defecto mostrador; no obliga a entrar por un cliente */}
        <button type="button" onClick={() => setPickOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10 }}>
          <Icon name="usercheck" style={{ width: 15, height: 15, color: client ? 'var(--green-deep)' : 'var(--ink-3)' }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700 }}>Cliente</span>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client ? client.name : 'Mostrador · público general'}</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--brand, #007311)', fontWeight: 600, flex: 'none' }}>{client ? 'Cambiar' : 'Elegir'}</span>
        </button>

        {lines.length === 0 ? (
          <div className="empty">Toca un producto para agregarlo a la venta.</div>
        ) : (
          <>
            {lines.map((l) => (
              <div key={l.product.id} className="titem">
                <div>
                  <div>{l.product.name}</div>
                  <div className="tl">{money(l.product.price)} × {l.qty}</div>
                </div>
                <span className="mono">{money((l.product.price ?? 0) * l.qty)}</span>
              </div>
            ))}

            <div className="tket-total" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}>
              <span>Total</span><b>{money(total)}</b>
            </div>

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

            {!eventId && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={invoiceReq} onChange={(e) => setInvoiceReq(e.target.checked)} />
                  <span>Solicitar factura (CFDI)</span>
                </label>
                {invoiceReq && (
                  client ? (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>Se facturará con los datos fiscales de {client.name} (perfil). La emite Facturación.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                      <input value={fiscal.rfc} onChange={(e) => setFiscal((f) => ({ ...f, rfc: e.target.value.toUpperCase() }))} placeholder="RFC"
                        style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#fff' }} />
                      <input value={fiscal.razon} onChange={(e) => setFiscal((f) => ({ ...f, razon: e.target.value }))} placeholder="Razón social"
                        style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#fff' }} />
                      <input value={fiscal.email} onChange={(e) => setFiscal((f) => ({ ...f, email: e.target.value }))} placeholder="Correo para la factura"
                        style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#fff' }} />
                      <select value={fiscal.uso} onChange={(e) => setFiscal((f) => ({ ...f, uso: e.target.value }))}
                        style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: '#fff' }}>
                        <option value="G03">G03 · Gastos en general</option>
                        <option value="G01">G01 · Adquisición de mercancías</option>
                        <option value="P01">P01 · Por definir</option>
                      </select>
                      {(fiscal.rfc.trim() === '' || fiscal.razon.trim() === '') && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>RFC y razón social son obligatorios para facturar.</div>}
                    </div>
                  )
                )}
              </div>
            )}

            {(() => {
              const cfdiOk = !invoiceReq || client != null || (fiscal.rfc.trim() !== '' && fiscal.razon.trim() !== '')
              const puede = !cobrando && efectivoOk && cfdiOk
              return (<>
            <button className="btn" type="button" style={{ width: '100%', marginTop: 14, ...(puede ? {} : { opacity: 0.6, cursor: cobrando ? 'wait' : 'not-allowed' }) }} onClick={cobrar} disabled={!puede}>
              <Icon name="check" /> {cobrando ? 'Cobrando…' : `Cobrar ${money(total)}`}
            </button>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>Pago inmediato · descuenta del inventario de Almacén por lote (FEFO). Para vender lo que traes en consignación, usa Clientes → Venta directa.</div>
              </>)
            })()}
          </>
        )}

        {err && <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)', marginTop: 12 }}><Icon name="x" /><span>{err}</span></div>}

        {ventasTurno.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--ink-3)' }}>Ventas del turno ({ventasTurno.length}) · reimprimir recibo</summary>
            <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
              {ventasTurno.slice(0, 15).map((v) => (
                <div key={v.order.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="mono" style={{ minWidth: 76 }}>{v.order.external_ref}</span>
                  <span className="mono" style={{ flex: 1, textAlign: 'right' }}>{money(v.order.total)}</span>
                  <button className="btn ghost sm" type="button" title="Reimprimir recibo" onClick={() => reimprimir(v)}><Icon name="download" /></button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {!done && reprint && (
        <VentaTicketPrint order={reprint.order} productName={productName} pago={reprint.pago} clientName={reprint.clientName} />
      )}

      {pickOpen && (
        <ClientPicker
          doctors={doctors}
          onPick={(c) => { setClient(c); setPickOpen(false) }}
          onClose={() => setPickOpen(false)}
        />
      )}

      {done && (
        <div className="overlay" onClick={() => setDone(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="mbody">
              <div className="success">
                <div className="ck"><Icon name="check" /></div>
                <h3>Venta registrada</h3>
                <p>
                  <b>{done.external_ref}</b> · {money(done.total)} · {done.payment_method === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}
                  {' · '}{done.doctor_id ? (doctors.find((d) => d.id === done.doctor_id)?.full_name ?? 'Cliente') : 'Mostrador'}.
                  Inventario descontado por lote. Ya suma en el Tablero.
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn ghost" type="button" onClick={imprimirVenta}><Icon name="download" /> Imprimir recibo</button>
                  <button className="btn ghost" type="button" onClick={() => enviarReciboWhatsApp(done, productName, lastPago, done.doctor_id ? clientOf(done.doctor_id).phone : undefined)}>
                    <Icon name="chat" /> Enviar por WhatsApp
                  </button>
                  <button className="btn" type="button" onClick={() => setDone(null)}>Nueva venta</button>
                </div>
              </div>
            </div>
          </div>
          <VentaTicketPrint order={done} productName={productName} pago={lastPago} clientName={done.doctor_id ? (doctors.find((d) => d.id === done.doctor_id)?.full_name ?? 'Cliente') : 'Mostrador · público general'} />
        </div>
      )}
    </div>
  )
}

// Selector de cliente para la Caja: buscar un doctor verificado, o dejar Mostrador.
function ClientPicker({ doctors, onPick, onClose }: {
  doctors: Profile[]
  onPick: (c: Client | null) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const list = doctors
    .filter((d) => d.verified)
    .filter((d) => (d.full_name ?? '').toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Cliente de la venta</h3><div className="ms">Opcional. Si es venta de mostrador, deja “Mostrador”.</div></div>
          <button className="mclose" type="button" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar doctor por nombre…"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', marginBottom: 10 }} />
          <button type="button" onClick={() => onPick(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 12px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 6, fontWeight: 600 }}>
            <Icon name="store" style={{ width: 15, height: 15, color: 'var(--ink-3)' }} /> Mostrador · público general
          </button>
          <div style={{ display: 'grid', gap: 4, maxHeight: '44vh', overflow: 'auto' }}>
            {list.map((d) => (
              <button key={d.id} type="button" onClick={() => onPick({ id: d.id, name: d.full_name ?? 'Doctor' })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, background: 'var(--surface, #fff)', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="usercheck" style={{ width: 15, height: 15, color: 'var(--green-deep)' }} /> {d.full_name ?? 'Doctor'}
              </button>
            ))}
            {list.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 2px' }}>Sin doctores verificados que coincidan.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
