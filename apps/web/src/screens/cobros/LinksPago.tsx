// LINKS DE PAGO (2 nov 2026) · lo que los clientes pidieron para pagar con tarjeta. El vendedor saca el link en la app de
// BanBajío por el monto exacto y lo pega aquí: el sistema se lo manda al cliente (WhatsApp vinculado, correo y su pedido).
// Dirección y Facturación lo marcan pagado al ver el cobro en el banco (queda en el libro como cobro con tarjeta).
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FormaDePago } from '../../app/FormaDePago'
import { cobrarVenta, faltaEnCobro, resultadoCobro, type CobroElegido } from '../../data/ops/cobro'
import { hoyNegocio } from '../../data/periodo'
import { reloadOrders } from '../../data/store/ordersStore'
import { Check, CreditCard, Send, X } from 'lucide-react'
import { linksPago as clientePorDefecto, dominioDe, esBanBajio, type ClienteLinksPago, type LinkPago } from '../../data/ops/linksPago'
import { useRoleOpcional } from '../../auth/RoleContext'
import { money } from '../../lib/format'
import { capitalizarNombre } from '../../lib/nombres'
import { Vacio } from '../../app/EmptyState'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useOrderMoney } from '../../data/hooks/useMoney'
import { pedidosPorConfirmar } from '../../data/ops/porConfirmar'   // POR CONFIRMAR (dueño, 26 nov)
import { fmtDate } from '../../lib/format'

const ETIQUETA: Record<LinkPago['estado'], string> = { solicitado: 'Por enviar', enviado: 'Enviado · esperando pago', pagado: 'Pagado', cancelado: 'Cancelado' }
const VIA: Record<LinkPago['via'], string> = { portal: 'lo pidió en el portal', whatsapp: 'lo pidió por WhatsApp', personal: 'lo pidió su vendedor' }

