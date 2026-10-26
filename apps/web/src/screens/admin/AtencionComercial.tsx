// CC-7 → CHV2-B · DIRECCIÓN · Atención comercial: consola de RUTEO y SUPERVISIÓN (no es otro chat).
//   · Solicitudes: cada solicitud de asesor con cliente, vendedor de CARTERA, quién la atiende AHORA
//     (handler), estado de atención, antigüedad, espera del asesor actual en minutos hábiles, horario e
//     IA — todo derivado por el servidor (_cc_atencion). Acciones: Abrir (en Conversaciones),
//     REASIGNAR ESTA SOLICITUD (cc_solicitud_reasignar: solo el handler, motivo obligatorio, la cartera
//     no cambia) y, aparte y explícito, CAMBIAR VENDEDOR DE CARTERA (cc_cartera_asignar: permanente).
//   · Cartera: clientes con/sin vendedor y reasignaciones requeridas (historial auditado en el servidor).
//   · Vendedores: quién es elegible (los permisos se cambian en Equipo).
//   · Horario y alertas: horario semanal/excepciones (CC-7) y umbrales de aviso/escalamiento (CHV2-A).
// La autoridad es la base: valida Dirección, elegibilidad y motivo; nada se asigna al azar.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { capitalizarNombre } from '../../lib/nombres'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { atencion as clientePorDefecto, MOTIVO_RUTEO, textoEstadoHorario, type BandejaCanales, type CanalBandeja, type ChatCanal, type ClienteAtencion, type ClienteCartera, type Pendientes, type PendienteRuteo, type Vendedor } from '../../data/ops/atencion'
import { chat as chatPorDefecto, ETIQUETA_MODO, type ClienteChat, type ModoConversacion } from '../../data/ops/chat'
import { ETIQUETA_ATENCION, estadoDe, formatoMinutos, textoEspera, textoIA, tonoAtencion, KINDS_COMERCIALES } from '../../data/ops/atencionComercial'
import { recargarAtencion } from '../../data/store/atencionStore'
import { onNuevaNotificacion } from '../../data/store/notificationsStore'
import { consumirIntento, irAConversacion, useIntento } from '../../data/store/navIntentStore'
import { HorarioYAlertas } from './HorarioAtencion'
import { useRole } from '../../auth/RoleContext'
import { EnlaceContacto } from '../../app/EnlaceContacto'
import { ChatCanonico } from '../chat/ChatCanonico'
import { BarraTomaCanal, PanelOperativoCanal } from './CanalOperacion'   // R4-B2-4 · panel operativo mínimo
import { canalOperacion as canalOpPorDefecto, MOTIVO_NO_ESCRIBIR, type ClienteCanalOperacion, type ControlConversacion } from '../../data/ops/canalOperacion'

type Pestana = 'pendientes' | 'cartera' | 'vendedores' | 'horario' | 'whatsapp'
const PILL: Record<string, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu', ok: 'p-ok' }
const campo: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontFamily: 'inherit', fontSize: 13.5, minHeight: 40 }

// Pestaña inicial pedida desde otra pantalla (p. ej. Inicio → "Configurar horario").
let pestanaPedida: Pestana | null = null
export function abrirPestanaAtencion(p: 'horario' | 'cartera' | 'vendedores' | 'solicitudes' | 'whatsapp') { pestanaPedida = p === 'solicitudes' ? 'pendientes' : p }
// REORG CRM · la consola se parte en dos pantallas: Conversaciones → Bandeja (solicitudes y WhatsApp, key 'av_atencion')
// y Equipo → Cartera y horario (cartera, vendedores, horario, key 'av_cartera'). Quien abre una pestaña a fondo usa esto.
export const pantallaDeAtencion = (p: 'horario' | 'cartera' | 'vendedores' | 'solicitudes' | 'whatsapp'): 'av_atencion' | 'av_cartera' => (p === 'solicitudes' || p === 'whatsapp' ? 'av_atencion' : 'av_cartera')
const PESTANAS_BANDEJA: Pestana[] = ['pendientes', 'whatsapp']
const PESTANAS_CARTERA: Pestana[] = ['cartera', 'vendedores', 'horario']
const ETIQUETA: Record<Pestana, string> = { pendientes: 'Solicitudes', whatsapp: 'Canales', cartera: 'Cartera', vendedores: 'Vendedores', horario: 'Horario y alertas' }   // 'whatsapp' = WhatsApp + Instagram + Messenger

