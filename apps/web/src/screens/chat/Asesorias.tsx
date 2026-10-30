// CC-2/CC-7 · Asesorías — CHV2-B: etiqueta visible "Conversaciones". Es el espacio de trabajo donde el
// vendedor y el doctor conversan. El VENDEDOR ve solo sus conversaciones (su cartera o lo que Dirección
// le asignó) con el contexto comercial: carrito, estado de atención y espera (del servidor), si la IA
// sigue atendiendo y si ya inició. Ya no "toma" clientes: los sin vendedor los asigna Dirección.
// CHV2-B · Apertura profunda: Inicio / alerta / campana piden abrir UNA conversación por id; solo se
// abre si aparece en la cola autorizada que devuelve el servidor. "Atender ahora" usa el comando
// canónico de inicio (Edge chat → cc_iniciar_asesoria, idempotente): nunca crea otra conversación, otro
// handoff ni cambia la cartera.
import React, { useCallback, useEffect, useState } from 'react'
import { capitalizarNombre } from '../../lib/nombres'
import { chat as clientePorDefecto, ETIQUETA_MODO, type ClienteChat, type ColaItem } from '../../data/ops/chat'
import { MOTIVO_RUTEO } from '../../data/ops/atencion'
import { ETIQUETA_ATENCION, estadoDe, formatoMinutos, textoEspera, textoIA, tonoAtencion } from '../../data/ops/atencionComercial'
import { recargarAtencion } from '../../data/store/atencionStore'
import { consumirIntento, useIntento } from '../../data/store/navIntentStore'
import { ChatCanonico, TEXTO_ASESORIA_FINALIZADA } from './ChatCanonico'
import { useRole } from '../../auth/RoleContext'
import { contactoDe as contactoPorDefecto, urlVerificacionMedica, type ContactoEnlace } from '../../data/ops/contactoEnlace'
import { EnlaceContactoBotones } from '../../app/EnlaceContacto'
import { crearInvitacion } from '../../data/ops/invitacion'
import { usePanelCliente, accionesIneVisitante } from './PanelCliente'
import { HojaMarco } from './HojaChat'
import { OrigenChip } from './OrigenConversacion'
import { abrirHoja, cerrarHoja, useHoja } from '../../data/store/hojaChat'
import type { AccionChat } from './ChatCanonico'
import { ShieldCheck, Link as LinkIco, KeyRound as Llave } from 'lucide-react'
import { useIne, elegirIne } from '../../data/store/ineSeleccion'
import { PanelVerificacion } from './PanelVerificacion'
import { BotonAvisos } from '../../app/BotonAvisos'
import { Vacio } from '../../app/EmptyState'
import { usarFotoComoIne, pendienteDeConversacion } from '../../data/ops/verificacion'
import type { DoctorPendiente } from '../../data/ops/verificacion'
import type { Mensaje } from '../../data/ops/chat'

const PILL: Record<string, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu', ok: 'p-ok' }

