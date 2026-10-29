// BANDEJA-2 · DIRECCIÓN · Conversaciones: UNA bandeja estilo WhatsApp Web para todos los orígenes (WhatsApp, Instagram,
// Messenger, enlace de contacto, portal). Izquierda: la lista por lo que hay que hacer (Por atender · En atención · IA ·
// Todas), buscador y filtro de origen, ordenada por urgencia en el servidor (cc_bandeja_unificada). Derecha: la
// conversación abierta, con asignar / reasignar / cartera y, en canales, tomar la conversación. En el celular la lista y la
// conversación se alternan. Enlace de contacto, horario y controles de la IA viven en "Canales y horario" (no son trabajo
// del día). La autoridad sigue en la base: aquí solo se muestran y se piden acciones.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Settings2, Search, ArrowLeft, RefreshCw, MessageCircle } from 'lucide-react'
import { atencion as clientePorDefecto, ETIQUETA_FUENTE, textoEstadoHorario, type BandejaUnificada, type ClienteAtencion, type FuenteConversacion, type GrupoBandeja, type ItemBandeja, type Pendientes, type Vendedor } from '../../data/ops/atencion'
import { chat as chatPorDefecto, type ClienteChat } from '../../data/ops/chat'
import { canalOperacion as canalOpPorDefecto, MOTIVO_NO_ESCRIBIR, type ClienteCanalOperacion, type ControlConversacion } from '../../data/ops/canalOperacion'
import { textoEspera, KINDS_COMERCIALES } from '../../data/ops/atencionComercial'
import { recargarAtencion } from '../../data/store/atencionStore'
import { onNuevaNotificacion } from '../../data/store/notificationsStore'
import { consumirIntento, useIntento } from '../../data/store/navIntentStore'
import { ChatCanonico } from '../chat/ChatCanonico'
import { PanelCliente } from '../chat/PanelCliente'
import { BarraTomaCanal, PanelOperativoCanal } from './CanalOperacion'
import { EnlaceContacto, EnlaceContactoBotones } from '../../app/EnlaceContacto'
import { MarcoModal, ModalCambiarCartera, ModalReasignarSolicitud, nombreSolicitud, PILL_FUENTE, SelectorVendedor } from './AtencionComercial'

type Vista = GrupoBandeja | 'todas'
const VISTAS: Array<{ k: Vista; label: string; ayuda: string }> = [
  { k: 'por_atender', label: 'Por atender', ayuda: 'Piden una persona o el cliente quedó sin respuesta.' },
  { k: 'en_atencion', label: 'En atención', ayuda: 'Un vendedor o Dirección ya la está atendiendo.' },
  { k: 'ia', label: 'IA', ayuda: 'La está resolviendo el asistente.' },
  { k: 'todas', label: 'Todas', ayuda: 'Todas las conversaciones abiertas de los últimos 30 días.' },
]
const FUENTES: FuenteConversacion[] = ['whatsapp', 'instagram', 'messenger', 'enlace', 'portal']
const CANALES_META = new Set<FuenteConversacion>(['whatsapp', 'instagram', 'messenger'])

export const hace = (min: number | null | undefined): string => {   // minutos del reloj del servidor
  if (min == null) return ''
  if (min < 1) return 'ahora'
  if (min < 60) return `${min} min`
  if (min < 48 * 60) return `${Math.round(min / 60)} h`
  return `${Math.round(min / 1440)} d`
}
export const telefono = (d: string | null | undefined): string | null => {
  if (!d) return null
  const m = /^\+?521?(\d{3})(\d{3})(\d{4})$/.exec(d)
  return m ? `+52 ${m[1]} ${m[2]} ${m[3]}` : d
}
/** Qué está pasando con la conversación, en una línea. */
export function estadoLinea(c: ItemBandeja): { texto: string; tono: 'dang' | 'warn' | 'ok' | 'neu' } {
  if (c.grupo === 'en_atencion') return { texto: `Atiende ${c.seller_nombre ?? 'Dirección'}`, tono: 'ok' }
  if (c.grupo === 'por_atender') {
    if (c.modo === 'human_assigned' || (c.modo === 'human_requested' && c.seller_id)) return { texto: `Asignada a ${c.seller_nombre ?? 'un vendedor'} · sin iniciar`, tono: 'warn' }
    if (c.modo === 'human_requested') return { texto: `Sin asesor${c.edad_min != null ? ` · esperando ${hace(c.edad_min)}` : ''}`, tono: 'dang' }
    return { texto: 'El cliente quedó sin respuesta', tono: 'dang' }
  }
  return { texto: 'IA atendiendo', tono: 'neu' }
}
const COLOR: Record<string, string> = { dang: 'var(--danger)', warn: 'var(--warn)', ok: 'var(--green-deep, var(--green))', neu: 'var(--ink-3)' }