export function AtencionComercial({ cliente = clientePorDefecto, chat = chatPorDefecto, canalOp = canalOpPorDefecto, onEquipo, onAbrir, pestanas = PESTANAS_BANDEJA, titulo = 'Dirección · Conversaciones · Bandeja', onHorario }: {
  cliente?: ClienteAtencion; chat?: ClienteChat; canalOp?: ClienteCanalOperacion; onEquipo?: () => void; onAbrir?: (conversationId: string) => void
  pestanas?: Pestana[]; titulo?: string; onHorario?: () => void   // onHorario: desde la Bandeja, el horario vive en Cartera y horario
}) {
  const [pestana, setPestana] = useState<Pestana>(() => { const p = pestanaPedida && pestanas.includes(pestanaPedida) ? pestanaPedida : pestanas[0]; if (pestanaPedida && pestanas.includes(pestanaPedida)) pestanaPedida = null; return p })
  const irHorario = () => { if (pestanas.includes('horario')) setPestana('horario'); else onHorario?.() }
  const [pend, setPend] = useState<Pendientes | null>(null)
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [error, setError] = useState<string | null>(null)
  const intento = useIntento('av_atencion')
  const [foco, setFoco] = useState<{ id: string; reasignar: boolean } | null>(null)

  const cargar = useCallback(async () => {
    const [p, v] = await Promise.all([cliente.pendientes(), cliente.vendedores()])
    if (!p.ok) { setError(p.error); return }
    setError(null); setPend(p.data); if (v.ok) setVendedores(v.data)
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  // Aviso comercial en vivo = señal: se relee la verdad del servidor.
  useEffect(() => onNuevaNotificacion((n) => { if (n.kind && KINDS_COMERCIALES.has(n.kind)) void cargar() }), [cargar])
  // Llegada desde Inicio / alerta / campana: solo un id; se muestra si el servidor lo devuelve.
  useEffect(() => {
    if (!intento) return
    if (!pestanas.includes('pendientes')) return
    setPestana('pendientes'); setFoco({ id: intento.conversationId, reasignar: !!intento.reasignar }); consumirIntento(intento.id)
  }, [intento])
  const alCambiar = useCallback(async () => { await cargar(); void recargarAtencion() }, [cargar])

  const r = pend?.resumen
  return (
    <div className="grid" style={{ gap: 14, maxWidth: 1040, minWidth: 0 }} data-testid="atencion-comercial">
      <div className="eyebrow" style={{ margin: 0 }}>{titulo}</div>
      {pestanas.includes('pendientes') && <EnlaceContacto />}
      <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 600 }} data-testid="estado-horario">{textoEstadoHorario(r?.horario)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {r && !r.horario.configurado ? 'Sin horario no se miden minutos hábiles: los avisos y escalamientos por espera están en pausa.' : 'El servidor mide la espera del asesor en minutos hábiles con este horario.'}
          </div>
        </div>
        <button type="button" className="btn ghost" onClick={irHorario} style={{ minHeight: 40 }}>{r?.horario.configurado ? 'Horario y alertas' : 'Configurar horario'}</button>
        {r && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={'pill ' + (r.handoffs_sin_asignar ? 'p-warn' : 'p-neu')} data-testid="n-sin-asignar">{r.handoffs_sin_asignar} sin vendedor</span>
            <span className={'pill ' + (r.reasignacion ? 'p-warn' : 'p-neu')}>{r.reasignacion} por reasignar</span>
            <span className={'pill ' + (r.handoffs_pendientes ? 'p-dang' : 'p-neu')}>{r.handoffs_pendientes} sin rutear</span>
            <span className="pill p-neu">{r.vendedores_elegibles} vendedor(es) elegible(s)</span>
          </div>
        )}
      </div>
      {error && <div role="alert" className="card" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} role="tablist" aria-label="Secciones de atención comercial">
        {pestanas.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={pestana === k} className={pestana === k ? 'active' : undefined} onClick={() => setPestana(k)}>{ETIQUETA[k]}</button>
        ))}
      </div>
      {pestana === 'pendientes' && pend && <PestanaPendientes pend={pend} vendedores={vendedores} cliente={cliente} chat={chat} onCambio={alCambiar} foco={foco} onFocoUsado={() => setFoco(null)} onAbrir={onAbrir} />}
      {pestana === 'cartera' && <PestanaCartera vendedores={vendedores} cliente={cliente} onCambio={alCambiar} />}
      {pestana === 'vendedores' && <PestanaVendedores vendedores={vendedores} onEquipo={onEquipo} />}
      {pestana === 'horario' && <HorarioYAlertas cliente={cliente} onCambio={alCambiar} />}
      {pestana === 'whatsapp' && <PestanaWhatsApp cliente={cliente} chat={chat} canalOp={canalOp} />}
    </div>
  )
}

function SelectorVendedor({ vendedores, nuevos, valor, onCambio, etiqueta = 'Vendedor' }: { vendedores: Vendedor[]; nuevos: boolean; valor: string; onCambio: (v: string) => void; etiqueta?: string }) {
  const opciones = vendedores.filter((v) => (nuevos ? v.elegible_nuevos : v.elegible))
  return (
    <select value={valor} onChange={(e) => onCambio(e.target.value)} style={campo} aria-label={etiqueta}>
      <option value="">{opciones.length ? 'Elige vendedor…' : 'Sin vendedores elegibles'}</option>
      {opciones.map((v) => <option key={v.id} value={v.id}>{v.nombre}{v.clientes ? ` · ${v.clientes} cliente(s)` : ''}</option>)}
    </select>
  )
}

