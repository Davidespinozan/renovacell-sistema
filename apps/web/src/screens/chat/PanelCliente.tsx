// VINCULAR-CLIENTE · panel "Cliente" de la conversación (Bandeja de Dirección y Conversaciones del vendedor). Responde
// "¿quién es?": la ficha si ya se sabe; si no, sugerencias (teléfono, correo, nombre que escribió) y búsqueda para
// vincularla. Desde la ficha, su vendedor le manda el acceso al portal ahí mismo. Todo lo decide el servidor.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Search, UserCheck, KeyRound, X, UserPlus, IdCard, FileText, ShoppingBag, Banknote, Receipt } from 'lucide-react'
import { expediente as expedientePorDefecto, ETIQUETA_MOTIVO, textoVinculo, type ClienteExpediente, type FichaConversacion, type SugerenciaCliente } from '../../data/ops/expediente'
import { BuscadorClientes, type ClienteBusqueda } from '../../data/ops/buscarClientes'
import { crearInvitacion } from '../../data/ops/invitacion'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import type { ClienteChat } from '../../data/ops/chat'
import { currentUserId } from '../../lib/supabase'
import { useIne, olvidarIne, olvidarComprobante, marcarVinculada } from '../../data/store/ineSeleccion'
import { pagosConversacion, estadoPedidoPago, textoRecibo, type ClientePagos, type MetodoPago, type PedidoCliente } from '../../data/ops/pagoConversacion'
import { cotizaciones as cotPorDefecto, estadoVisible, textoCotizacion, type ClienteCotizaciones, type Cotizacion } from '../../data/ops/cotizaciones'
import { NuevaCotizacion } from '../sales/NuevaCotizacion'
import { NuevoPedido } from '../sales/NuevoPedido'
import { useRoleOpcional } from '../../auth/RoleContext'

const money = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'

