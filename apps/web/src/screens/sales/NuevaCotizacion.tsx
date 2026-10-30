// COTIZACIONES · el vendedor arma la cotización de su cliente (mismo buscador y mismos precios previstos que "Levantar
// pedido") y la manda por la conversación o por correo. El servidor pone y congela los precios; vigente 7 días.
import React, { useMemo, useState } from 'react'
import { X, Plus, Minus, Search, Send, Mail } from 'lucide-react'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useReglasPrecio } from '../../data/hooks/useReglasPrecio'
import { cantidadesVolumen, effectiveUnitPrice, etiquetaNivel, volumePromoLabel } from '../../data/ops/volumePricing'
import { cotizaciones as clientePorDefecto, textoCotizacion, type ClienteCotizaciones, type Cotizacion } from '../../data/ops/cotizaciones'
import type { ClienteChat } from '../../data/ops/chat'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'

export function NuevaCotizacion({ customer, conversationId, chat, onClose, onCreada, cliente = clientePorDefecto }: {
  customer: { id: string; name: string; email?: string | null }
  conversationId?: string | null
  chat?: ClienteChat                 // para mandarla por la misma conversación (WhatsApp)
  onClose: () => void
  onCreada?: (c: Cotizacion) => void
  cliente?: ClienteCotizaciones
}) {
  const { data: products } = useProducts()
  const volRules = useReglasPrecio()
  const vendibles = useMemo(() => products.filter((p) => p.price != null && isActiveProduct(p) && p.sellable !== false), [products])
  const [buscar, setBuscar] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  // MAYOREO-REGLAS · piezas que cuentan para el volumen con TODO el pedido (juntar 10 / uno en mayoreo → todo a mayoreo).
  const vq = useMemo(() => cantidadesVolumen(Object.entries(cart).map(([product_id, qty]) => ({ product_id, qty })), volRules), [cart, volRules])
  const [notas, setNotas] = useState('')
  const [hecha, setHecha] = useState<Cotizacion | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const visibles = useMemo(() => {
    const s = buscar.trim().toLowerCase()
    return (s ? vendibles.filter((p) => cart[p.id] || `${p.name} ${p.category ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(s)) : vendibles).slice(0, 80)
  }, [vendibles, buscar, cart])
  const lineas = Object.entries(cart).filter(([, q]) => q > 0)
  const eff = (id: string, q: number) => { const p = vendibles.find((x) => x.id === id); return p ? effectiveUnitPrice(p.price, volRules, p.id, q, vq[p.id]) ?? p.price ?? 0 : 0 }
  const total = lineas.reduce((s, [id, q]) => s + eff(id, q) * q, 0)
  const cambiar = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(999, (c[id] ?? 0) + d)) }))

  const crear = async () => {
    setOcupado(true); setMsg(null)
    const r = await cliente.crear(customer.id, lineas.map(([product_id, qty]) => ({ product_id, qty })), notas, conversationId)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setHecha(r.data); onCreada?.(r.data)
  }
  const porChat = async () => {
    if (!hecha || !chat || !conversationId) return
    setOcupado(true); setMsg(null)
    const e = await chat.enviar(conversationId, textoCotizacion(hecha, primerNombre(capitalizarNombre(customer.name)) || undefined))
    if (e.ok) await cliente.enviar(hecha.id, 'chat')
    setOcupado(false)
    setMsg(e.ok ? { ok: true, texto: 'Se la mandaste por este chat.' } : { ok: false, texto: `No se pudo mandar por el chat: ${e.error.mensaje}` })
  }
  const porCorreo = async () => {
    if (!hecha) return
    setOcupado(true); setMsg(null)
    const r = await cliente.enviar(hecha.id, 'correo')
    setOcupado(false)
    setMsg(r.ok ? { ok: true, texto: `Se la mandamos por correo${r.data.para ? ` a ${r.data.para}` : ''}.` } : { ok: false, texto: r.mensaje })
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal cot-modal" onClick={(e) => e.stopPropagation()} data-testid="nueva-cotizacion">
        <div className="mhead">
          <div><h3>{hecha ? `Cotización ${hecha.folio}` : 'Nueva cotización'}</h3><div className="ms">Para {capitalizarNombre(customer.name)} · vigente 7 días</div></div>
          <button className="mclose" type="button" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="mbody">
          {!hecha ? (
            <>
              <span className="searchbox" style={{ width: '100%' }}><Search size={15} aria-hidden /><input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto, categoría o SKU" aria-label="Buscar producto" data-testid="cot-buscar" /></span>
              <ul className="cot-lista">
                {visibles.map((p) => {
                  const q = cart[p.id] ?? 0
                  const promo = etiquetaNivel(p.price, volRules, p.id, q, vq[p.id]) ?? volumePromoLabel(p.price, volRules, p.id)
                  return (
                    <li key={p.id} className={'cot-prod' + (q ? ' on' : '')}>
                      <span className="cot-prod-tx"><b>{p.name}</b><small>{money(q ? eff(p.id, q) : p.price ?? 0)}{promo ? ` · ${promo}` : ''}</small></span>
                      <span className="cot-qty">
                        {q > 0 && <button type="button" className="rc-mini" onClick={() => cambiar(p.id, -1)} aria-label={`Quitar ${p.name}`}><Minus size={14} /></button>}
                        {q > 0 && <span className="mono">{q}</span>}
                        <button type="button" className="rc-mini" onClick={() => cambiar(p.id, 1)} aria-label={`Agregar ${p.name}`}><Plus size={14} /></button>
                      </span>
                    </li>
                  )
                })}
              </ul>
              <textarea className="pc-campo" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Nota para el cliente (opcional): entrega, condiciones…" aria-label="Nota" maxLength={500} />
              <div className="cot-pie">
                <span>{lineas.length} {lineas.length === 1 ? 'producto' : 'productos'} · <b className="mono">{money(total)}</b> <small>(el servidor confirma los precios)</small></span>
                <button type="button" className="btn" disabled={ocupado || lineas.length === 0} onClick={() => void crear()} data-testid="cot-crear">Crear cotización</button>
              </div>
            </>
          ) : (
            <>
              <ul className="cot-resumen">
                {hecha.lineas.map((l) => <li key={l.product_id}><span>{l.qty} × {l.nombre}</span><b className="mono">{money(l.subtotal)}</b></li>)}
                <li className="tot"><span>Total</span><b className="mono">{money(hecha.total)}</b></li>
              </ul>
              <div className="cot-envio">
                {chat && conversationId && <button type="button" className="btn" disabled={ocupado} onClick={() => void porChat()} data-testid="cot-chat"><Send size={15} /> Mandar por este chat</button>}
                <button type="button" className="btn ghost" disabled={ocupado} onClick={() => void porCorreo()} data-testid="cot-correo"><Mail size={15} /> Mandar por correo</button>
              </div>
            </>
          )}
          {msg && <div className={'pc-msg' + (msg.ok ? ' ok' : '')} role={msg.ok ? 'status' : 'alert'} data-testid="cot-msg">{msg.texto}</div>}
        </div>
      </div>
    </div>
  )
}
