// VINCULAR-CLIENTE · panel "Cliente" de la conversación (Bandeja de Dirección y Conversaciones del vendedor). Responde
// "¿quién es?": la ficha si ya se sabe; si no, sugerencias (teléfono, correo, nombre que escribió) y búsqueda para
// vincularla. Desde la ficha, su vendedor le manda el acceso al portal ahí mismo. Todo lo decide el servidor.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Search, UserCheck, KeyRound, X } from 'lucide-react'
import { expediente as expedientePorDefecto, ETIQUETA_MOTIVO, textoVinculo, type ClienteExpediente, type FichaConversacion, type SugerenciaCliente } from '../../data/ops/expediente'
import { BuscadorClientes, type ClienteBusqueda } from '../../data/ops/buscarClientes'
import { crearInvitacion } from '../../data/ops/invitacion'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import type { ClienteChat } from '../../data/ops/chat'
import { currentUserId } from '../../lib/supabase'

const money = (n: number) => `$${Math.round(n).toLocaleString('es-MX')}`
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'

export function PanelCliente({ conversationId, chat, onCambio, cliente = expedientePorDefecto, buscador }: {
  conversationId: string
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
  const bus = useMemo(() => buscador ?? new BuscadorClientes(), [buscador])
  useEffect(() => () => bus.limpiar(), [bus])

  const cargar = useCallback(async () => {
    const f = await cliente.ficha(conversationId)
    if (!f.ok) { setFicha(null); setMsg({ ok: false, texto: f.mensaje }); return }
    setFicha(f.data)
    if (!f.data.vinculado && !f.data.con_cuenta) {
      const s = await cliente.sugerencias(conversationId)
      setSug(s.ok ? s.data : [])
    }
  }, [cliente, conversationId])
  useEffect(() => { setMsg(null); setRes(null); setQ(''); setCambiando(false); void cargar() }, [cargar])

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
            {ficha.es_tuyo && !ficha.tiene_cuenta && chat && (
              <button type="button" className="btn sm" disabled={ocupado} onClick={() => void mandarAcceso()} data-testid="pc-acceso"><KeyRound size={14} /> {ficha.invitacion_vigente ? 'Reenviar acceso al portal' : 'Mandar acceso al portal'}</button>
            )}
            {ficha.por === 'personal' && <>
              <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => setCambiando(true)}>Cambiar</button>
              <button type="button" className="rc-ico" disabled={ocupado} onClick={() => void desvincular()} aria-label="Quitar vínculo" title="Quitar vínculo" data-testid="pc-desvincular"><X size={16} /></button>
            </>}
          </div>
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
        </div>
      )}
      {msg && <div className={'pc-msg' + (msg.ok ? ' ok' : '')} role={msg.ok ? 'status' : 'alert'} data-testid="pc-msg">{msg.texto}</div>}
    </section>
  )
}