export function PanelCliente({ conversationId, chat, onCambio, cliente = expedientePorDefecto, buscador, cot = cotPorDefecto, pagos = pagosConversacion }: {
  conversationId: string
  cot?: ClienteCotizaciones
  pagos?: ClientePagos
  chat?: ClienteChat              // para mandar el acceso al portal dentro de la misma conversación
  onCambio?: () => void           // la conversación pudo pasar a otro vendedor
  cliente?: ClienteExpediente
  buscador?: BuscadorClientes
}) {
  const [ficha, setFicha] = useState<FichaConversacion | null>(null)
  const [sug, setSug] = useState<SugerenciaCliente[]>([])
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ClienteBusqueda[] | null>(null)
  const [estadoBusqueda, setEstadoBusqueda] = useState<string | null>(null)
  const [guardarNumero, setGuardarNumero] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [cambiando, setCambiando] = useState(false)
  const [alta, setAlta] = useState(false)
  const [form, setForm] = useState({ nombre: '', cedula: '', email: '', ciudad: '' })
  const ine = useIne(conversationId)
  // COTIZACIONES · las del cliente, para cotizar, reenviar, convertir en pedido o cancelar desde aquí.
  const user = useRoleOpcional()?.user ?? null
  const [cots, setCots] = useState<Cotizacion[]>([])
  const [modal, setModal] = useState<null | 'cotizar' | 'pedido' | { convertir: Cotizacion }>(null)
  const cargarCots = useCallback(async (customer?: string) => { if (!customer) { setCots([]); return } const r = await cot.deCliente(customer); setCots(r.ok ? r.data : []) }, [cot])
  // PAGO-DESDE-CONVERSACIÓN · sus pedidos: reportar el pago con la foto del comprobante y mandarle el recibo.
  const [pedidos, setPedidos] = useState<PedidoCliente[]>([])
  const [pago, setPago] = useState<{ orderId: string; folio: string | null; monto: string; metodo: MetodoPago; ref: string; opId: string } | null>(null)
  const cargarPedidos = useCallback(async () => { const r = await pagos.pedidos(conversationId); setPedidos(r.ok ? r.data : []) }, [pagos, conversationId])
  const bus = useMemo(() => buscador ?? new BuscadorClientes(), [buscador])
  useEffect(() => () => bus.limpiar(), [bus])

  const cargar = useCallback(async () => {
    const f = await cliente.ficha(conversationId)
    if (!f.ok) { setFicha(null); setMsg({ ok: false, texto: f.mensaje }); return }
    setFicha(f.data)
    marcarVinculada(conversationId, !!(f.data.vinculado && f.data.es_tuyo))
    if (f.data.vinculado && f.data.es_tuyo) { void cargarCots(f.data.customer_id); void cargarPedidos() } else setPedidos([])
    if (!f.data.vinculado && !f.data.con_cuenta) {
      const s = await cliente.sugerencias(conversationId)
      setSug(s.ok ? s.data : [])
    }
  }, [cliente, conversationId, cargarCots, cargarPedidos])
  useEffect(() => { setMsg(null); setRes(null); setQ(''); setCambiando(false); setAlta(false); setPago(null); void cargar() }, [cargar])

  const vincular = async (id: string, nombre: string) => {
    setOcupado(true); setMsg(null)
    const r = await cliente.vincular(conversationId, id, guardarNumero)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setMsg({ ok: true, texto: textoVinculo(r.data, capitalizarNombre(nombre)) })
    setCambiando(false); setRes(null); setQ('')
    // Si pasó a OTRO vendedor, quien vinculó ya no la trabaja: se queda el aviso (sin releer una ficha que ya no es suya).
    if (r.data.reasignada && r.data.vendedor && r.data.vendedor !== currentUserId()) { setFicha({ vinculado: false, con_cuenta: false, traspasada: true }); onCambio?.(); return }
    if (r.data.reasignada) onCambio?.()
    await cargar()
  }
  const desvincular = async () => {
    if (!window.confirm('¿Quitar el vínculo con esta ficha? La conversación sigue igual.')) return
    setOcupado(true)
    const r = await cliente.desvincular(conversationId)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setMsg(null); await cargar()
  }
  const buscar = async () => {
    setEstadoBusqueda(null)
    const r = await bus.buscar(q)
    if (r.estado === 'ok') { setRes(r.clientes); return }
    setRes(null)
    setEstadoBusqueda(r.estado === 'entrada_invalida' ? 'Escribe al menos 3 letras del nombre o los últimos 4 dígitos del teléfono.'
      : r.estado === 'cuota_excedida' ? 'Llegaste al límite de búsquedas por ahora. Intenta en un momento.' : 'No se pudo buscar. Intenta de nuevo.')
  }
  const darDeAlta = async () => {
    if (!window.confirm(`¿Revisaste su cédula${ine.frente ? ' y su INE' : ''}? Queda dada de alta como cliente verificada, en tu cartera.`)) return
    setOcupado(true); setMsg(null)
    const r = await cliente.alta(conversationId, { ...form, ineFrente: ine.frente, ineReverso: ine.reverso })
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    olvidarIne(conversationId); setAlta(false)
    setMsg({ ok: true, texto: `${capitalizarNombre(r.data.nombre)} quedó dada de alta. Ya le puedes mandar su acceso al portal.` })
    await cargar()
  }
  const reenviarCot = async (c: Cotizacion) => {
    if (!chat) return
    setOcupado(true); setMsg(null)
    const e = await chat.enviar(conversationId, textoCotizacion(c, primerNombre(capitalizarNombre(ficha?.nombre ?? '')) || undefined))
    if (e.ok) await cot.enviar(c.id, 'chat')
    setOcupado(false)
    setMsg(e.ok ? { ok: true, texto: `Le reenviaste la cotización ${c.folio}.` } : { ok: false, texto: e.error.mensaje })
    void cargarCots(ficha?.customer_id)
  }
  const cancelarCot = async (c: Cotizacion) => {
    if (!window.confirm(`¿Cancelar la cotización ${c.folio}?`)) return
    const r = await cot.cancelar(c.id)
    setMsg(r.ok ? { ok: true, texto: `Cotización ${c.folio} cancelada.` } : { ok: false, texto: r.mensaje })
    void cargarCots(ficha?.customer_id)
  }
  const abrirPago = (p: PedidoCliente) => setPago({ orderId: p.id, folio: p.folio, monto: String(p.saldo), metodo: 'transferencia', ref: '', opId: crypto.randomUUID() })
  const reportarPago = async () => {
    if (!pago || !ine.comprobante) return
    const monto = Number(pago.monto.replace(/[$,\s]/g, ''))
    if (!(monto > 0)) { setMsg({ ok: false, texto: 'Escribe el monto que pagó.' }); return }
    setOcupado(true); setMsg(null)
    const r = await pagos.reportar({ orderId: pago.orderId, adjuntoId: ine.comprobante, amount: monto, method: pago.metodo, reference: pago.ref.trim(), opId: pago.opId })
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    olvidarComprobante(conversationId); setPago(null)
    setMsg({ ok: true, texto: `Pago de ${money(monto)} reportado para ${pago.folio ?? 'el pedido'}. Dirección lo valida y entonces le puedes mandar su recibo.` })
    void cargarPedidos()
  }
  const mandarRecibo = async (p: PedidoCliente) => {
    const texto = textoRecibo(p, primerNombre(capitalizarNombre(ficha?.nombre ?? '')) || undefined)
    if (!chat || !texto) return
    setOcupado(true); setMsg(null)
    const r = await chat.enviar(conversationId, texto)
    setOcupado(false)
    setMsg(r.ok ? { ok: true, texto: `Le mandaste el recibo de ${p.folio ?? 'su pedido'} por este chat.` } : { ok: false, texto: r.error.mensaje })
  }
  const mandarAcceso = async () => {
    if (!ficha?.customer_id || !chat) return
    const nombre = capitalizarNombre(ficha.nombre ?? '')
    if (!window.confirm(`¿Confirmaste que hablas con ${nombre}? Le llega un enlace para crear su contraseña; su cuenta queda ya verificada y ligada a su ficha.`)) return
    setOcupado(true); setMsg(null)
    const inv = await crearInvitacion(ficha.customer_id)
    if (!inv.ok) { setOcupado(false); setMsg({ ok: false, texto: inv.mensaje }); return }
    const texto = `Hola ${primerNombre(nombre) || nombre}, te dejo tu acceso al portal de Renovacell. Como ya eres cliente, tu cuenta queda verificada: ahí ves precios, haces pedidos y sigues hablando conmigo. Crea tu contraseña aquí: ${inv.data.enlace}`
    const r = await chat.enviar(conversationId, texto)
    setOcupado(false)
    setMsg(r.ok ? { ok: true, texto: 'Le mandaste su acceso al portal por este chat.' } : { ok: false, texto: `Se creó la invitación, pero no se pudo enviar por aquí: ${r.error.mensaje}` })
    await cargar()
  }

  if (!ficha) return msg ? <div className="pc pc--error" role="alert">{msg.texto}</div> : null
  if (!ficha.vinculado && ficha.con_cuenta) return null   // doctor con cuenta y sin ficha: lo atiende Por verificar
  if (ficha.traspasada) return <section className="pc" data-testid="panel-cliente"><div className="pc-msg ok" role="status" data-testid="pc-msg">{msg?.texto}</div></section>

  const Fila = ({ id, nombre, sub, extra }: { id: string; nombre: string; sub: string; extra?: React.ReactNode }) => (
    <li className="pc-cand">
      <span className="pc-av" aria-hidden>{iniciales(capitalizarNombre(nombre))}</span>
      <span className="pc-cand-tx"><b>{capitalizarNombre(nombre)}</b><small>{sub}</small>{extra}</span>
      <button type="button" className="btn sm" disabled={ocupado} onClick={() => void vincular(id, nombre)} data-testid="pc-vincular">Es este cliente</button>
    </li>
  )

  return (
    <section className="pc" data-testid="panel-cliente">
      {ficha.vinculado && !cambiando ? (
        <div className="pc-ficha">
          <span className="pc-av pc-av--ok" aria-hidden>{iniciales(capitalizarNombre(ficha.nombre ?? ''))}</span>
          <div className="pc-ficha-tx">
            <div className="pc-nombre"><b>{capitalizarNombre(ficha.nombre ?? '')}</b>
              <span className={'pill ' + (ficha.tiene_cuenta ? 'p-ok' : 'p-neu')}>{ficha.tiene_cuenta ? 'Con cuenta en el portal' : 'Sin cuenta en el portal'}</span>
            </div>
            <div className="pc-meta">{[ficha.ciudad, ficha.vendedor_nombre ? `Vendedor: ${ficha.vendedor_nombre}` : 'Sin vendedor', ficha.por === 'personal' ? 'vinculada por el equipo' : null].filter(Boolean).join(' · ')}</div>
            {ficha.es_tuyo && (
              <div className="pc-datos">
                {ficha.telefono && <a href={`tel:${ficha.telefono}`}>{ficha.telefono}</a>}
                {ficha.email && <a href={`mailto:${ficha.email}`}>{ficha.email}</a>}
                <span>{ficha.pedidos ?? 0} {ficha.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
                {ficha.ultimo_pedido && <span>Último: {ficha.ultimo_pedido.folio ?? '—'} · {money(ficha.ultimo_pedido.total)} · {fmtDate(ficha.ultimo_pedido.fecha)}</span>}
              </div>
            )}
          </div>
          <div className="pc-acciones">
            {ficha.es_tuyo && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => setModal('cotizar')} data-testid="pc-cotizar"><FileText size={14} /> Cotizar</button>}
            {ficha.es_tuyo && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => setModal('pedido')} data-testid="pc-pedido"><ShoppingBag size={14} /> Levantar pedido</button>}
            {ficha.es_tuyo && !ficha.tiene_cuenta && chat && (
              <button type="button" className="btn sm" disabled={ocupado} onClick={() => void mandarAcceso()} data-testid="pc-acceso"><KeyRound size={14} /> {ficha.invitacion_vigente ? 'Reenviar acceso al portal' : 'Mandar acceso al portal'}</button>
            )}
            {ficha.por === 'personal' && <>
              <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => setCambiando(true)}>Cambiar</button>
              <button type="button" className="rc-ico" disabled={ocupado} onClick={() => void desvincular()} aria-label="Quitar vínculo" title="Quitar vínculo" data-testid="pc-desvincular"><X size={16} /></button>
            </>}
          </div>
          {ficha.es_tuyo && cots.length > 0 && (
            <div className="pc-cots" data-testid="pc-cotizaciones">
              {cots.slice(0, 3).map((c) => {
                const e = estadoVisible(c)
                return (
                  <div key={c.id} className="pc-cot">
                    <b>{c.folio}</b><span>{money(c.total)}</span>
                    <span className={'pill ' + (e === 'vigente' ? 'p-ok' : e === 'convertida' ? 'p-neu' : 'p-warn')}>{e === 'vigente' ? `Vigente al ${fmtDate(c.vigente_hasta)}` : e === 'convertida' ? 'Ya es pedido' : e === 'vencida' ? 'Vencida' : 'Cancelada'}</span>
                    {e === 'vigente' && (
                      <span className="pc-cot-acc">
                        {chat && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void reenviarCot(c)}>Reenviar</button>}
                        <button type="button" className="btn sm" disabled={ocupado} onClick={() => setModal({ convertir: c })} data-testid="pc-convertir">Convertir en pedido</button>
                        <button type="button" className="rc-ico" onClick={() => void cancelarCot(c)} aria-label={`Cancelar ${c.folio}`} title="Cancelar"><X size={15} /></button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {ficha.es_tuyo && pedidos.length > 0 && (
            <div className="pc-cots pc-pedidos" data-testid="pc-pedidos">
              {pedidos.slice(0, 4).map((p) => {
                const e = estadoPedidoPago(p)
                return (
                  <div key={p.id} className="pc-cot">
                    <b>{p.folio ?? '—'}</b><span>{money(p.total)}</span>
                    <span className={'pill p-' + e.tono}>{e.texto}</span>
                    <span className="pc-cot-acc">
                      {p.saldo > 0 && !p.en_revision && <button type="button" className="btn sm" disabled={ocupado} onClick={() => abrirPago(p)} data-testid="pc-reportar-pago"><Banknote size={14} /> Reportar pago</button>}
                      {p.ultimo_pago && chat && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void mandarRecibo(p)} data-testid="pc-recibo"><Receipt size={14} /> Mandar recibo</button>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          {pago && (
            <form className="pc-alta pc-pago" onSubmit={(e) => { e.preventDefault(); void reportarPago() }} data-testid="pc-pago">
              <div className="pc-alta-h"><b>Reportar pago · {pago.folio ?? 'pedido'}</b><span>Pídele la foto de su comprobante por este chat y márcala debajo de la foto. Dirección lo valida.</span></div>
              <input className="pc-campo" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} inputMode="decimal" placeholder="Monto" aria-label="Monto" required />
              <select className="pc-campo" value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value as MetodoPago })} aria-label="Forma de pago">
                <option value="transferencia">Transferencia o depósito</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta (terminal)</option><option value="otro">Otro</option>
              </select>
              <input className="pc-campo" value={pago.ref} onChange={(e) => setPago({ ...pago, ref: e.target.value })} placeholder="Referencia o clave de rastreo (opcional)" aria-label="Referencia" maxLength={80} />
              <div className="pc-ine"><Receipt size={14} aria-hidden /> Comprobante: <span className={ine.comprobante ? 'ok' : ''}>{ine.comprobante ? 'foto elegida ✓' : 'marca su foto en el chat («Usar como comprobante»)'}</span></div>
              <div className="pc-acciones">
                <button type="button" className="btn ghost sm" onClick={() => setPago(null)}>Cancelar</button>
                <button type="submit" className="btn sm" disabled={ocupado || !ine.comprobante} data-testid="pc-pago-enviar">Reportar a Dirección</button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="pc-quien">
          <div className="pc-h"><Link2 size={15} aria-hidden /> <b>¿Quién es?</b> <span>Vincúlala a su ficha y todo queda en su expediente.</span>
            {cambiando && <button type="button" className="rc-ico" onClick={() => setCambiando(false)} aria-label="Cancelar"><X size={16} /></button>}</div>
          {sug.length > 0 && !cambiando && (
            <ul className="pc-lista" data-testid="pc-sugerencias">
              {sug.map((s) => (
                <Fila key={s.customer_id} id={s.customer_id} nombre={s.nombre}
                  sub={[s.ciudad, s.telefono, s.tu_cartera ? 'Tu cliente' : s.vendedor ? `Cliente de ${s.vendedor}` : 'Sin vendedor', s.tiene_cuenta ? 'con cuenta' : null].filter(Boolean).join(' · ')}
                  extra={<span className="pc-motivo"><UserCheck size={12} aria-hidden /> {ETIQUETA_MOTIVO[s.motivo]}</span>} />
              ))}
            </ul>
          )}
          <form className="pc-buscar" onSubmit={(e) => { e.preventDefault(); void buscar() }}>
            <span className="searchbox"><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o últimos 4 dígitos" aria-label="Buscar cliente" data-testid="pc-q" /></span>
            <button type="submit" className="btn ghost sm" disabled={!q.trim()}>Buscar</button>
          </form>
          {estadoBusqueda && <div className="pc-nota">{estadoBusqueda}</div>}
          {res && (res.length === 0
            ? <div className="pc-nota">Sin coincidencias. Si es cliente nuevo, puede registrarse desde el portal.</div>
            : <ul className="pc-lista" data-testid="pc-resultados">{res.map((c) => <Fila key={c.customer_id} id={c.customer_id} nombre={c.nombre} sub={c.telefono_mascara ?? 'sin teléfono'} />)}</ul>)}
          <label className="pc-check"><input type="checkbox" checked={guardarNumero} onChange={(e) => setGuardarNumero(e.target.checked)} /> Guardar en su ficha el número desde el que escribe</label>
          {!cambiando && !alta && <button type="button" className="btn ghost sm pc-alta-btn" onClick={() => setAlta(true)} data-testid="pc-alta-abrir"><UserPlus size={14} /> No es cliente todavía: darla de alta</button>}
          {alta && (
            <form className="pc-alta" onSubmit={(e) => { e.preventDefault(); void darDeAlta() }} data-testid="pc-alta">
              <div className="pc-alta-h"><b>Alta de cliente</b><span>Pídele sus datos por este chat. Si te manda su INE, márcala debajo de la foto.</span></div>
              <input className="pc-campo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre completo" aria-label="Nombre completo" required />
              <input className="pc-campo" value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} placeholder="Cédula profesional" inputMode="numeric" aria-label="Cédula profesional" required />
              <input className="pc-campo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Correo (para su acceso)" aria-label="Correo" />
              <input className="pc-campo" value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} placeholder="Ciudad" aria-label="Ciudad" />
              <div className="pc-ine"><IdCard size={14} aria-hidden /> INE: <span className={ine.frente ? 'ok' : ''}>{ine.frente ? 'frente ✓' : 'frente pendiente'}</span> · <span className={ine.reverso ? 'ok' : ''}>{ine.reverso ? 'reverso ✓' : 'reverso pendiente'}</span></div>
              <div className="pc-acciones">
                <button type="button" className="btn ghost sm" onClick={() => setAlta(false)}>Cancelar</button>
                <button type="submit" className="btn sm" disabled={ocupado || !form.nombre.trim() || !form.cedula.trim()} data-testid="pc-alta-guardar">Dar de alta verificada</button>
              </div>
            </form>
          )}
        </div>
      )}
      {msg && <div className={'pc-msg' + (msg.ok ? ' ok' : '')} role={msg.ok ? 'status' : 'alert'} data-testid="pc-msg">{msg.texto}</div>}
      {modal === 'cotizar' && ficha.customer_id && (
        <NuevaCotizacion customer={{ id: ficha.customer_id, name: ficha.nombre ?? '', email: ficha.email }} conversationId={conversationId} chat={chat} cliente={cot}
          onClose={() => { setModal(null); void cargarCots(ficha.customer_id) }} />
      )}
      {(modal === 'pedido' || (modal && typeof modal === 'object')) && ficha.customer_id && (
        <NuevoPedido customer={{ id: ficha.customer_id, name: ficha.nombre ?? '', phone: ficha.telefono ?? null }} placedBy={user?.name ?? 'Ventas'}
          initialCart={typeof modal === 'object' && modal ? Object.fromEntries(modal.convertir.lineas.map((l) => [l.product_id, l.qty])) : undefined}
          onClose={() => { setModal(null); void cargar() }}
          onCreado={(pedido) => { if (typeof modal === 'object' && modal && pedido) void cot.convertida(modal.convertir.id, pedido.id).then(() => cargarCots(ficha.customer_id)) }} />
      )}
    </section>
  )
}

/** ALTA-DESDE-CONVERSACIÓN · debajo de cada foto que mandó quien escribe (sin cuenta): marcarla como su INE para el alta.
 *  PAGO-DESDE-CONVERSACIÓN · ya ligada a su ficha, la foto se marca como comprobante de pago. */
export function accionesIneVisitante(conversationId: string, sel: { frente?: string; reverso?: string; comprobante?: string; vinculada?: boolean }, elegir: (lado: 'frente' | 'reverso' | 'comprobante', id: string) => void) {
  return (m: { actor: string; adjunto?: { id: string; uso?: string | null } | null }) => (m.actor === 'visitor' && m.adjunto && sel.vinculada ? (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="acciones-comprobante">
      <button type="button" className={'btn ghost sm' + (sel.comprobante === m.adjunto.id ? ' on' : '')} onClick={() => elegir('comprobante', m.adjunto!.id)}>
        {sel.comprobante === m.adjunto.id ? 'Comprobante ✓' : 'Usar como comprobante de pago'}
      </button>
    </span>
  ) : m.actor === 'visitor' && m.adjunto && !m.adjunto.uso ? (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="acciones-ine-visitante">
      {(['frente', 'reverso'] as const).map((lado) => (
        <button key={lado} type="button" className={'btn ghost sm' + (sel[lado] === m.adjunto!.id ? ' on' : '')} onClick={() => elegir(lado, m.adjunto!.id)}>
          {sel[lado] === m.adjunto!.id ? `INE ${lado} ✓` : `Usar como INE ${lado}`}
        </button>
      ))}
    </span>
  ) : null)
}