type Modal = { tipo: 'solicitud' | 'cartera'; p: PendienteRuteo } | null

function PestanaPendientes({ pend, vendedores, cliente, chat, onCambio, foco, onFocoUsado, onAbrir }: { pend: Pendientes; vendedores: Vendedor[]; cliente: ClienteAtencion; chat: ClienteChat; onCambio: () => void; foco: { id: string; reasignar: boolean } | null; onFocoUsado: () => void; onAbrir?: (id: string) => void }) {
  const [sel, setSel] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [cartera, setCartera] = useState<Record<string, string | null>>({})
  const [destacada, setDestacada] = useState<string | null>(null)
  const [noDisponible, setNoDisponible] = useState(false)
  const filas = useRef<Record<string, HTMLLIElement | null>>({})

  // Vendedor de CARTERA por cliente (lectura de Dirección ya existente; la consola lo muestra al lado del handler).
  useEffect(() => {
    let vivo = true
    void cliente.cartera('todos').then((x) => { if (vivo && x.ok) setCartera(Object.fromEntries((x.data ?? []).map((f: ClienteCartera) => [f.profile_id, f.vendedor_nombre]))) })
    return () => { vivo = false }
  }, [cliente, pend])

  useEffect(() => {
    if (!foco) return
    const p = pend.conversaciones.find((c) => c.conversation_id === foco.id)
    if (!p) { setNoDisponible(true); onFocoUsado(); return }
    setNoDisponible(false); setDestacada(p.conversation_id)
    window.setTimeout(() => { const el = filas.current[p.conversation_id]; el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el?.focus() }, 0)
    if (foco.reasignar && (p.modo === 'human_requested' || p.modo === 'human_assigned')) setModal({ tipo: 'solicitud', p })
    onFocoUsado()
  }, [foco, pend, onFocoUsado])

  const asignarCartera = async (p: PendienteRuteo) => {
    const v = sel[p.conversation_id]; if (!v) return
    setMsg(null)
    const r = p.profile_id
      ? await cliente.asignar(p.profile_id, v, null)   // doctor sin vendedor: queda en su CARTERA (compras futuras)
      : await chat.asignar(p.conversation_id, v).then((x) => (x.ok ? { ok: true as const, data: x.data } : { ok: false as const, error: x.error.mensaje }))   // visitante: solo esta conversación
    if (!r.ok) setMsg({ ok: false, texto: r.error }); else onCambio()
  }
  const items = pend.conversaciones
  const nombreVendedor = (id: string | null | undefined) => vendedores.find((v) => v.id === id)?.nombre ?? null
  return (
    <div className="card">
      {noDisponible && <div className="rc-aviso-nav" role="status" data-testid="solicitud-no-disponible">Esa solicitud ya no requiere intervención (se atendió o se cerró).</div>}
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ marginBottom: 10, color: msg.ok ? 'var(--green-deep)' : 'var(--danger)' }} data-testid="msg-atencion">{msg.texto}</div>}
      {items.length === 0 && <div style={{ color: 'var(--ink-3)' }}>No hay conversaciones con atención humana pedida.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {items.map((p) => {
          const necesita = !p.seller_id
          const e = estadoDe(p)
          const tono = tonoAtencion(e)
          const reasignable = p.modo === 'human_requested' || p.modo === 'human_assigned'
          const carteraNombre = p.profile_id ? (cartera[p.profile_id] ?? null) : null
          const ia = textoIA(p.atencion, p.modo as ModoConversacion)
          return (
            <li key={p.conversation_id} ref={(el) => { filas.current[p.conversation_id] = el }} tabIndex={-1}
              className={destacada === p.conversation_id ? 'rc-llegada' : undefined}
              style={{ border: '1px solid var(--line)', borderLeft: `4px solid var(--${tono === 'dang' ? 'danger' : tono === 'warn' ? 'warn' : tono === 'ok' ? 'green' : 'line'})`, borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 8, outline: 'none' }} data-testid="pendiente">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 15 }}>{capitalizarNombre(p.nombre)}{p.dueno === 'visitante' ? ' (visitante)' : ''}</b>
                {e ? <span className={'pill ' + PILL[tono]} data-testid="estado-atencion">{ETIQUETA_ATENCION[e]}</span> : <span className="pill p-neu">{p.iniciada ? 'Asesoría iniciada' : ETIQUETA_MODO[p.modo as ModoConversacion] ?? p.modo}</span>}
                {p.origen === 'carrito' && <span className="pill p-neu">Carrito{p.n_items ? ` · ${p.n_items}` : ''}</span>}
                {p.fuera_horario && <span className="pill p-warn">Llegó fuera de horario</span>}
                {p.ruteo_motivo && <span className="pill p-warn">{MOTIVO_RUTEO[p.ruteo_motivo] ?? p.ruteo_motivo}</span>}
              </div>
              <dl className="ac-datos" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,190px),1fr))', gap: '4px 16px', margin: 0, fontSize: 13 }}>
                <Dato t="Vendedor de cartera" v={p.dueno === 'visitante' ? 'Visitante · sin cartera' : carteraNombre ?? 'Sin vendedor de cartera'} testid="dato-cartera" />
                <Dato t="Atiende esta solicitud" v={p.seller_nombre ?? 'Nadie todavía'} testid="dato-handler" />
                <Dato t="Solicitada" v={p.edad_min != null ? `hace ${formatoMinutos(p.edad_min)}` : '—'} />
                <Dato t="Espera del asesor actual" v={textoEspera(p.atencion) ?? (p.modo === 'human_active' ? 'Asesoría en curso' : '—')} testid="dato-espera" />
                <Dato t="Asistente" v={ia ?? (p.modo === 'human_active' ? 'En pausa: atiende una persona' : 'No activo')} testid="dato-ia" />
              </dl>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {necesita && (
                  <>
                    <SelectorVendedor vendedores={vendedores} nuevos={!!p.profile_id} valor={sel[p.conversation_id] ?? ''} onCambio={(v) => setSel((s) => ({ ...s, [p.conversation_id]: v }))} etiqueta={p.profile_id ? 'Vendedor de cartera' : 'Vendedor para esta conversación'} />
                    <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} disabled={!sel[p.conversation_id]} onClick={() => asignarCartera(p)} data-testid="btn-asignar-pendiente">{p.profile_id ? 'Asignar a su cartera' : 'Asignar conversación'}</button>
                  </>
                )}
                <button type="button" className="btn ghost" style={{ minHeight: 40 }} onClick={() => onAbrir?.(p.conversation_id)} data-testid="btn-abrir">Abrir</button>
                {reasignable && <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => setModal({ tipo: 'solicitud', p })} data-testid="btn-reasignar-solicitud">{p.seller_id ? 'Reasignar esta solicitud' : 'Asignar solo esta solicitud'}</button>}
                {p.profile_id && !necesita && <button type="button" className="btn ghost" style={{ minHeight: 40 }} onClick={() => setModal({ tipo: 'cartera', p })} data-testid="btn-cambiar-cartera">Cambiar vendedor de cartera</button>}
              </div>
            </li>
          )
        })}
      </ul>
      {pend.carritos_pendientes.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--warn)' }} data-testid="carritos-pendientes">
          {pend.carritos_pendientes.length} carrito(s) activaron atención humana pero el ruteo no se completó; se reintenta solo cuando el cliente vuelve al chat. Su compra no se vio afectada.
        </div>
      )}
      {modal?.tipo === 'solicitud' && (
        <ModalReasignarSolicitud p={modal.p} vendedores={vendedores} carteraNombre={modal.p.profile_id ? cartera[modal.p.profile_id] ?? null : null} cliente={cliente}
          onCerrar={() => setModal(null)}
          onHecho={(texto) => { setModal(null); setMsg({ ok: true, texto }); onCambio() }} nombreVendedor={nombreVendedor} />
      )}
      {modal?.tipo === 'cartera' && modal.p.profile_id && (
        <ModalCambiarCartera p={modal.p} vendedores={vendedores} carteraNombre={cartera[modal.p.profile_id] ?? null} cliente={cliente}
          onCerrar={() => setModal(null)} onHecho={(texto) => { setModal(null); setMsg({ ok: true, texto }); onCambio() }} />
      )}
    </div>
  )
}