export function LinksPago({ cliente = clientePorDefecto }: { cliente?: ClienteLinksPago }) {
  const rol = useRoleOpcional()
  // COBRO-U (23 nov 2026, dueño): Ventas también cobra (sus ventas y su cartera; el servidor lo acota).
  const cobra = rol?.role === 'admin' || rol?.role === 'pos'
  const [lista, setLista] = useState<LinkPago[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cliente.lista(); if (r.ok) { setLista(r.data ?? []); setError(null) } else setError(r.error) }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  const activos = (lista ?? []).filter((l) => l.estado === 'solicitado' || l.estado === 'enviado')
  const cerrados = (lista ?? []).filter((l) => l.estado === 'pagado' || l.estado === 'cancelado')
  // AUDITORÍA VENTAS (19 nov 2026) · la vendedora pide el link por su cliente (antes solo lo podía pedir el doctor desde su
  // portal, y casi ningún cliente tiene portal). Pedidos vivos sin pagar que aún no tienen un link activo.
  const { data: pedidos } = useAllOrders()
  const conLink = new Set(activos.map((l) => l.order_id))
  const porCobrar = pedidos.filter((o) => o.status !== 'cancelled' && o.status !== 'draft' && o.payment_status !== 'paid' && o.payment_status !== 'refunded'
    && !conLink.has(o.id) && (o.total ?? 0) > 0)   // COBRO-U · también las ventas de Caja a crédito
  // POR CONFIRMAR (dueño, 26 nov 2026): primero lo que espera el pago para pasar a Almacén; luego lo que ya salió sin pagar.
  const { byOrder: dinero } = useOrderMoney()
  const idsPorConfirmar = new Set(pedidosPorConfirmar(porCobrar, dinero).map((o) => o.id))
  const porConfirmar = porCobrar.filter((o) => idsPorConfirmar.has(o.id))
  const yaSalieron = porCobrar.filter((o) => !idsPorConfirmar.has(o.id))
  const clienteDe = (o: { shipping_meta?: unknown }) => capitalizarNombre(((o.shipping_meta as { customer?: { name?: string } } | null)?.customer?.name) ?? '') || 'Cliente'
  const [pidiendo, setPidiendo] = useState<string | null>(null)
  const [cobrando, setCobrando] = useState<{ id: string; external_ref: string | null; total: number | null; shipping_meta?: unknown } | null>(null)
  const pedir = async (id: string, folio: string) => {
    setPidiendo(id); setError(null)
    const r = await cliente.solicitar(id)
    setPidiendo(null)
    if (r.ok) setAviso(`Link solicitado para ${folio}. Sácalo en la app de BanBajío por el monto exacto y pégalo abajo.`); else setError(r.error ?? 'No se pudo pedir el link.')
    void cargar()
  }
  const hecho = async (p: Promise<{ ok: boolean; error?: string }>, ok: string) => { const r = await p; if (r.ok) setAviso(ok); else setError(r.error ?? 'No se pudo.'); void cargar() }

  return (
    <div className="card sgs" data-testid="links-pago">
      {cobrando && <CobrarPedido pedido={cobrando} onClose={() => setCobrando(null)} onHecho={(t) => { setCobrando(null); setAviso(t); void cargar() }} />}
      <div className="sgs-h"><h2>Cobrar y confirmar pedidos</h2><span>{activos.length ? `${activos.length} por atender` : ''}</span></div>
      <p className="sgs-sub">Pedidos sin pagar: cóbralos con cualquier forma de pago (efectivo, tarjeta, transferencia, link, al recibir o crédito). Con link: saca el link en la app de BanBajío por el <b>monto exacto</b> y pégalo aquí. Se lo mandamos por su WhatsApp, por correo y queda en su pedido.{cobra ? ' Al ver el cobro en el banco, márcalo pagado.' : ' Dirección lo marca pagado al ver el cobro en el banco.'}</p>
      {error && <div className="pce-error" role="alert">{error}</div>}
      {aviso && <div className="sysnote" role="status" style={{ background: 'var(--ok-bg)', color: 'var(--green-deep)' }}>{aviso}</div>}
      {porConfirmar.length > 0 && (
        <section className="sgs-grupo" data-testid="por-confirmar"><h3>Por confirmar · falta el pago <small>({porConfirmar.length})</small></h3>
          <p className="sgs-sub" style={{ marginTop: 0 }}>No pasan a Almacén hasta que se confirme el pago. Cuando el cliente pague, toca <b>Confirmar pago</b>.</p>
          <ul>{porConfirmar.slice(0, 50).map((o) => (
            <li key={o.id} className="sgs-item" data-testid="pedido-por-confirmar">
              <div className="sgs-tx"><b>{o.external_ref ?? 'Pedido'} · {clienteDe(o)}</b><span>{money(o.total ?? 0)} · {fmtDate(o.created_at)}{o.payment_status === 'parcial' ? ' · pago parcial' : ''}</span></div>
              {cobra && <button type="button" className="btn sm" onClick={() => setCobrando(o)} data-testid="pedido-cobrar"><Check size={14} aria-hidden /> Confirmar pago</button>}
              <button type="button" className="btn ghost sm" disabled={pidiendo === o.id} onClick={() => void pedir(o.id, o.external_ref ?? 'el pedido')} data-testid="link-pedir"><CreditCard size={14} aria-hidden /> {pidiendo === o.id ? 'Pidiendo…' : 'Pedir link'}</button>
            </li>))}</ul>
        </section>
      )}
      {yaSalieron.length > 0 && (
        <section className="sgs-grupo" data-testid="links-pedir"><h3>Ya en Almacén o entregados · falta cobrar <small>({yaSalieron.length})</small></h3>
          <ul>{yaSalieron.slice(0, 30).map((o) => (
            <li key={o.id} className="sgs-item">
              <div className="sgs-tx"><b>{o.external_ref ?? 'Pedido'} · {clienteDe(o)}</b><span>{money(o.total ?? 0)}{o.payment_status === 'parcial' ? ' · pago parcial' : ''}</span></div>
              {cobra && <button type="button" className="btn sm" onClick={() => setCobrando(o)} data-testid="pedido-cobrar">Confirmar pago</button>}
              <button type="button" className="btn ghost sm" disabled={pidiendo === o.id} onClick={() => void pedir(o.id, o.external_ref ?? 'el pedido')} data-testid="link-pedir"><CreditCard size={14} aria-hidden /> {pidiendo === o.id ? 'Pidiendo…' : 'Pedir link'}</button>
            </li>))}</ul>
        </section>
      )}
      {lista && activos.length === 0 && <Vacio plano icono="receipt" titulo="No hay links pendientes." pista="Cuando un cliente pida pagar con tarjeta, te llega un aviso y aparece aquí." />}
      {activos.length > 0 && <ul>{activos.map((l) => <Fila key={l.id} l={l} cobra={cobra} cliente={cliente} hecho={hecho} />)}</ul>}
      {cerrados.length > 0 && (
        <section className="sgs-grupo"><h3>Últimos 30 días <small>({cerrados.length})</small></h3>
          <ul>{cerrados.map((l) => (
            <li key={l.id} className="sgs-item" data-testid="link-cerrado">
              <div className="sgs-tx"><b>{capitalizarNombre(l.cliente ?? 'Cliente')} · {l.folio}</b><span>{money(l.monto)} · {ETIQUETA[l.estado]}{l.referencia ? ` · ${l.referencia}` : ''}</span></div>
            </li>))}</ul>
        </section>
      )}
    </div>
  )
}

