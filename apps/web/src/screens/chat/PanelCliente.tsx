// VINCULAR-CLIENTE → EXPEDIENTE EN EL CHAT · el cliente de la conversación se trabaja DENTRO del chat (Bandeja de Dirección
// y Conversaciones del vendedor), no en un panel aparte: una franja bajo el encabezado dice quién es; el menú «+» del
// redactor ofrece lo que se puede hacer (vincular, darla de alta verificada, mandarle su acceso, cotizar, levantar pedido,
// registrar su pago, mandarle el recibo) y cada acción abre su hoja sobre el redactor con el hilo a la vista. Las fotos del
// hilo alimentan las hojas («Usar como INE» → alta, «Usar como comprobante» → pago). Todo lo decide el servidor.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Search, UserCheck, KeyRound, UserPlus, IdCard, FileText, ShoppingBag, Banknote, Receipt, Contact, Send } from 'lucide-react'
import { expediente as expedientePorDefecto, ETIQUETA_MOTIVO, textoVinculo, type ClienteExpediente, type FichaConversacion, type SugerenciaCliente } from '../../data/ops/expediente'
import { BuscadorClientes, type ClienteBusqueda } from '../../data/ops/buscarClientes'
import { crearInvitacion } from '../../data/ops/invitacion'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import type { ClienteChat } from '../../data/ops/chat'
import { currentUserId } from '../../lib/supabase'
import { useIne, olvidarIne, olvidarComprobante, marcarVinculada, type UsoFoto } from '../../data/store/ineSeleccion'
import { abrirHoja, cerrarHoja, useHoja } from '../../data/store/hojaChat'
import { pagosConversacion, estadoPedidoPago, textoRecibo, type ClientePagos, type MetodoPago, type PedidoCliente } from '../../data/ops/pagoConversacion'
import { cotizaciones as cotPorDefecto, estadoVisible, textoCotizacion, type ClienteCotizaciones, type Cotizacion } from '../../data/ops/cotizaciones'
import { NuevaCotizacion } from '../sales/NuevaCotizacion'
import { NuevoPedido } from '../sales/NuevoPedido'
import { useRoleOpcional } from '../../auth/RoleContext'
import { HojaMarco, type PiezasChat } from './HojaChat'
import { PerfilComercialEditor } from '../../app/PerfilComercialEditor'
import type { AccionChat } from './ChatCanonico'

const money = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'
const textoAcceso = (nombre: string, enlace: string) => `Hola ${primerNombre(nombre) || nombre}, te dejo tu acceso al portal de Renovacell. Como ya eres cliente, tu cuenta queda verificada: ahí ves precios, haces pedidos y sigues hablando conmigo. Crea tu contraseña aquí: ${enlace}`

interface Props {
  conversationId: string
  cot?: ClienteCotizaciones
  pagos?: ClientePagos
  chat?: ClienteChat              // para mandar acceso, cotización y recibo dentro de la misma conversación
  onCambio?: () => void           // la conversación pudo pasar a otro vendedor
  cliente?: ClienteExpediente
  buscador?: BuscadorClientes
  activo?: boolean                // false: esta conversación no se trabaja aquí (p. ej. doctor con cuenta en la Bandeja)
}