export function Asesorias({ cliente = clientePorDefecto, intervaloMs = 8000, esDireccion = false, onAtencion, contactoDe = contactoPorDefecto }: { cliente?: ClienteChat; intervaloMs?: number; esDireccion?: boolean; onAtencion?: () => void; contactoDe?: typeof contactoPorDefecto }) {
  const [cola, setCola] = useState<ColaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [llegada, setLlegada] = useState<string | null>(null)       // fila resaltada al volver de una apertura profunda
  const [aviso, setAviso] = useState<string | null>(null)
  const [enfocar, setEnfocar] = useState(false)
  const intento = useIntento('asesorias')
  // CX-ENLACE · datos que dejó quien escribe por el enlace de contacto (el servidor decide si me corresponde verlos).
  const [contacto, setContacto] = useState<ContactoEnlace | null>(null)
  useEffect(() => {
    setContacto(null); setHerr(null)
    if (!abierta) return
    let vivo = true
    void contactoDe(abierta).then((c) => { if (vivo) setContacto(c) })
    return () => { vivo = false }
  }, [abierta, contactoDe])
  // FOTOS · si el dueño de la conversación es un doctor por verificar, sus fotos ofrecen "Usar como INE".
  const [pendiente, setPendiente] = useState<DoctorPendiente | null>(null)
  const [versionPanel, setVersionPanel] = useState(0)
  const usarComo = async (m: Mensaje, clave: 'ine-front' | 'ine-back') => {
    if (!m.adjunto) return
    const r = await usarFotoComoIne(m.adjunto.id, clave)
    setHerr(r.ok ? `Foto guardada como ${clave === 'ine-front' ? 'INE frente' : 'INE reverso'} en su verificación.` : r.mensaje)
    if (r.ok) { setVersionPanel((n) => n + 1); if (abierta) abrirHoja(abierta, 'verif') }
  }
  // EXPEDIENTE EN EL CHAT · ¿quien escribe es un doctor con cuenta por verificar? (franja + hoja de verificación)
  useEffect(() => {
    setPendiente(null)
    if (!abierta) return
    let vivo = true
    void pendienteDeConversacion(abierta).then((d) => { if (vivo) setPendiente(d) }).catch(() => {})
    return () => { vivo = false }
  }, [abierta])
  const ineVisitante = useIne(abierta ?? '')
  const accionesVisitante = abierta ? accionesIneVisitante(abierta, ineVisitante, (lado, a, url) => elegirIne(abierta, lado, a, url)) : () => null
  const accionesAdjunto = (m: Mensaje) => (m.actor === 'visitor' ? accionesVisitante(m) : pendiente && m.actor === 'doctor' && m.adjunto && !m.adjunto.uso ? (
    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="acciones-ine">
      <button type="button" className="btn ghost sm" onClick={() => void usarComo(m, 'ine-front')}>Usar como INE frente</button>
      <button type="button" className="btn ghost sm" onClick={() => void usarComo(m, 'ine-back')}>Usar como INE reverso</button>
    </span>
  ) : null)
  // Herramientas del asesor: mandar en ESTA conversación el enlace de registro o la invitación a crear cuenta.
  const [herr, setHerr] = useState<string | null>(null)
  const mandar = async (texto: string, listo: string) => {
    if (!abierta) return
    const r = await cliente.enviar(abierta, texto)
    setHerr(r.ok ? listo : r.error.codigo === 'asesoria_no_iniciada' ? 'Inicia la asesoría para poder escribirle.' : r.error.mensaje)
  }
  const mandarRegistro = () => void mandar('Para verificarte, toca «Verificar mi cuenta» arriba en este chat: te pedirá tu cédula, las fotos de tu INE y una contraseña. No tienes que salir de aquí.', 'Le mandaste el enlace de registro.')
  const mandarInvitacion = async (customerId: string, nombre: string) => {
    if (!window.confirm(`¿Confirmaste que hablas con ${nombre}? La invitación crea una cuenta YA VERIFICADA ligada a ese cliente.`)) return
    const inv = await crearInvitacion(customerId)
    if (!inv.ok) { setHerr(inv.mensaje); return }
    await mandar(`Te dejo tu invitación para crear tu cuenta en Renovacell. Como ya eres cliente, queda verificada: ${inv.data.enlace}`, 'Le mandaste la invitación a crear su cuenta.')
  }

  const cargar = useCallback(async () => {
    const r = await cliente.cola()
    if (!r.ok) { setError(r.error.mensaje); setCargando(false); return null }
    setError(null); setCola(r.data.cola ?? []); setCargando(false)
    return r.data.cola ?? []
  }, [cliente])

  useEffect(() => {
    void cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, intervaloMs)
    return () => clearInterval(t)
  }, [cargar, intervaloMs])

  const atender = useCallback(async (c: ColaItem) => {
    if (c.es_mia && c.modo === 'human_assigned') {
      const r = await cliente.iniciar(c.conversation_id)   // comando canónico (idempotente en el servidor)
      if (!r.ok) setAviso(`No se pudo iniciar la asesoría: ${r.error.mensaje} Puedes iniciarla desde la conversación.`)
      void recargarAtencion()
    }
    setLlegada(c.conversation_id); setEnfocar(true); setAbierta(c.conversation_id)
  }, [cliente])

  // Apertura profunda: se resuelve contra la cola AUTORIZADA más reciente (no contra el aviso).
  useEffect(() => {
    if (!intento) return
    let vivo = true
    void (async () => {
      const lista = (await cargar()) ?? []
      if (!vivo) return
      consumirIntento(intento.id)
      const c = lista.find((x) => x.conversation_id === intento.conversationId)
      // Dirección abre CUALQUIER conversación (la atienda quien la atienda o aunque nadie la haya tomado); el servidor sigue
      // decidiendo qué puede leer y escribir. Un vendedor solo abre las de su cola.
      if (!c && esDireccion) { setAviso(null); setLlegada(intento.conversationId); setEnfocar(true); setAbierta(intento.conversationId); return }
      if (!c) { setAviso('Esa conversación ya no está en tu cola: se atendió, se reasignó o no tienes acceso a ella.'); return }
      setAviso(null)
      if (intento.iniciar) await atender(c)
      else { setLlegada(c.conversation_id); setEnfocar(true); setAbierta(c.conversation_id) }
    })()
    return () => { vivo = false }
  }, [intento, cargar, atender, esDireccion])

  // EXPEDIENTE EN EL CHAT · todo se trabaja dentro de la conversación: franja (quién es), menú «+» y hoja de la acción.
  const pc = usePanelCliente({ conversationId: abierta ?? '', chat: cliente, activo: !!abierta, onCambio: () => { void cargar(); void recargarAtencion() } })
  const hojaAbierta = useHoja(abierta ?? '')
  const tira = abierta ? <>
    <OrigenChip conversationId={abierta} />
    {pendiente && (
      <button type="button" className="pc-tira pc-tira--verif" onClick={() => (hojaAbierta === 'verif' ? cerrarHoja(abierta) : abrirHoja(abierta, 'verif'))} aria-expanded={hojaAbierta === 'verif'} data-testid="tira-verificacion">
        <span className="pc-av pc-av--sm" aria-hidden><ShieldCheck size={16} /></span>
        <span className="pc-tira-tx"><b>{capitalizarNombre(pendiente.nombre ?? 'Doctor')} · verificación pendiente</b><small>{pendiente.cedula ? `Cédula ${pendiente.cedula}` : 'Sin cédula'} · tú puedes verificarlo aquí</small></span>
        <span className="pc-tira-cta">Revisar</span>
      </button>
    )}
    {contacto && (
      <div className="pc-tira pc-tira--fija" data-testid="contacto-enlace">
        <span className="pc-av pc-av--sm" aria-hidden><LinkIco size={16} /></span>
        <span className="pc-tira-tx">
          <b>{contacto.nombre}{contacto.es_medico ? ' · profesional de la salud' : ''}{contacto.cedula ? ` · cédula ${contacto.cedula}` : ''}</b>
          <small><a href={`tel:${contacto.telefono}`}>{contacto.telefono}</a> · <a href={`mailto:${contacto.email}`}>{contacto.email}</a> · llegó por el enlace de contacto</small>
        </span>
      </div>
    )}
    {contacto?.posible_cliente && !contacto.confirmado && (
      <div className="rc-contacto-ojo" role="note">Sus datos coinciden con el cliente <b>{contacto.posible_cliente}</b>, pero <b>no está confirmado</b>: no compartas historial, precios ni pedidos hasta que inicie sesión.</div>
    )}
    {herr && <div className="pc-msg ok" role="status" data-testid="herramienta-aviso">{herr}</div>}
    {pc.tira}
  </> : null
  const acciones: AccionChat[] = abierta ? [
    ...(pendiente ? [{ clave: 'verificar', etiqueta: `Verificar a ${capitalizarNombre(pendiente.nombre ?? 'este doctor')}`, detalle: 'Su cédula y las fotos de su INE; apruebas o rechazas', icono: <ShieldCheck size={18} />, onElegir: () => abrirHoja(abierta, 'verif') }] : []),
    ...(contacto && !contacto.confirmado ? [
      { clave: 'registro', etiqueta: 'Mandar enlace de registro', detalle: 'Para que se verifique sin salir de este chat', icono: <LinkIco size={18} />, onElegir: mandarRegistro },
      ...(contacto.posible_cliente_id ? [{ clave: 'invitacion', etiqueta: 'Ya es cliente: mandar invitación', detalle: `Cuenta verificada ligada a ${contacto.posible_cliente ?? contacto.nombre}`, icono: <Llave size={18} />, onElegir: () => void mandarInvitacion(contacto.posible_cliente_id!, contacto.posible_cliente ?? contacto.nombre) }] : []),
    ] : []),
    ...pc.acciones,
  ] : []
  const hoja = abierta && hojaAbierta === 'verif' ? (
    <HojaMarco titulo="Verificación" sub="Revisa su cédula y su INE; sin verificación automática." onCerrar={() => cerrarHoja(abierta)} testid="hoja-verificacion">
      <PanelVerificacion conversationId={abierta} onCambio={() => void cargar()} onDoctor={setPendiente} version={versionPanel} />
    </HojaMarco>
  ) : pc.hoja

  if (abierta) return (
    <div className="grid" style={{ gap: 8 }}>
      {aviso && <div className="rc-aviso-nav" role="status">{aviso}</div>}
      <ChatCanonico embebido asesor puedeEmpresa={esDireccion} accionesAdjunto={accionesAdjunto} conversationId={abierta} cliente={cliente} autoFoco={enfocar} nombreCliente={contacto?.nombre ?? cola.find((x) => x.conversation_id === abierta)?.dueno ?? null} onSalir={() => { setAbierta(null); setEnfocar(false); void cargar(); void recargarAtencion() }}
        tira={tira} acciones={acciones} hoja={hoja}
        onFin={() => { setAviso(TEXTO_ASESORIA_FINALIZADA); setAbierta(null); setEnfocar(false); void cargar(); void recargarAtencion() }} />
    </div>
  )

  const sinAsignar = cola.filter((c) => c.modo === 'human_requested' && !c.seller_profile_id)
  const mias = cola.filter((c) => c.es_mia)
  const otras = cola.filter((c) => !c.es_mia && !(c.modo === 'human_requested' && !c.seller_profile_id))
  const accionMia = (c: ColaItem) => (c.modo === 'human_assigned'
    ? <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => void atender(c)} data-testid="btn-atender">Atender ahora</button>
    : <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => { setLlegada(c.conversation_id); setAbierta(c.conversation_id) }} data-testid="btn-abrir">{c.modo === 'human_active' ? 'Continuar' : 'Abrir'}</button>)

  return (
    <div className="card" data-testid="asesorias">
      {/* Encabezado en dos bloques: título + descripción a la izquierda y UNA fila de acciones a la
          derecha (avisos + enlace de contacto). Antes "Activar avisos" quedaba suelto al centro por el
          space-between de tres hijos. En teléfono se apila: título, descripción y luego las acciones. */}
      <div className="ases-head">
        <div className="ases-head-txt">
          <h2 style={{ margin: 0 }}>Conversaciones con clientes</h2>
          <p>
            {esDireccion ? 'Todas las conversaciones con atención humana. Los clientes sin vendedor se asignan en Conversaciones → Solicitudes.' : 'Tus clientes que activaron un carrito o pidieron hablar contigo. El asistente los atiende hasta que inicies la asesoría.'}
          </p>
        </div>
        <div className="ases-head-acc">
          <BotonAvisos className="btn ghost sm" />
          <EnlaceContactoBotones />
        </div>
      </div>
      {aviso && <div className="rc-aviso-nav" role="status" data-testid="aviso-apertura">{aviso}</div>}
      {error && <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {cargando && <div style={{ color: 'var(--ink-3, #667)' }}>Cargando…</div>}
      {!cargando && cola.length === 0 && !error && (
        <div className="op-vacio"><Vacio plano icono="chat" titulo="No hay conversaciones esperando asesor."
          pista={esDireccion ? undefined : 'Cuando un cliente active su carrito o pida hablar contigo, aparecerá aquí.'} /></div>
      )}
      {esDireccion && <Seccion titulo={`Sin vendedor (${sinAsignar.length})`} items={sinAsignar} llegada={llegada} accion={(c) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {onAtencion && <button type="button" className="btn btn-primary" onClick={onAtencion} data-testid="btn-asignar">Asignar vendedor</button>}
          <button type="button" className="btn" onClick={() => setAbierta(c.conversation_id)}>Ver</button>
        </div>
      )} />}
      <Seccion titulo={`${esDireccion ? 'Asignadas a mí' : 'Mis asesorías'} (${mias.length})`} items={mias} llegada={llegada} accion={accionMia} />
      {esDireccion && <Seccion titulo={`En curso con vendedores (${otras.length})`} items={otras} llegada={llegada} accion={(c) => <button type="button" className="btn" onClick={() => { setLlegada(c.conversation_id); setAbierta(c.conversation_id) }} data-testid="btn-ver">Ver</button>} />}
    </div>
  )
}