function Fila({ l, cobra, cliente, hecho }: { l: LinkPago; cobra: boolean; cliente: ClienteLinksPago; hecho: (p: Promise<{ ok: boolean; error?: string }>, ok: string) => Promise<void> }) {
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const dom = dominioDe(url)
  return (
    <li className="sgs-item" data-testid="link-pago" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="sgs-tx">
        <b><CreditCard size={14} /> {capitalizarNombre(l.cliente ?? 'Cliente')} · pedido {l.folio} · {money(l.monto)}</b>
        <span><span className={`pill ${l.estado === 'solicitado' ? 'p-warn' : 'p-neu'}`}>{ETIQUETA[l.estado]}</span> {VIA[l.via]}{!l.es_mio && l.vendedor ? ` · cartera de ${l.vendedor}` : ''}</span>
        {l.estado === 'enviado' && l.url_guardada && <small>Enviado: {dominioDe(l.url_guardada)}{l.banbajio === false ? ' · ⚠️ no parece de BanBajío' : ''}</small>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: '1 1 260px' }} placeholder={l.estado === 'enviado' ? 'Pegar otro link (lo reemplaza)' : 'Pega aquí el link de BanBajío (https://…)'} value={url} onChange={(e) => setUrl(e.target.value)} data-testid="link-url" />
        <button type="button" className="btn sm" disabled={!dom} onClick={() => void hecho(cliente.enviar(l.id, url.trim()), 'Listo: le mandamos el link al cliente.')} data-testid="link-enviar"><Send size={14} /> Enviar al cliente</button>
        <button type="button" className="btn ghost sm" onClick={() => void hecho(cliente.cancelar(l.id, null), 'Solicitud cancelada.')} data-testid="link-cancelar"><X size={14} /> Cancelar</button>
      </div>
      {url && (dom ? <small data-testid="link-dominio">Se enviará un link de <b>{dom}</b>{esBanBajio(dom) ? ' (BanBajío)' : ' · ⚠️ no parece de BanBajío: revisa que sea el correcto'}</small>
                   : <small style={{ color: 'var(--danger)' }}>El link debe empezar con https://</small>)}
      {cobra && l.estado === 'enviado' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 200px' }} placeholder="Autorización o referencia del banco (opcional)" value={ref} onChange={(e) => setRef(e.target.value)} />
          <button type="button" className="btn sm" onClick={() => void hecho(cliente.pagado(l.id, ref.trim() || null), 'Pago registrado.')} data-testid="link-pagado"><Check size={14} /> Ya pagó (lo vi en BanBajío)</button>
        </div>
      )}
    </li>
  )
}

// COBRO-U · cobrar un pedido que ya existe con la MISMA «Forma de pago» de todos los puntos de venta.
// UNA SOLA PALABRA (27 nov 2026): el botón de la lista decía «Confirmar venta», la ventana «Cobrar» y su botón
// «Registrar». Ahora las tres dicen «Confirmar pago». Exportada: el Inicio de Ventas la abre sin pasar por el menú.
export function CobrarPedido({ pedido, onClose, onHecho }: { pedido: { id: string; external_ref: string | null; total: number | null; shipping_meta?: unknown }; onClose: () => void; onHecho: (texto: string) => void }) {
  const [cobro, setCobro] = useState<CobroElegido | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const opId = useRef(globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12))
  const total = Number(pedido.total ?? 0)
  const tipoEntrega = (pedido.shipping_meta as { entrega?: { tipo?: string } } | null)?.entrega?.tipo ?? null
  const falta = faltaEnCobro(cobro, total, 'pedido', tipoEntrega, hoyNegocio())
  const folio = pedido.external_ref ?? 'el pedido'
  const cobrar = async () => {
    if (!cobro || falta || enviando) return
    setEnviando(true); setError(null)
    const r = await cobrarVenta(pedido.id, cobro, opId.current)
    setEnviando(false)
    if (!r.ok) { setError(r.error); return }
    reloadOrders()
    onHecho(`${folio}: ${resultadoCobro(cobro, cobro.vence).texto}`)
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="cobrar-pedido">
        <div className="mhead"><h3>Confirmar pago de {folio} · {money(total)}</h3></div>
        <div className="mbody">
          <FormaDePago total={total} modo="pedido" tipoEntrega={tipoEntrega} value={cobro}
            onChange={(c) => { setCobro(c); if (c?.forma !== cobro?.forma) opId.current = globalThis.crypto?.randomUUID?.() ?? opId.current }} testId="cobrar-forma" />
          {error && <div className="pce-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
        </div>
        <div className="mfoot" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 14 }}>
          {/* Un botón apagado dice qué falta. */}
          {!cobro && <span style={{ marginRight: 'auto', alignSelf: 'center', fontSize: 12.5, color: 'var(--ink-3)' }} data-testid="cobrar-falta">Elige cómo pagó el cliente.</span>}
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" disabled={!cobro || !!falta || enviando} onClick={() => void cobrar()} data-testid="cobrar-confirmar">{enviando ? 'Registrando…' : 'Confirmar pago'}</button>
        </div>
      </div>
    </div>
  )
}