/** Franja, acciones y hojas del cliente de esta conversación, para montarlas en el chat. */
export function usePanelCliente({ conversationId, chat, onCambio, cliente = expedientePorDefecto, buscador, cot = cotPorDefecto, pagos = pagosConversacion, activo = true }: Props): PiezasChat {
  const [ficha, setFicha] = useState<FichaConversacion | null>(null)
  const [sug, setSug] = useState<SugerenciaCliente[]>([])
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ClienteBusqueda[] | null>(null)
  const [estadoBusqueda, setEstadoBusqueda] = useState<string | null>(null)
  const [guardarNumero, setGuardarNumero] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [form, setForm] = useState({ nombre: '', cedula: '', email: '', ciudad: '' })
  const [revisado, setRevisado] = useState(false)
  const ine = useIne(conversationId)
  const hojaAbierta = useHoja(conversationId)
  const hoja = hojaAbierta?.startsWith('pc:') ? hojaAbierta : null
  const abrir = useCallback((k: string) => { setMsg(null); abrirHoja(conversationId, k) }, [conversationId])
  const cerrar = useCallback(() => { setMsg(null); cerrarHoja(conversationId) }, [conversationId])
  // COTIZACIONES · las del cliente, para cotizar, reenviar, convertir en pedido o cancelar desde aquí.
  const user = useRoleOpcional()?.user ?? null
  const [cots, setCots] = useState<Cotizacion[]>([])
  const [modal, setModal] = useState<null | 'cotizar' | 'pedido' | { convertir: Cotizacion }>(null)
  const cargarCots = useCallback(async (customer?: string) => { if (!customer) { setCots([]); return } const r = await cot.deCliente(customer); setCots(r.ok ? r.data : []) }, [cot])
  // PAGO-DESDE-CONVERSACIÓN · sus pedidos: registrar el pago con la foto del comprobante y mandarle el recibo.
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
  useEffect(() => { setFicha(null); setMsg(null); setRes(null); setQ(''); setPago(null); setRevisado(false); if (activo) void cargar() }, [cargar, activo])

  const porCobrar = pedidos.filter((p) => p.saldo > 0 && !p.en_revision)
  const conRecibo = pedidos.filter((p) => p.ultimo_pago)
  const abrirPago = (p: PedidoCliente) => { setPago({ orderId: p.id, folio: p.folio, monto: String(p.saldo), metodo: 'transferencia', ref: '', opId: crypto.randomUUID() }); abrir('pc:pago') }
  // Abierta desde una foto («Usar como comprobante»): si solo hay un pedido por cobrar, ya va elegido.
  useEffect(() => {
    if (hoja === 'pc:pago' && !pago && porCobrar.length === 1) {
      const p = porCobrar[0]
      setPago({ orderId: p.id, folio: p.folio, monto: String(p.saldo), metodo: 'transferencia', ref: '', opId: crypto.randomUUID() })
    }
  }, [hoja, pago, porCobrar])

  const vincular = async (id: string, nombre: string) => {
    setOcupado(true); setMsg(null)
    const r = await cliente.vincular(conversationId, id, guardarNumero)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    cerrarHoja(conversationId); setRes(null); setQ('')
    setMsg({ ok: true, texto: textoVinculo(r.data, capitalizarNombre(nombre)) })
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
    cerrar(); await cargar()
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
    setOcupado(true); setMsg(null)
    const r = await cliente.alta(conversationId, { ...form, ineFrente: ine.frente, ineReverso: ine.reverso })
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    olvidarIne(conversationId); cerrarHoja(conversationId); setRevisado(false); setForm({ nombre: '', cedula: '', email: '', ciudad: '' })
    setMsg({ ok: true, texto: `${capitalizarNombre(r.data.nombre)} quedó dada de alta y verificada. Ya le puedes mandar su acceso al portal desde «+».` })
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
  const reportarPago = async () => {
    if (!pago || !ine.comprobante) return
    const monto = Number(pago.monto.replace(/[$,\s]/g, ''))
    if (!(monto > 0)) { setMsg({ ok: false, texto: 'Escribe el monto que pagó.' }); return }
    setOcupado(true); setMsg(null)
    const r = await pagos.reportar({ orderId: pago.orderId, adjuntoId: ine.comprobante, amount: monto, method: pago.metodo, reference: pago.ref.trim(), opId: pago.opId })
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    olvidarComprobante(conversationId); cerrarHoja(conversationId)
    setMsg({ ok: true, texto: `Pago de ${money(monto)} reportado para ${pago.folio ?? 'el pedido'}. Dirección lo valida y entonces le mandas su recibo desde «+».` })
    setPago(null)
    void cargarPedidos()
  }
  const mandarRecibo = async (p: PedidoCliente) => {
    const texto = textoRecibo(p, primerNombre(capitalizarNombre(ficha?.nombre ?? '')) || undefined)
    if (!chat || !texto) return
    setOcupado(true); setMsg(null)
    const r = await chat.enviar(conversationId, texto)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.error.mensaje }); return }
    cerrarHoja(conversationId)
    setMsg({ ok: true, texto: `Le mandaste el recibo de ${p.folio ?? 'su pedido'}.` })
  }
  const mandarAcceso = async () => {
    if (!ficha?.customer_id || !chat) return
    const nombre = capitalizarNombre(ficha.nombre ?? '')
    setOcupado(true); setMsg(null)
    const inv = await crearInvitacion(ficha.customer_id)
    if (!inv.ok) { setOcupado(false); setMsg({ ok: false, texto: inv.mensaje }); return }
    const r = await chat.enviar(conversationId, textoAcceso(nombre, inv.data.enlace))
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: `Se creó la invitación, pero no se pudo enviar por aquí: ${r.error.mensaje}` }); return }
    cerrarHoja(conversationId)
    setMsg({ ok: true, texto: 'Le mandaste su acceso al portal. Cuando cree su contraseña, su cuenta queda ligada a esta ficha.' })
    await cargar()
  }

  const vacio: PiezasChat = { tira: null, hoja: null, acciones: [] }
  if (!activo || !ficha) return { ...vacio, tira: activo && msg && !msg.ok ? <div className="pc-tira-msg" role="alert">{msg.texto}</div> : null }
  if (!ficha.vinculado && ficha.con_cuenta) return vacio   // doctor con cuenta y sin ficha: lo atiende la verificación
  const aviso = msg && <div className={'pc-msg' + (msg.ok ? ' ok' : '')} role={msg.ok ? 'status' : 'alert'} data-testid="pc-msg">{msg.texto}</div>
  if (ficha.traspasada) return { ...vacio, tira: <div className="pc-tira-msg">{aviso}</div> }

  const nombre = capitalizarNombre(ficha.nombre ?? '')
  const debe = pedidos.reduce((s, p) => s + Math.max(0, p.saldo), 0)
  const enRevision = pedidos.some((p) => p.en_revision)

  // ── Franja: quién es ─────────────────────────────────────────────────────────────────────────────────
  const tiraFicha = ficha.vinculado ? (
    <button type="button" className="pc-tira" onClick={() => (hoja === 'pc:ficha' ? cerrar() : abrir('pc:ficha'))} aria-expanded={hoja === 'pc:ficha'} data-testid="pc-tira">
      <span className="pc-av pc-av--ok pc-av--sm" aria-hidden>{iniciales(nombre)}</span>
      <span className="pc-tira-tx">
        <b>{nombre}</b>
        <small>{[ficha.es_tuyo ? 'Tu cliente' : ficha.vendedor_nombre ? `Cliente de ${ficha.vendedor_nombre}` : 'Sin vendedor',
          ficha.es_tuyo ? `${ficha.pedidos ?? 0} ${ficha.pedidos === 1 ? 'pedido' : 'pedidos'}` : null,
          debe > 0 ? `debe ${money(debe)}` : null, enRevision ? 'pago en revisión' : null].filter(Boolean).join(' · ')}</small>
      </span>
      <span className={'pill ' + (ficha.tiene_cuenta ? 'p-ok' : 'p-neu')}>{ficha.tiene_cuenta ? 'Con cuenta' : 'Sin cuenta'}</span>
    </button>
  ) : (
    <button type="button" className="pc-tira pc-tira--quien" onClick={() => (hoja === 'pc:quien' ? cerrar() : abrir('pc:quien'))} aria-expanded={hoja === 'pc:quien'} data-testid="pc-tira">
      <span className="pc-av pc-av--sm" aria-hidden><Link2 size={16} /></span>
      <span className="pc-tira-tx">
        <b>¿Quién es?</b>
        <small>{sug[0] ? `Puede ser ${capitalizarNombre(sug[0].nombre)} (${ETIQUETA_MOTIVO[sug[0].motivo].toLowerCase()})` : 'Sin ficha: vincúlala a su cliente o dala de alta'}</small>
      </span>
      <span className="pc-tira-cta">Vincular</span>
    </button>
  )
  const modales = <>
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
  </>
  const tira = <>{tiraFicha}{!hoja && aviso}{modales}</>

  // ── Menú «+»: lo que se puede hacer con este cliente ────────────────────────────────────────────────
  const acciones: AccionChat[] = []
  if (!ficha.vinculado) {
    acciones.push({ clave: 'vincular', etiqueta: 'Vincular a un cliente', detalle: 'Ya es cliente: búscala y liga esta conversación a su ficha', icono: <Link2 size={18} />, onElegir: () => abrir('pc:quien') })
    acciones.push({ clave: 'alta', etiqueta: 'Verificar y dar de alta', detalle: 'Cliente nuevo: su cédula y las fotos de su INE de este chat', icono: <UserPlus size={18} />, onElegir: () => abrir('pc:alta') })
  } else if (ficha.es_tuyo) {
    if (!ficha.tiene_cuenta && chat) acciones.push({ clave: 'acceso', etiqueta: ficha.invitacion_vigente ? 'Reenviar acceso al portal' : 'Mandar acceso al portal', detalle: 'Le llega aquí un enlace para crear su contraseña', icono: <KeyRound size={18} />, onElegir: () => abrir('pc:acceso') })
    acciones.push({ clave: 'cotizar', etiqueta: 'Cotizar', detalle: 'Arma la cotización y mándasela por este chat', icono: <FileText size={18} />, onElegir: () => setModal('cotizar') })
    acciones.push({ clave: 'pedido', etiqueta: 'Levantar pedido', icono: <ShoppingBag size={18} />, onElegir: () => setModal('pedido') })
    if (porCobrar.length) acciones.push({ clave: 'pago', etiqueta: 'Registrar pago', detalle: 'Con la foto del comprobante que te mandó', icono: <Banknote size={18} />, onElegir: () => { if (porCobrar.length === 1) abrirPago(porCobrar[0]); else { setPago(null); abrir('pc:pago') } } })
    if (conRecibo.length && chat) acciones.push({ clave: 'recibo', etiqueta: 'Mandar recibo', detalle: 'Del pago que ya validó Dirección', icono: <Receipt size={18} />, onElegir: () => abrir('pc:recibo') })
    acciones.push({ clave: 'ficha', etiqueta: 'Ver su ficha', detalle: 'Datos, pedidos y cotizaciones', icono: <Contact size={18} />, onElegir: () => abrir('pc:ficha') })
  } else acciones.push({ clave: 'ficha', etiqueta: 'Ver su ficha', icono: <Contact size={18} />, onElegir: () => abrir('pc:ficha') })

  // ── Hojas ───────────────────────────────────────────────────────────────────────────────────────────
  const Fila = ({ id, nombre: n, sub, extra }: { id: string; nombre: string; sub: string; extra?: React.ReactNode }) => (
    <li className="pc-cand">
      <span className="pc-av" aria-hidden>{iniciales(capitalizarNombre(n))}</span>
      <span className="pc-cand-tx"><b>{capitalizarNombre(n)}</b><small>{sub}</small>{extra}</span>
      <button type="button" className="btn sm" disabled={ocupado} onClick={() => void vincular(id, n)} data-testid="pc-vincular">Es este cliente</button>
    </li>
  )
  const Foto = ({ uso, etiqueta }: { uso: UsoFoto; etiqueta: string }) => (
    <span className={'pc-foto' + (ine[uso] ? ' ok' : '')}>
      {ine.url?.[uso] ? <img src={ine.url[uso]} alt={etiqueta} /> : <IdCard size={16} aria-hidden />}
      <small>{ine[uso] ? `${etiqueta} ✓` : `${etiqueta} pendiente`}</small>
    </span>
  )
  let cuerpo: React.ReactNode = null
  if (hoja === 'pc:quien') cuerpo = (
    <HojaMarco titulo={ficha.vinculado ? 'Cambiar de cliente' : '¿Quién es?'} sub="Vincúlala a su ficha y todo queda en su expediente." onCerrar={cerrar} testid="pc-hoja-quien">
      {sug.length > 0 && (
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
        ? <div className="pc-nota">Sin coincidencias. Si es cliente nuevo, dala de alta.</div>
        : <ul className="pc-lista" data-testid="pc-resultados">{res.map((c) => <Fila key={c.customer_id} id={c.customer_id} nombre={c.nombre} sub={c.telefono_mascara ?? 'sin teléfono'} />)}</ul>)}
      <label className="pc-check"><input type="checkbox" checked={guardarNumero} onChange={(e) => setGuardarNumero(e.target.checked)} /> Guardar en su ficha el número desde el que escribe</label>
      {!ficha.vinculado && <button type="button" className="btn ghost sm pc-alta-btn" onClick={() => abrir('pc:alta')} data-testid="pc-alta-abrir"><UserPlus size={14} /> No es cliente todavía: verificarla y darla de alta</button>}
      {aviso}
    </HojaMarco>
  )
  else if (hoja === 'pc:alta' && !ficha.vinculado) cuerpo = (
    <HojaMarco titulo="Verificar y dar de alta" sub="Pídele sus datos y las fotos de su INE por este chat; marca cada foto debajo de ella." onCerrar={cerrar} testid="pc-hoja-alta">
      <form className="pc-form" onSubmit={(e) => { e.preventDefault(); void darDeAlta() }} data-testid="pc-alta">
        <input className="pc-campo" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre completo" aria-label="Nombre completo" required />
        <input className="pc-campo" value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} placeholder="Cédula profesional" inputMode="numeric" aria-label="Cédula profesional" required />
        <input className="pc-campo" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Correo (para su acceso)" aria-label="Correo" />
        <input className="pc-campo" value={form.ciudad} onChange={(e) => setForm({ ...form, ciudad: e.target.value })} placeholder="Ciudad" aria-label="Ciudad" />
        <div className="pc-fotos"><Foto uso="frente" etiqueta="INE frente" /><Foto uso="reverso" etiqueta="INE reverso" /></div>
        <label className="pc-check"><input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} data-testid="pc-alta-revisado" /> Revisé su cédula{ine.frente ? ' y su INE' : ''}: es quien dice ser</label>
        {aviso}
        <div className="pc-acciones">
          <button type="submit" className="btn" disabled={ocupado || !revisado || !form.nombre.trim() || !form.cedula.trim()} data-testid="pc-alta-guardar">Dar de alta verificada</button>
        </div>
      </form>
    </HojaMarco>
  )
  else if (hoja === 'pc:acceso' && ficha.vinculado) cuerpo = (
    <HojaMarco titulo={ficha.invitacion_vigente ? 'Reenviar acceso al portal' : 'Mandar acceso al portal'} sub={`Confirma que hablas con ${nombre}: su cuenta queda verificada y ligada a esta ficha.`} onCerrar={cerrar} testid="pc-hoja-acceso">
      <div className="pc-previa" aria-label="Lo que le llega">{textoAcceso(nombre, '[enlace para crear su contraseña]')}</div>
      {aviso}
      <div className="pc-acciones"><button type="button" className="btn" disabled={ocupado} onClick={() => void mandarAcceso()} data-testid="pc-acceso"><Send size={15} /> Mandar por este chat</button></div>
    </HojaMarco>
  )
  else if (hoja === 'pc:pago' && ficha.vinculado) cuerpo = (
    <HojaMarco titulo={`Registrar pago${pago?.folio ? ` · ${pago.folio}` : ''}`} sub="Queda en revisión; Dirección lo valida con la foto del comprobante." onCerrar={() => { setPago(null); cerrar() }} testid="pc-hoja-pago">
      {!pago ? (
        porCobrar.length === 0 ? <div className="pc-nota">No tiene pedidos por cobrar.</div> : (
          <ul className="pc-lista">
            <li className="pc-nota">¿De qué pedido es el pago?</li>
            {porCobrar.map((p) => (
              <li key={p.id} className="pc-cand">
                <span className="pc-cand-tx"><b>{p.folio ?? '—'} · {money(p.total)}</b><small>{fmtDate(p.fecha)} · debe {money(p.saldo)}</small></span>
                <button type="button" className="btn sm" onClick={() => abrirPago(p)} data-testid="pc-pago-pedido">Es este</button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form className="pc-form" onSubmit={(e) => { e.preventDefault(); void reportarPago() }} data-testid="pc-pago">
          <div className="pc-fotos">
            <span className={'pc-foto pc-foto--ancha' + (ine.comprobante ? ' ok' : '')}>
              {ine.url?.comprobante ? <img src={ine.url.comprobante} alt="Comprobante" /> : <Receipt size={16} aria-hidden />}
              <small>{ine.comprobante ? 'Comprobante ✓' : 'Toca «Usar como comprobante» debajo de su foto en el chat'}</small>
            </span>
          </div>
          <input className="pc-campo" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} inputMode="decimal" placeholder="Monto" aria-label="Monto" required />
          <select className="pc-campo" value={pago.metodo} onChange={(e) => setPago({ ...pago, metodo: e.target.value as MetodoPago })} aria-label="Forma de pago">
            <option value="transferencia">Transferencia o depósito</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta (terminal)</option><option value="otro">Otro</option>
          </select>
          <input className="pc-campo" value={pago.ref} onChange={(e) => setPago({ ...pago, ref: e.target.value })} placeholder="Referencia o clave de rastreo (opcional)" aria-label="Referencia" maxLength={80} />
          {aviso}
          <div className="pc-acciones">
            {porCobrar.length > 1 && <button type="button" className="btn ghost sm" onClick={() => setPago(null)}>Otro pedido</button>}
            <button type="submit" className="btn" disabled={ocupado || !ine.comprobante} data-testid="pc-pago-enviar">Reportar a Dirección</button>
          </div>
        </form>
      )}
    </HojaMarco>
  )
  else if (hoja === 'pc:recibo' && ficha.vinculado) cuerpo = (
    <HojaMarco titulo="Mandar recibo" sub="Le llega por este chat con el monto, la fecha y cómo quedó su pedido." onCerrar={cerrar} testid="pc-hoja-recibo">
      <ul className="pc-lista">
        {conRecibo.map((p) => (
          <li key={p.id} className="pc-cand">
            <span className="pc-cand-tx"><b>{p.folio ?? '—'} · {money(p.ultimo_pago!.monto)}</b><small>{estadoPedidoPago(p).texto} · pago del {fmtDate(p.ultimo_pago!.fecha)}</small></span>
            <button type="button" className="btn sm" disabled={ocupado} onClick={() => void mandarRecibo(p)} data-testid="pc-recibo">Mandar</button>
          </li>
        ))}
      </ul>
      {aviso}
    </HojaMarco>
  )
  else if (hoja === 'pc:ficha' && ficha.vinculado) cuerpo = (
    <HojaMarco titulo={nombre} sub={[ficha.ciudad, ficha.vendedor_nombre ? `Vendedor: ${ficha.vendedor_nombre}` : 'Sin vendedor', ficha.por === 'personal' ? 'vinculada por el equipo' : null].filter(Boolean).join(' · ')} onCerrar={cerrar} testid="pc-hoja-ficha">
      {ficha.es_tuyo && ficha.customer_id && <PerfilComercialEditor customerId={ficha.customer_id} compacto />}
      {ficha.es_tuyo && (
        <div className="pc-datos">
          {ficha.telefono && <a href={`tel:${ficha.telefono}`}>{ficha.telefono}</a>}
          {ficha.email && <a href={`mailto:${ficha.email}`}>{ficha.email}</a>}
          <span>{ficha.tiene_cuenta ? 'Con cuenta en el portal' : 'Sin cuenta en el portal'}</span>
        </div>
      )}
      {ficha.es_tuyo && pedidos.length > 0 && (
        <div className="pc-cots pc-pedidos" data-testid="pc-pedidos">
          <small className="pc-sec">Pedidos</small>
          {pedidos.slice(0, 5).map((p) => {
            const e = estadoPedidoPago(p)
            return (
              <div key={p.id} className="pc-cot">
                <b>{p.folio ?? '—'}</b><span>{money(p.total)}</span>
                <span className={'pill p-' + e.tono}>{e.texto}</span>
                <span className="pc-cot-acc">
                  {p.saldo > 0 && !p.en_revision && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => abrirPago(p)} data-testid="pc-reportar-pago">Registrar pago</button>}
                  {p.ultimo_pago && chat && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void mandarRecibo(p)}>Mandar recibo</button>}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {ficha.es_tuyo && cots.length > 0 && (
        <div className="pc-cots" data-testid="pc-cotizaciones">
          <small className="pc-sec">Cotizaciones</small>
          {cots.slice(0, 4).map((c) => {
            const e = estadoVisible(c)
            return (
              <div key={c.id} className="pc-cot">
                <b>{c.folio}</b><span>{money(c.total)}</span>
                <span className={'pill ' + (e === 'vigente' ? 'p-ok' : e === 'convertida' ? 'p-neu' : 'p-warn')}>{e === 'vigente' ? `Vigente al ${fmtDate(c.vigente_hasta)}` : e === 'convertida' ? 'Ya es pedido' : e === 'vencida' ? 'Vencida' : 'Cancelada'}</span>
                {e === 'vigente' && (
                  <span className="pc-cot-acc">
                    {chat && <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void reenviarCot(c)}>Reenviar</button>}
                    <button type="button" className="btn sm" disabled={ocupado} onClick={() => setModal({ convertir: c })} data-testid="pc-convertir">Convertir en pedido</button>
                    <button type="button" className="btn ghost sm" onClick={() => void cancelarCot(c)} aria-label={`Cancelar ${c.folio}`}>Cancelar</button>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {aviso}
      {ficha.por === 'personal' && (
        <div className="pc-acciones">
          <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => abrir('pc:quien')}>Cambiar de cliente</button>
          <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void desvincular()} data-testid="pc-desvincular">Quitar vínculo</button>
        </div>
      )}
    </HojaMarco>
  )
  return { tira, hoja: cuerpo, acciones }
}

/** Vista suelta (sin chat): franja, acciones como botones y la hoja abierta. La usan las pruebas. */
export function PanelCliente(props: Props) {
  const p = usePanelCliente(props)
  if (!p.tira && !p.hoja && p.acciones.length === 0) return null
  return (
    <section className="pc" data-testid="panel-cliente">
      {p.tira}
      {p.acciones.length > 0 && <div className="pc-acciones">{p.acciones.map((a) => <button key={a.clave} type="button" className="btn ghost sm" onClick={a.onElegir} data-testid={`accion-${a.clave}`}>{a.etiqueta}</button>)}</div>}
      {p.hoja}
    </section>
  )
}

/** Debajo de cada foto que mandó quien escribe: sin ficha, marcarla como su INE (abre el alta); ya ligada a su ficha,
 *  como comprobante de pago (abre el registro del pago). La foto ya marcada se señala. */
export function accionesIneVisitante(conversationId: string, sel: { frente?: string; reverso?: string; comprobante?: string; vinculada?: boolean }, elegir: (lado: UsoFoto, id: string, url?: string | null) => void) {
  const usar = (lado: UsoFoto, a: { id: string; url?: string | null }) => { elegir(lado, a.id, a.url); abrirHoja(conversationId, lado === 'comprobante' ? 'pc:pago' : 'pc:alta') }
  return (m: { actor: string; adjunto?: { id: string; uso?: string | null; url?: string | null } | null }) => (m.actor === 'visitor' && m.adjunto && sel.vinculada ? (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="acciones-comprobante">
      <button type="button" className={'btn ghost sm' + (sel.comprobante === m.adjunto.id ? ' on' : '')} onClick={() => usar('comprobante', m.adjunto!)}>
        {sel.comprobante === m.adjunto.id ? 'Comprobante ✓' : 'Usar como comprobante de pago'}
      </button>
    </span>
  ) : m.actor === 'visitor' && m.adjunto && !m.adjunto.uso ? (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="acciones-ine-visitante">
      {(['frente', 'reverso'] as const).map((lado) => (
        <button key={lado} type="button" className={'btn ghost sm' + (sel[lado] === m.adjunto!.id ? ' on' : '')} onClick={() => usar(lado, m.adjunto!)}>
          {sel[lado] === m.adjunto!.id ? `INE ${lado} ✓` : `Usar como INE ${lado}`}
        </button>
      ))}
    </span>
  ) : null)
}