function Seccion({ titulo, items, accion, llegada }: { titulo: string; items: ColaItem[]; accion: (c: ColaItem) => React.ReactNode; llegada?: string | null }) {
  if (items.length === 0) return null
  return (
    <section style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{titulo}</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c) => {
          const e = estadoDe(c)
          const espera = textoEspera(c.atencion)
          const ia = textoIA(c.atencion, c.modo)
          return (
            <li key={c.conversation_id} className={llegada === c.conversation_id ? 'rc-llegada' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10 }} data-testid="cola-item">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{capitalizarNombre(c.dueno)}{c.sin_leer > 0 ? ` · ${c.sin_leer} sin leer` : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3, #667)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                  {e ? <span className={'pill ' + PILL[tonoAtencion(e)]} data-testid="estado-atencion">{ETIQUETA_ATENCION[e]}</span> : <span>{c.iniciada ? 'Asesoría iniciada' : ETIQUETA_MODO[c.modo]}</span>}
                  {c.handoff_origen === 'carrito' && <span className="pill p-neu" data-testid="marca-carrito">Carrito activo{c.n_items ? ` · ${c.n_items} producto${c.n_items === 1 ? '' : 's'}` : ''}</span>}
                  {c.fuera_horario && <span className="pill p-warn" data-testid="marca-fuera-horario">Llegó fuera de horario</span>}
                  {c.ruteo_motivo && <span className="pill p-warn">{MOTIVO_RUTEO[c.ruteo_motivo] ?? c.ruteo_motivo}</span>}
                  {c.edad_min != null && <span>hace {formatoEdad(c.edad_min)}</span>}
                </div>
                {(espera || ia) && <div style={{ fontSize: 12, color: 'var(--ink-3, #667)', marginTop: 4 }} data-testid="contexto-atencion">{[espera, ia].filter(Boolean).join(' · ')}</div>}
              </div>
              {accion(c)}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export const formatoEdad = formatoMinutos   // compatibilidad: una sola forma de mostrar minutos del servidor

/** Montaje en el registro: Dirección ve todo y asigna en Atención comercial; el vendedor ve lo suyo. */
export function AsesoriasPantalla() {
  const { role, setScreen } = useRole()
  return <Asesorias esDireccion={role === 'admin'} onAtencion={() => setScreen('av_atencion')} />
}
