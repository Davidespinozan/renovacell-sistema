// LINKS DE PAGO (2 nov 2026) · lo que los clientes pidieron para pagar con tarjeta. El vendedor saca el link en la app de
// BanBajío por el monto exacto y lo pega aquí: el sistema se lo manda al cliente (WhatsApp vinculado, correo y su pedido).
// Dirección y Facturación lo marcan pagado al ver el cobro en el banco (queda en el libro como cobro con tarjeta).
import React, { useCallback, useEffect, useState } from 'react'
import { Check, CreditCard, Send, X } from 'lucide-react'
import { linksPago as clientePorDefecto, dominioDe, esBanBajio, type ClienteLinksPago, type LinkPago } from '../../data/ops/linksPago'
import { useRoleOpcional } from '../../auth/RoleContext'
import { money } from '../../lib/format'
import { capitalizarNombre } from '../../lib/nombres'
import { Vacio } from '../../app/EmptyState'

const ETIQUETA: Record<LinkPago['estado'], string> = { solicitado: 'Por enviar', enviado: 'Enviado · esperando pago', pagado: 'Pagado', cancelado: 'Cancelado' }
const VIA: Record<LinkPago['via'], string> = { portal: 'lo pidió en el portal', whatsapp: 'lo pidió por WhatsApp', personal: 'lo pidió su vendedor' }

export function LinksPago({ cliente = clientePorDefecto }: { cliente?: ClienteLinksPago }) {
  const rol = useRoleOpcional()
  const cobra = rol?.role === 'admin'   // el servidor también acepta Facturación (billing)
  const [lista, setLista] = useState<LinkPago[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cliente.lista(); if (r.ok) { setLista(r.data ?? []); setError(null) } else setError(r.error) }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  const activos = (lista ?? []).filter((l) => l.estado === 'solicitado' || l.estado === 'enviado')
  const cerrados = (lista ?? []).filter((l) => l.estado === 'pagado' || l.estado === 'cancelado')
  const hecho = async (p: Promise<{ ok: boolean; error?: string }>, ok: string) => { const r = await p; if (r.ok) setAviso(ok); else setError(r.error ?? 'No se pudo.'); void cargar() }

  return (
    <div className="card sgs" data-testid="links-pago">
      <div className="sgs-h"><h2>Links de pago</h2><span>{activos.length ? `${activos.length} por atender` : ''}</span></div>
      <p className="sgs-sub">Cuando un cliente quiere pagar con tarjeta: saca el link en la app de BanBajío por el <b>monto exacto</b> y pégalo aquí. Se lo mandamos por su WhatsApp, por correo y queda en su pedido.{cobra ? ' Al ver el cobro en el banco, márcalo pagado.' : ' Dirección lo marca pagado al ver el cobro en el banco.'}</p>
      {error && <div className="pce-error" role="alert">{error}</div>}
      {aviso && <div className="sysnote" role="status" style={{ background: 'var(--ok-bg)', color: 'var(--green-deep)' }}>{aviso}</div>}
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