function Dato({ t, v, testid }: { t: string; v: string; testid?: string }) {
  return <div style={{ minWidth: 0 }}><dt style={{ color: 'var(--mid)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }} data-testid={testid}>{v}</dd></div>
}

function MarcoModal({ titulo, sub, onCerrar, children, testid }: { titulo: string; sub: string; onCerrar: () => void; children: React.ReactNode; testid: string }) {
  const caja = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    caja.current?.querySelector<HTMLElement>('select, textarea, button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previo?.focus?.() }
  }, [onCerrar])
  // Portal al body: una .card animada (transform) atraparía el overlay position:fixed dentro de la tarjeta.
  return createPortal(
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${testid}-t`} onClick={(e) => e.stopPropagation()} data-testid={testid} ref={caja}>
        <div className="mhead">
          <div><h3 id={`${testid}-t`}>{titulo}</h3><div className="ms">{sub}</div></div>
          <button className="mclose" type="button" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="mbody" style={{ display: 'grid', gap: 12 }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** CHV2-A · Solo esta solicitud: cambia quién atiende AHORA. La cartera NO cambia. Motivo obligatorio. */
function ModalReasignarSolicitud({ p, vendedores, carteraNombre, cliente, onCerrar, onHecho, nombreVendedor }: { p: PendienteRuteo; vendedores: Vendedor[]; carteraNombre: string | null; cliente: ClienteAtencion; onCerrar: () => void; onHecho: (texto: string) => void; nombreVendedor: (id: string | null | undefined) => string | null }) {
  const [v, setV] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const opciones = vendedores.filter((x) => x.elegible && x.id !== p.seller_id)
  const enviar = async () => {
    if (!v || !motivo.trim()) return
    setOcupado(true); setError(null)
    const r = await cliente.reasignarSolicitud(p.conversation_id, v, motivo.trim())
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    const quien = nombreVendedor(v) ?? 'el vendedor elegido'
    const cart = nombreVendedor(r.data.cartera_vendedor) ?? carteraNombre
    onHecho(`Ahora ${quien} atiende esta solicitud. ${p.profile_id ? `La cartera no cambió${cart ? `: sigue con ${cart}` : ' (el cliente sigue sin vendedor de cartera)'}.` : 'Es un visitante: no tiene cartera.'}`)
  }
  return (
    <MarcoModal testid="modal-reasignar-solicitud" titulo={p.seller_id ? 'Reasignar esta solicitud' : 'Asignar solo esta solicitud'} sub={capitalizarNombre(p.nombre)} onCerrar={onCerrar}>
      <div className="rh-note rh-note--neu" data-testid="explica-solicitud">
        <span>Solo cambia <b>quién atiende esta solicitud</b>. <b>La cartera del cliente no cambia</b>{p.profile_id ? (carteraNombre ? ` (sigue con ${carteraNombre})` : ' (sigue sin vendedor de cartera)') : ''}. Para un cambio permanente usa “Cambiar vendedor de cartera”.</span>
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Pasar a
        <select value={v} onChange={(e) => setV(e.target.value)} style={campo} aria-label="Vendedor que atenderá esta solicitud" data-testid="sel-handler">
          <option value="">{opciones.length ? 'Elige vendedor…' : 'Sin vendedores elegibles'}</option>
          {opciones.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Motivo (obligatorio)
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} rows={2} style={{ ...campo, resize: 'vertical' }} placeholder="Ej. Lucía está en junta; Ana cubre esta solicitud" data-testid="motivo-handler" />
      </label>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={!v || !motivo.trim() || ocupado} onClick={enviar} data-testid="btn-confirmar-reasignacion">{p.seller_id ? 'Reasignar solicitud' : 'Asignar solicitud'}</button>
      </div>
    </MarcoModal>
  )
}

/** Cambio PERMANENTE de cartera (cc_cartera_asignar): compras futuras + reruteo de la solicitud abierta. */
function ModalCambiarCartera({ p, vendedores, carteraNombre, cliente, onCerrar, onHecho }: { p: PendienteRuteo; vendedores: Vendedor[]; carteraNombre: string | null; cliente: ClienteAtencion; onCerrar: () => void; onHecho: (texto: string) => void }) {
  const [v, setV] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const requiereMotivo = !!carteraNombre
  const enviar = async () => {
    if (!v || (requiereMotivo && !motivo.trim()) || !p.profile_id) return
    setOcupado(true); setError(null)
    const r = await cliente.asignar(p.profile_id, v, motivo.trim() || null)
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    onHecho(`Cartera actualizada: ${vendedores.find((x) => x.id === v)?.nombre ?? 'el vendedor elegido'} atenderá las compras futuras de ${p.nombre}.`)
  }
  return (
    <MarcoModal testid="modal-cambiar-cartera" titulo="Cambiar vendedor de cartera" sub={capitalizarNombre(p.nombre)} onCerrar={onCerrar}>
      <div className="rh-note rh-note--warn" data-testid="explica-cartera-permanente">
        <span><b>Cambio permanente.</b> El nuevo vendedor atenderá las compras futuras de este cliente{carteraNombre ? ` (hoy: ${carteraNombre})` : ''}. Una solicitud que aún espera se le pasa también; una asesoría en curso no se interrumpe.</span>
      </div>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Nuevo vendedor de cartera
        <SelectorVendedor vendedores={vendedores} nuevos valor={v} onCambio={setV} etiqueta="Nuevo vendedor de cartera" />
      </label>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Motivo{requiereMotivo ? ' (obligatorio)' : ' (opcional)'}
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} rows={2} style={{ ...campo, resize: 'vertical' }} data-testid="motivo-cartera" />
      </label>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={!v || (requiereMotivo && !motivo.trim()) || ocupado} onClick={enviar} data-testid="btn-confirmar-cartera">Cambiar cartera</button>
      </div>
    </MarcoModal>
  )
}

function PestanaCartera({ vendedores, cliente, onCambio }: { vendedores: Vendedor[]; cliente: ClienteAtencion; onCambio: () => void }) {
  const [filtro, setFiltro] = useState<'todos' | 'sin_vendedor' | 'reasignacion'>('todos')
  const [filas, setFilas] = useState<ClienteCartera[]>([])
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Record<string, string>>({})
  const [motivo, setMotivo] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cliente.cartera(filtro); if (r.ok) setFilas(r.data); else setMsg(r.error) }, [cliente, filtro])
  useEffect(() => { void cargar() }, [cargar])
  const visibles = useMemo(() => filas.filter((f) => !busca.trim() || f.nombre.toLowerCase().includes(busca.trim().toLowerCase())), [filas, busca])
  const guardar = async (f: ClienteCartera) => {
    const v = sel[f.profile_id] ?? ''; setMsg(null)
    const r = await cliente.asignar(f.profile_id, v || null, motivo[f.profile_id] || null)
    if (!r.ok) { setMsg(r.error); return }
    await cargar(); onCambio()
  }
  return (
    <div className="card">
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }} data-testid="explica-cartera">
        <b>La cartera es permanente:</b> define qué vendedor atiende las compras futuras del cliente. Para pasar SOLO una solicitud a otra persona usa <b>Reasignar esta solicitud</b> en Solicitudes.
        <div style={{ marginTop: 6 }} data-testid="cartera-cualquier-cliente">Aquí aparecen los doctores con cuenta. A <b>cualquier cliente</b> (tenga o no cuenta) le asignas vendedor desde <b>Clientes</b> → su ficha → pestaña <b>Comercial</b>.</div>
      </div>
      <div className="filters" style={{ marginBottom: 10 }}>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} style={{ padding: '8px 11px', borderRadius: 14, border: '1px solid var(--line)', fontFamily: 'inherit', fontSize: 13, backgroundColor: 'var(--cp-surface)' }} aria-label="Filtro">
          <option value="sin_vendedor">Sin vendedor</option><option value="reasignacion">Requieren reasignación</option><option value="todos">Todos</option>
        </select>
        <input placeholder="Buscar cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, minWidth: 180, padding: '8px 11px', borderRadius: 14, border: '1px solid var(--line)', fontFamily: 'inherit', fontSize: 13, backgroundColor: 'var(--cp-surface)', outline: 'none' }} />
      </div>
      {msg && <div role="alert" style={{ marginBottom: 10, color: 'var(--danger)' }}>{msg}</div>}
      {visibles.length === 0 && <div style={{ color: 'var(--ink-3)' }}>Sin clientes en este filtro.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {visibles.map((f) => (
          <li key={f.profile_id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} data-testid="cartera-fila">
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600 }}>{f.nombre}{!f.verificado ? ' · sin verificar' : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {f.vendedor_nombre ? `Vendedor: ${f.vendedor_nombre}` : 'Sin vendedor'}
                {f.requiere_reasignacion && <span className="pill p-warn" style={{ marginLeft: 6 }}>Su vendedor ya no puede atender</span>}
                {f.vendedor_historico && <span style={{ marginLeft: 6 }}>· histórico: {f.vendedor_historico}</span>}
              </div>
            </div>
            <SelectorVendedor vendedores={vendedores} nuevos valor={sel[f.profile_id] ?? ''} onCambio={(v) => setSel((s) => ({ ...s, [f.profile_id]: v }))} />
            {f.vendedor_id && <input placeholder="Motivo del cambio (obligatorio)" aria-label="Motivo del cambio de cartera" value={motivo[f.profile_id] ?? ''} onChange={(e) => setMotivo((m) => ({ ...m, [f.profile_id]: e.target.value }))} maxLength={200} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minHeight: 40 }} />}
            <button type="button" className="btn" disabled={!sel[f.profile_id] || (!!f.vendedor_id && !(motivo[f.profile_id] ?? '').trim())} onClick={() => guardar(f)} data-testid="btn-guardar-cartera">{f.vendedor_id ? 'Cambiar vendedor de cartera' : 'Asignar a su cartera'}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PestanaVendedores({ vendedores, onEquipo }: { vendedores: Vendedor[]; onEquipo?: () => void }) {
  return (
    <div className="card">
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>
        Un vendedor recibe conversaciones si está activo, es de Ventas y tiene <b>Atender conversaciones</b>. Para recibir clientes nuevos además necesita <b>Recibir clientes nuevos</b>. Quitar este último no le quita su cartera actual.
        {onEquipo && <> <button type="button" className="btn ghost sm" onClick={onEquipo}>Cambiar permisos en Equipo</button></>}
      </div>
      {vendedores.length === 0 && <div style={{ color: 'var(--ink-3)' }}>No hay usuarios de Ventas.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {vendedores.map((v) => (
          <li key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 12 }} data-testid="vendedor">
            <b style={{ flex: 1 }}>{v.nombre}</b>
            <span className={'pill ' + (v.activo ? 'p-neu' : 'p-dang')}>{v.activo ? 'Activo' : 'Inactivo'}</span>
            <span className={'pill ' + (v.conversaciones ? 'p-neu' : 'p-warn')}>{v.conversaciones ? 'Atiende conversaciones' : 'No atiende conversaciones'}</span>
            <span className={'pill ' + (v.nuevos_clientes ? 'p-neu' : 'p-warn')}>{v.nuevos_clientes ? 'Recibe clientes nuevos' : 'No recibe nuevos'}</span>
            <span className="pill p-neu">{v.clientes} cliente(s)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Canales (169/170) · Dirección ve los chats de WhatsApp, Instagram y Messenger ────────────────────
// En modo espejo solo se leen (Leadsales sigue contestando); en activo, desde aquí mismo se contesta y se asigna.
// Las listas de Solicitudes/Asesorías no los muestran mientras nadie pida asesor: esta pestaña es la vista de los canales.
const hace = (min: number | null | undefined): string => {   // minutos que manda el servidor (su reloj): aquí no se usa el del navegador
  if (min == null) return ''
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`
  return `hace ${Math.round(min / 1440)} días`
}
const telefonoBonito = (wa: string) => { const m = /^521?(\d{3})(\d{3})(\d{4})$/.exec(wa); return m ? `+52 ${m[1]} ${m[2]} ${m[3]}` : `+${wa}` }   // México llega como 52 o 521 + 10 dígitos
const ACTOR: Record<string, string> = { visitor: 'Cliente', doctor: 'Cliente', ai: 'Asistente', seller: 'Vendedor', admin: 'Dirección' }
const CANAL: Record<CanalBandeja, { nombre: string; pill: string }> = { whatsapp: { nombre: 'WhatsApp', pill: 'p-ok' }, instagram: { nombre: 'Instagram', pill: 'p-warn' }, messenger: { nombre: 'Facebook', pill: 'p-blue' } }
const CANALES: CanalBandeja[] = ['whatsapp', 'instagram', 'messenger']
const contactoDe = (c: ChatCanal) => (c.canal === 'whatsapp' ? telefonoBonito(c.id) : CANAL[c.canal].nombre)

function PestanaWhatsApp({ cliente, chat, canalOp }: { cliente: ClienteAtencion; chat: ClienteChat; canalOp: ClienteCanalOperacion }) {
  const [bandeja, setBandeja] = useState<BandejaCanales | null>(null)
  const [control, setControl] = useState<ControlConversacion | null>(null)   // R4-B2-4 · quién atiende la abierta y si puedo escribir
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<ChatCanal | null>(null)
  const [filtro, setFiltro] = useState<CanalBandeja | 'todos'>('todos')
  const cargar = useCallback(async () => { const r = await cliente.canales(); if (r.ok) { setBandeja(r.data); setError(null) } else setError(r.error) }, [cliente])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { const t = setInterval(() => { if (!abierta) void cargar() }, 30_000); return () => clearInterval(t) }, [cargar, abierta])

  // R4-B2-4 · desde el panel (atención por personas) se abre la conversación de la bandeja por su id
  const abrirPorId = (id: string) => { const c = bandeja?.chats.find((x) => x.conversation_id === id); if (c) { setControl(null); setAbierta(c) } }
  const bloqueo = control?.canal && !control.puede_escribir ? (MOTIVO_NO_ESCRIBIR[control.motivo_no_escribir ?? ''] ?? 'Solo lectura.') : null
  if (abierta?.conversation_id) return (
    <div className="grid" style={{ gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={() => { setAbierta(null); void cargar() }} data-testid="wa-volver">← Canales</button>
        <span className={'pill ' + CANAL[abierta.canal].pill}>{CANAL[abierta.canal].nombre}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{abierta.cliente_nombre ?? abierta.nombre ?? ''}{abierta.canal === 'whatsapp' ? ` · ${telefonoBonito(abierta.id)}` : ''}{abierta.cliente ? ' · cliente' : ' · sin cuenta'}</span>
      </div>
      <BarraTomaCanal conversationId={abierta.conversation_id} cliente={canalOp} onControl={setControl} />
      <ChatCanonico embebido asesor puedeEmpresa conversationId={abierta.conversation_id} bloqueoEscritura={control ? bloqueo : 'Comprobando quién atiende…'} cliente={chat} nombreCliente={abierta.cliente_nombre ?? abierta.nombre ?? contactoDe(abierta)}
        etiquetaSalir="Volver a Canales" onSalir={() => { setAbierta(null); void cargar() }} onFin={() => { setAbierta(null); void cargar() }} />
    </div>
  )
  const chats = (bandeja?.chats ?? []).filter((c) => filtro === 'todos' || c.canal === filtro)
  const sinResponder = chats.filter((c) => c.sin_responder).length
  const algunoActivo = bandeja ? CANALES.some((k) => bandeja.modos[k] === 'activo') : false
  return (
    <>
    <PanelOperativoCanal cliente={canalOp} canal="whatsapp" onAbrir={abrirPorId}
      nombres={Object.fromEntries((bandeja?.chats ?? []).filter((c) => c.conversation_id).map((c) => [c.conversation_id as string, c.cliente_nombre ?? c.nombre ?? contactoDe(c)]))} />
    <div className="card" data-testid="wa-bandeja">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 220, fontSize: 13, color: 'var(--ink-3)' }}>
          {bandeja == null ? 'Cargando…' : !algunoActivo
            ? <>Los canales están en <b>modo espejo</b>: lo que llega por WhatsApp, Instagram y Facebook se registra aquí, pero todavía se contesta en Leadsales. Desde aquí solo se lee.</>
            : <>Un canal <b>activo</b> lo contesta primero el asistente y avisa a la vendedora; desde aquí Dirección puede leer, contestar y asignar.</>}
        </div>
        {bandeja && CANALES.map((k) => <span key={k} className={'pill ' + (bandeja.modos[k] === 'activo' ? 'p-ok' : 'p-warn')} data-testid={`canal-modo-${k}`}>{CANAL[k].nombre}: {bandeja.modos[k] === 'activo' ? 'activo' : 'espejo'}</span>)}
        {bandeja && sinResponder > 0 && <span className="pill p-warn">{sinResponder} sin responder</span>}
        <button type="button" className="btn ghost sm" onClick={() => void cargar()}>Actualizar</button>
      </div>
      {bandeja && (
        <div className="seg" role="group" aria-label="Canal" style={{ marginBottom: 10 }}>
          {(['todos', ...CANALES] as const).map((k) => <button key={k} type="button" className={filtro === k ? 'active' : undefined} onClick={() => setFiltro(k)}>{k === 'todos' ? `Todos (${bandeja.chats.length})` : `${CANAL[k].nombre} (${bandeja.chats.filter((c) => c.canal === k).length})`}</button>)}
        </div>
      )}
      {error && <div role="alert" style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}
      {bandeja && chats.length === 0 && <div style={{ color: 'var(--ink-3)' }}>Todavía no ha escrito nadie por {filtro === 'todos' ? 'estos canales' : CANAL[filtro].nombre}.</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {chats.map((c) => (
          <li key={c.canal + ':' + c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 12 }} data-testid="wa-chat">
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                <span className={'pill ' + CANAL[c.canal].pill} style={{ marginRight: 6 }} data-testid="wa-chat-canal">{CANAL[c.canal].nombre}</span>
                {c.cliente_nombre ?? c.nombre ?? contactoDe(c)}
                {c.canal === 'whatsapp' && <span style={{ fontWeight: 400, color: 'var(--ink-3)', marginLeft: 6 }}>{telefonoBonito(c.id)}</span>}
                <span className={'pill ' + (c.cliente ? 'p-ok' : 'p-neu')} style={{ marginLeft: 6 }}>{c.cliente ? 'Cliente' : 'Sin cuenta'}</span>
                {c.sin_responder && <span className="pill p-warn" style={{ marginLeft: 4 }}>Sin responder</span>}
                {c.vendedor && <span className="pill p-neu" style={{ marginLeft: 4 }}>{c.vendedor}</span>}
              </div>
              {c.ultimo_texto && <div style={{ fontSize: 12.5, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>
                <span style={{ color: 'var(--ink-3)' }}>{ACTOR[c.ultimo_actor ?? ''] ?? ''}{c.ultimo_actor ? ': ' : ''}</span>{c.ultimo_texto}
              </div>}
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{hace(c.hace_min)}{c.n_mensajes ? ` · ${c.n_mensajes} mensaje(s)` : ''}{c.ventana_abierta === false ? ' · ventana de 24 h cerrada' : ''}</div>
            </div>
            {c.conversation_id && <button type="button" className="btn sm" style={{ minHeight: 40 }} onClick={() => { setControl(null); setAbierta(c) }} data-testid="wa-abrir">{bandeja?.modos[c.canal] === 'activo' ? 'Abrir chat' : 'Ver chat'}</button>}
          </li>
        ))}
      </ul>
    </div>
    </>
  )
}

/** Conversaciones → Bandeja: solicitudes de asesor y WhatsApp. Abrir lleva a Asesorías (la conversación exacta). */
export function AtencionComercialPantalla() {
  const { setScreen } = useRole()
  return <AtencionComercial pestanas={PESTANAS_BANDEJA} titulo="Dirección · Conversaciones · Bandeja" onEquipo={() => setScreen('av_equipo')}
    onAbrir={(id) => irAConversacion(setScreen, id, { origen: 'atencion' })} onHorario={() => { abrirPestanaAtencion('horario'); setScreen('av_cartera') }} />
}
/** Equipo → Cartera y horario: cartera por vendedor, vendedores elegibles, horario y alertas. */
export function CarteraHorarioPantalla() {
  const { setScreen } = useRole()
  return <AtencionComercial pestanas={PESTANAS_CARTERA} titulo="Dirección · Equipo · Cartera y horario" onEquipo={() => setScreen('av_equipo')} />
}