export function BandejaConversaciones({ cliente = clientePorDefecto, chat = chatPorDefecto, canalOp = canalOpPorDefecto, onHorario, intervaloMs = 20_000 }: {
  cliente?: ClienteAtencion; chat?: ClienteChat; canalOp?: ClienteCanalOperacion; onHorario?: () => void; intervaloMs?: number
}) {
  const [datos, setDatos] = useState<BandejaUnificada | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('por_atender')
  const [fuente, setFuente] = useState<FuenteConversacion | 'todas'>('todas')
  const [busca, setBusca] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [ajustes, setAjustes] = useState(false)
  const intento = useIntento('av_atencion')

  const cargar = useCallback(async () => {
    const r = await cliente.bandeja()
    if (!r.ok) { setError(r.error); return null }
    setError(null); setDatos(r.data); return r.data
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { const t = setInterval(() => { void cargar() }, intervaloMs); return () => clearInterval(t) }, [cargar, intervaloMs])
  useEffect(() => onNuevaNotificacion((n) => { if (n.kind && KINDS_COMERCIALES.has(n.kind)) void cargar() }), [cargar])
  // Llegada desde Inicio / campana / alerta: abre esa conversación (Dirección puede abrir cualquiera)
  useEffect(() => {
    if (!intento) return
    consumirIntento(intento.id); setAbierta(intento.conversationId)
    const c = datos?.conversaciones.find((x) => x.conversation_id === intento.conversationId)
    if (c) setVista(c.grupo)
  }, [intento, datos])
  const alCambiar = useCallback(async () => { await cargar(); void recargarAtencion() }, [cargar])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (datos?.conversaciones ?? []).filter((c) =>
      (vista === 'todas' || c.grupo === vista) && (fuente === 'todas' || c.contacto?.fuente === fuente) &&
      (!q || [nombreSolicitud(c), c.contacto?.detalle, c.contacto?.ultimo_texto, c.seller_nombre].some((x) => (x ?? '').toLowerCase().includes(q))))
  }, [datos, vista, fuente, busca])
  const seleccion = datos?.conversaciones.find((c) => c.conversation_id === abierta) ?? null
  const n = datos?.resumen

  return (
    <div className="bq" data-testid="bandeja-unificada" data-abierta={abierta ? 'si' : 'no'}>
      <style>{CSS}</style>
      <div className="bq-head">
        <div className="eyebrow crumb" style={{ margin: 0 }}>Dirección · Conversaciones</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <EnlaceContactoBotones />
          <button type="button" className="btn ghost sm" onClick={() => void cargar()} aria-label="Actualizar" data-testid="bq-actualizar"><RefreshCw size={15} /></button>
          <button type="button" className="btn ghost sm" onClick={() => setAjustes(true)} data-testid="bq-ajustes"><Settings2 size={15} style={{ marginRight: 6 }} />Canales y horario</button>
        </div>
      </div>
      {error && <div role="alert" className="card" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      <div className="bq-cuerpo">
        <aside className="bq-lista card" aria-label="Conversaciones">
          <div className="bq-busca"><Search size={15} /><input placeholder="Buscar nombre, número o mensaje" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversación" data-testid="bq-busca" /></div>
          <div className="seg bq-vistas" role="tablist" aria-label="Qué conversaciones ver">
            {VISTAS.map((v) => (
              <button key={v.k} type="button" role="tab" aria-selected={vista === v.k} className={vista === v.k ? 'active' : undefined} onClick={() => setVista(v.k)} title={v.ayuda} data-testid={`bq-vista-${v.k}`}>
                {v.label}{n ? <span className={'bq-n' + (v.k === 'por_atender' && n.por_atender ? ' bq-n-alerta' : '')}>{n[v.k]}</span> : null}
              </button>
            ))}
          </div>
          <div className="bq-sub">
            <span>{VISTAS.find((v) => v.k === vista)?.ayuda}</span>
            <select value={fuente} onChange={(e) => setFuente(e.target.value as typeof fuente)} aria-label="Origen" data-testid="bq-fuente">
              <option value="todas">Todos los orígenes</option>
              {FUENTES.map((f) => <option key={f} value={f}>{ETIQUETA_FUENTE[f]}</option>)}
            </select>
          </div>
          {datos == null && !error && <div className="bq-vacio">Cargando…</div>}
          {datos && lista.length === 0 && <div className="bq-vacio" data-testid="bq-vacio">{vista === 'por_atender' ? 'Nada pendiente. Buen trabajo.' : 'No hay conversaciones aquí.'}</div>}
          <ul className="bq-items">
            {lista.map((c) => {
              const e = estadoLinea(c)
              return (
                <li key={c.conversation_id}>
                  <button type="button" className={'bq-item' + (abierta === c.conversation_id ? ' sel' : '')} onClick={() => setAbierta(c.conversation_id)} data-testid="bq-item">
                    <div className="bq-l1">
                      <b className="bq-nombre">{nombreSolicitud(c).replace(/ · sin cuenta$/, '')}</b>
                      <span className="bq-hora">{hace(c.hace_min)}</span>
                    </div>
                    <div className="bq-l2">
                      {c.contacto && <span className={'pill ' + PILL_FUENTE[c.contacto.fuente]} data-testid="bq-fuente-pill">{ETIQUETA_FUENTE[c.contacto.fuente]}</span>}
                      <span className="bq-texto">{c.contacto?.ultimo_texto ? `«${c.contacto.ultimo_texto}»` : ''}</span>
                    </div>
                    <div className="bq-l3" style={{ color: COLOR[e.tono] }} data-testid="bq-estado">{e.tono === 'dang' && <span className="bq-punto" />}{e.texto}</div>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>
        <section className="bq-panel card" aria-label="Conversación abierta">
          {abierta
            ? <Panel key={abierta} id={abierta} c={seleccion} cliente={cliente} chat={chat} canalOp={canalOp} onCambio={alCambiar} onCerrar={() => setAbierta(null)} />
            : <div className="bq-vacio bq-elige"><span className="bq-elige-ico"><MessageCircle size={28} /></span><b>Conversaciones de clientes</b><span>Elige una conversación de la lista para leerla y atenderla.</span></div>}
        </section>
      </div>
      {ajustes && <ModalAjustes cliente={cliente} canalOp={canalOp} onHorario={onHorario} onCerrar={() => setAjustes(false)} onAbrir={(id) => { setAjustes(false); setAbierta(id) }} />}
    </div>
  )
}

function Panel({ id, c, cliente, chat, canalOp, onCambio, onCerrar }: { id: string; c: ItemBandeja | null; cliente: ClienteAtencion; chat: ClienteChat; canalOp: ClienteCanalOperacion; onCambio: () => void; onCerrar: () => void }) {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [sel, setSel] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [modal, setModal] = useState<'solicitud' | 'cartera' | null>(null)
  const [control, setControl] = useState<ControlConversacion | null>(null)
  useEffect(() => { void cliente.vendedores().then((r) => { if (r.ok) setVendedores(r.data) }) }, [cliente])
  const canal = !!c?.contacto && CANALES_META.has(c.contacto.fuente)
  const nombre = c ? nombreSolicitud(c) : 'Conversación'
  const sinAsesor = !!c && !c.seller_id && c.grupo !== 'en_atencion'
  const reasignable = !!c && (c.modo === 'human_requested' || c.modo === 'human_assigned')
  const asignar = async () => {
    if (!c || !sel) return
    setMsg(null)
    const r = c.profile_id
      ? await cliente.asignar(c.profile_id, sel, null)
      : await chat.asignar(c.conversation_id, sel).then((x) => (x.ok ? { ok: true as const, data: x.data } : { ok: false as const, error: x.error.mensaje }))
    if (!r.ok) { setMsg({ ok: false, texto: r.error }); return }
    setMsg({ ok: true, texto: `Asignada a ${vendedores.find((v) => v.id === sel)?.nombre ?? 'el vendedor'}.` }); setSel(''); onCambio()
  }
  const bloqueo = canal ? (control ? (control.canal && !control.puede_escribir ? (MOTIVO_NO_ESCRIBIR[control.motivo_no_escribir ?? ''] ?? 'Solo lectura.') : null) : 'Comprobando quién atiende…') : null
  const e = c ? estadoLinea(c) : null
  return (
    <div className="bq-conv" data-testid="bq-panel">
      <div className="bq-conv-head">
        <button type="button" className="btn ghost sm bq-volver" onClick={onCerrar} aria-label="Volver a la lista" data-testid="bq-volver"><ArrowLeft size={16} /></button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="bq-l1" style={{ gap: 8, justifyContent: 'flex-start' }}>
            {c?.contacto && <span className={'pill ' + PILL_FUENTE[c.contacto.fuente]}>{ETIQUETA_FUENTE[c.contacto.fuente]}</span>}
            <b style={{ fontSize: 16 }} data-testid="bq-panel-nombre">{nombre}</b>
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {[telefono(c?.contacto?.detalle), e?.texto, c && c.atencion ? textoEspera(c.atencion) : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      {c && (sinAsesor || reasignable || (c.profile_id && c.seller_id)) && (
        <div className="bq-acciones" data-testid="bq-acciones">
          {sinAsesor && <>
            <SelectorVendedor vendedores={vendedores} nuevos={!!c.profile_id} valor={sel} onCambio={setSel} etiqueta={c.profile_id ? 'Vendedor de cartera' : 'Vendedor para esta conversación'} />
            <button type="button" className="btn btn-primary" disabled={!sel} onClick={() => void asignar()} data-testid="bq-asignar">{c.profile_id ? 'Asignar a su cartera' : 'Asignar'}</button>
          </>}
          {reasignable && c.seller_id && <button type="button" className="btn" onClick={() => setModal('solicitud')} data-testid="bq-reasignar">Reasignar</button>}
          {c.profile_id && c.seller_id && <button type="button" className="btn ghost" onClick={() => setModal('cartera')} data-testid="bq-cartera">Cambiar vendedor de cartera</button>}
        </div>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--green-deep)' : 'var(--danger)' }} data-testid="bq-msg">{msg.texto}</div>}
      {canal && <BarraTomaCanal conversationId={id} cliente={canalOp} onControl={setControl} />}
      {/* VINCULAR-CLIENTE · ¿quién es? ficha, sugerencias y acceso al portal. */}
      {c && !c.profile_id && <PanelCliente conversationId={id} chat={chat} onCambio={onCambio} />}
      <div className="bq-chat">
        <ChatCanonico embebido asesor puedeEmpresa conversationId={id} cliente={chat} nombreCliente={nombre} bloqueoEscritura={bloqueo}
          etiquetaSalir="Cerrar" onSalir={onCerrar} onFin={() => { onCambio(); onCerrar() }} />
      </div>
      {modal === 'solicitud' && c && <ModalReasignarSolicitud p={c} vendedores={vendedores} carteraNombre={null} cliente={cliente} onCerrar={() => setModal(null)}
        onHecho={(texto) => { setModal(null); setMsg({ ok: true, texto }); onCambio() }} nombreVendedor={(v) => vendedores.find((x) => x.id === v)?.nombre ?? null} />}
      {modal === 'cartera' && c?.profile_id && <ModalCambiarCartera p={c} vendedores={vendedores} carteraNombre={c.seller_nombre} cliente={cliente} onCerrar={() => setModal(null)}
        onHecho={(texto) => { setModal(null); setMsg({ ok: true, texto }); onCambio() }} />}
    </div>
  )
}

function ModalAjustes({ cliente, canalOp, onHorario, onCerrar, onAbrir }: { cliente: ClienteAtencion; canalOp: ClienteCanalOperacion; onHorario?: () => void; onCerrar: () => void; onAbrir: (id: string) => void }) {
  const [pend, setPend] = useState<Pendientes | null>(null)
  useEffect(() => { void cliente.pendientes().then((r) => { if (r.ok) setPend(r.data) }) }, [cliente])
  const r = pend?.resumen
  return (
    <MarcoModal testid="bq-modal-ajustes" titulo="Canales y horario" sub="Enlace de contacto, horario de atención y controles de la IA" onCerrar={onCerrar}>
      <EnlaceContacto />
      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 600 }} data-testid="bq-horario">{textoEstadoHorario(r?.horario)}</div>
          {r && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{r.vendedores_elegibles} {r.vendedores_elegibles === 1 ? 'vendedor recibe' : 'vendedores reciben'} conversaciones</div>}
        </div>
        {onHorario && <button type="button" className="btn ghost" onClick={() => { onCerrar(); onHorario() }}>Horario y alertas</button>}
      </div>
      <PanelOperativoCanal cliente={canalOp} canal="whatsapp" onAbrir={onAbrir} />
    </MarcoModal>
  )
}

// Estilos de la bandeja: dos paneles en escritorio; en el celular, lista O conversación.
const CSS = `
.bq { display: grid; gap: 12px; min-width: 0; }
.bq-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.bq-cuerpo { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 12px; align-items: start; min-width: 0; }
.bq-lista { padding: 10px !important; display: grid; gap: 8px; max-height: calc(100vh - 170px); overflow: auto; position: sticky; top: 12px; }
.bq-busca { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 12px; padding: 0 10px; color: var(--ink-3); background: var(--cp-surface, #fff); }
.bq-busca input { border: 0; outline: none; flex: 1; min-height: 40px; font: inherit; font-size: 14px; background: transparent; color: var(--ink); }
.bq-vistas { flex-wrap: nowrap; width: 100%; }
.bq-vistas button { display: inline-flex; gap: 5px; align-items: center; justify-content: center; flex: 1; padding: 8px 6px; }
.bq-n { font-size: 11.5px; padding: 0 6px; border-radius: 10px; background: var(--line); color: var(--ink-2); min-width: 18px; text-align: center; }
.bq-n-alerta { background: var(--danger); color: #fff; }
.bq-sub { display: flex; gap: 8px; align-items: center; justify-content: space-between; font-size: 12px; color: var(--ink-3); flex-wrap: wrap; }
.bq-sub select { padding: 6px 8px; border-radius: 10px; border: 1px solid var(--line); font: inherit; font-size: 12.5px; min-height: 34px; background: var(--cp-surface, #fff); }
.bq-items { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.bq-item { width: 100%; text-align: left; background: transparent; border: 0; border-radius: 10px; padding: 10px; display: grid; gap: 3px; cursor: pointer; color: inherit; font: inherit; }
.bq-item:hover { background: var(--cp-hover, rgba(0,0,0,.04)); }
.bq-item.sel { background: var(--green-bg, rgba(46,125,50,.10)); }
.bq-l1 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; min-width: 0; }
.bq-nombre { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bq-hora { font-size: 12px; color: var(--ink-3); flex-shrink: 0; }
.bq-l2 { display: flex; gap: 6px; align-items: center; min-width: 0; }
.bq-texto { font-size: 13px; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.bq-l3 { font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
.bq-punto { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); display: inline-block; }
.bq-vacio { color: var(--ink-3); font-size: 13.5px; padding: 16px 8px; text-align: center; }
.bq-elige { display: grid; place-content: center; justify-items: center; gap: 8px; min-height: calc(100vh - 230px); border-radius: var(--r); background-color: #e9ede7;
  background-image: radial-gradient(rgba(0,90,13,.055) 1.1px, transparent 1.2px), radial-gradient(rgba(0,90,13,.04) 1px, transparent 1.1px); background-size: 22px 22px, 22px 22px; background-position: 0 0, 11px 11px; }
.bq-elige b { font-size: 17px; font-weight: 600; color: var(--ink); }
.bq-elige-ico { width: 60px; height: 60px; border-radius: 50%; display: grid; place-items: center; background: #fff; color: var(--green-deep); box-shadow: 0 1px 3px rgba(11,20,14,.12); }
.bq-panel { padding: 12px !important; min-width: 0; }
.bq-conv { display: grid; gap: 10px; min-width: 0; }
.bq-conv-head { display: flex; gap: 8px; align-items: flex-start; }
.bq-volver { display: none; }
.bq-acciones { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.bq-acciones .btn, .bq-acciones select { min-height: 40px; }
.bq-chat { min-width: 0; }
@media (max-width: 900px) {
  .bq-cuerpo { grid-template-columns: minmax(0, 1fr); }
  .bq-lista { position: static; max-height: none; }
  .bq[data-abierta="si"] .bq-lista { display: none; }
  .bq[data-abierta="no"] .bq-panel { display: none; }
  .bq-volver { display: inline-flex; }
}
`
