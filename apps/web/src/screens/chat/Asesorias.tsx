// CC-2/CC-7 · Asesorías — CHV2-B: etiqueta visible "Conversaciones". Es el espacio de trabajo donde el
// vendedor y el doctor conversan. El VENDEDOR ve solo sus conversaciones (su cartera o lo que Dirección
// le asignó) con el contexto comercial: carrito, estado de atención y espera (del servidor), si la IA
// sigue atendiendo y si ya inició. Ya no "toma" clientes: los sin vendedor los asigna Dirección.
// CHV2-B · Apertura profunda: Inicio / alerta / campana piden abrir UNA conversación por id; solo se
// abre si aparece en la cola autorizada que devuelve el servidor. "Atender ahora" usa el comando
// canónico de inicio (Edge chat → cc_iniciar_asesoria, idempotente): nunca crea otra conversación, otro
// handoff ni cambia la cartera.
import React, { useCallback, useEffect, useState } from 'react'
import { confirmar } from '../../app/dialogos'   // CALIDAD VISUAL · diálogos del sistema
import { capitalizarNombre } from '../../lib/nombres'
import { avatarColor } from '../../lib/format'
import { chat as clientePorDefecto, ETIQUETA_MODO, type ClienteChat, type ColaItem } from '../../data/ops/chat'
import { ETIQUETA_ATENCION, estadoDe, formatoMinutos, tonoAtencion } from '../../data/ops/atencionComercial'
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
import { BuscadorConversaciones } from './BuscarMensajes'
import { useMisClientes } from './MisClientes'
import { misConversaciones as misConversacionesPorDefecto } from '../../data/ops/misConversaciones'
import { cuandoLista } from '../../lib/cuando'
import { telefonoLegible } from '../../lib/telefono'
import { abrirHoja, cerrarHoja, useHoja } from '../../data/store/hojaChat'
import type { AccionChat } from './ChatCanonico'
import { ShieldCheck, Link as LinkIco, KeyRound as Llave } from 'lucide-react'
import { useIne, elegirIne } from '../../data/store/ineSeleccion'
import { PanelVerificacion } from './PanelVerificacion'
import { BotonAvisos } from '../../app/BotonAvisos'
import { Vacio, Cargando } from '../../app/EmptyState'
import { usarFotoComoIne, pendienteDeConversacion } from '../../data/ops/verificacion'
import type { DoctorPendiente } from '../../data/ops/verificacion'
import type { Mensaje } from '../../data/ops/chat'

const PILL: Record<string, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu', ok: 'p-ok' }

export function Asesorias({ cliente = clientePorDefecto, intervaloMs = 20_000, esDireccion = false, onAtencion, contactoDe = contactoPorDefecto, cargarMis }: { cliente?: ClienteChat; intervaloMs?: number; esDireccion?: boolean; onAtencion?: () => void; contactoDe?: typeof contactoPorDefecto; cargarMis?: Parameters<typeof useMisClientes>[1] }) {
  const [cola, setCola] = useState<ColaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [llegada, setLlegada] = useState<string | null>(null)       // fila resaltada al volver de una apertura profunda
  const [aviso, setAviso] = useState<string | null>(null)
  const [enfocar, setEnfocar] = useState(false)
  const [versionMis, setVersionMis] = useState(0)   // MIS CLIENTES · se relee al volver de una conversación
  const misClientes = useMisClientes(versionMis, cargarMis)
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
    if (!(await confirmar(`¿Confirmaste que hablas con ${nombre}? La invitación crea una cuenta YA VERIFICADA ligada a ese cliente.`))) return
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
      // CONV-WHATSAPP / REPARTO-CONTACTO · también las de SU cartera que hoy atiende el asistente (no están en la cola de asesorías).
      if (!c && ((await (cargarMis ?? misConversacionesPorDefecto)()) ?? []).some((x) => x.conversation_id === intento.conversationId)) {
        setAviso(null); setLlegada(intento.conversationId); setEnfocar(true); setAbierta(intento.conversationId); return
      }
      if (!c) { setAviso('Esa conversación ya no está en tu cola: se atendió, se reasignó o no tienes acceso a ella.'); return }
      setAviso(null)
      if (intento.iniciar) await atender(c)
      else { setLlegada(c.conversation_id); setEnfocar(true); setAbierta(c.conversation_id) }
    })()
    return () => { vivo = false }
  }, [intento, cargar, atender, esDireccion, cargarMis])

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
    <div className="grid ases-chat" style={{ gap: 8 }}>
      {aviso && <div className="rc-aviso-nav" role="status">{aviso}</div>}
      <ChatCanonico embebido asesor puedeEmpresa={esDireccion} accionesAdjunto={accionesAdjunto} conversationId={abierta} cliente={cliente} autoFoco={enfocar} nombreCliente={contacto?.nombre ?? cola.find((x) => x.conversation_id === abierta)?.dueno ?? misClientes.lista.find((x) => x.conversation_id === abierta)?.dueno ?? null}
        telefono={contacto?.telefono ?? cola.find((x) => x.conversation_id === abierta)?.telefono ?? misClientes.lista.find((x) => x.conversation_id === abierta)?.telefono ?? null} onSalir={() => { setAbierta(null); setEnfocar(false); setVersionMis((n) => n + 1); void cargar(); void recargarAtencion() }}
        tira={tira} acciones={acciones} hoja={hoja}
        onFin={() => { setAviso(TEXTO_ASESORIA_FINALIZADA); setAbierta(null); setEnfocar(false); void cargar(); void recargarAtencion() }} />
    </div>
  )

  const sinAsignar = cola.filter((c) => c.modo === 'human_requested' && !c.seller_profile_id)
  // CONV-WHATSAPP (14 nov 2026, dueño: "se tiene que sentir tal cual como WhatsApp") · UNA lista: cada persona una vez, la
  // más reciente arriba, con su nombre, número y el último mensaje. Tocar la fila abre el chat (leer siempre se puede;
  // escribir retoma). Las solicitudes sin vendedor (Dirección) van aparte arriba porque piden una acción distinta.
  const retomables = esDireccion ? [] : misClientes.lista
  const abrir = (id: string) => { setAviso(null); setLlegada(id); setEnfocar(true); setAbierta(id) }
  const enCola = new Set(cola.map((c) => c.conversation_id))
  const filas: FilaChat[] = [
    ...cola.filter((c) => !sinAsignar.includes(c)).map((c): FilaChat => {
      const e = estadoDe(c)
      const etiqueta = c.es_mia && c.modo === 'human_assigned' ? { texto: 'Te espera', tono: 'warn' as const }
        : !c.es_mia ? { texto: ETIQUETA_MODO[c.modo], tono: 'neu' as const }
        : e && tonoAtencion(e) !== 'ok' ? { texto: ETIQUETA_ATENCION[e], tono: tonoAtencion(e) } : null
      return { id: c.conversation_id, nombre: c.dueno, telefono: c.telefono ?? null, canal: c.canal ?? null, ultimo: c.ultimo ?? null, at: c.ultimo?.at ?? c.last_message_at,
        sinLeer: c.sin_leer, etiqueta, carrito: c.handoff_origen === 'carrito' ? c.n_items ?? 0 : null, testid: 'cola-item', persona: c.persona ?? null,
        onAbrir: () => (c.es_mia && c.modo === 'human_assigned' ? void atender(c) : abrir(c.conversation_id)) }
    }),
    ...retomables.filter((c) => !enCola.has(c.conversation_id)).map((c): FilaChat => ({
      id: c.conversation_id, nombre: c.dueno, telefono: c.telefono ?? null, canal: c.canal, ultimo: c.ultimo, at: c.ultimo?.at ?? c.last_message_at, sinLeer: 0,
      etiqueta: c.atiende === 'otro' || c.atiende === 'direccion' ? { texto: `Con ${c.atiende_nombre ?? (c.atiende === 'direccion' ? 'Dirección' : 'otra persona')}`, tono: 'warn' }
        : c.dias_restantes != null && c.dias_restantes <= 7 ? { texto: `Tuyo ${c.dias_restantes === 1 ? '1 día' : `${c.dias_restantes} días`} más`, tono: 'dang' } : null,
      carrito: null, testid: 'mi-cliente', persona: c.persona ?? null, onAbrir: () => { void cargar(); abrir(c.conversation_id) },
    })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  // HILO-PERSONA · la misma persona por varios canales (WhatsApp y portal) aparece UNA vez: la fila más reciente, con
  // sus canales y sus no leídos sumados (al abrirla se ve todo junto).
  const porPersona = new Map<string, FilaChat>()
  const filasUnicas: FilaChat[] = []
  for (const f of filas) {
    const p = f.persona
    const ya = p ? porPersona.get(p) : undefined
    if (!ya) { filasUnicas.push(f); if (p) porPersona.set(p, f); continue }
    ya.sinLeer += f.sinLeer
    ya.canales = [...new Set([...(ya.canales ?? [ya.canal ?? 'portal']), f.canal ?? 'portal'])]
    if (!ya.telefono) ya.telefono = f.telefono
  }

  return (
    <div className="card" data-testid="asesorias">
      <div className="ases-head">
        <div className="ases-head-txt">
          <h2 style={{ margin: 0 }}>Conversaciones</h2>
          <p>{esDireccion ? 'Todas las conversaciones con atención humana. Toca una para abrirla.' : 'Tus clientes y prospectos, el más reciente arriba. Toca uno para abrir su chat; si le escribes, lo retomas tú.'}</p>
        </div>
        <div className="ases-head-acc">
          <BotonAvisos className="btn ghost sm" />
          <EnlaceContactoBotones />
        </div>
      </div>
      {/* HERRAMIENTAS DEL VENDEDOR · buscar una palabra en todas sus conversaciones (no se acuerda de con quién habló) */}
      <BuscadorConversaciones onAbrir={abrir} />
      {aviso && <div className="rc-aviso-nav" role="status" data-testid="aviso-apertura">{aviso}</div>}
      {error && <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--ds-danger-bg)', color: 'var(--ds-danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {cargando && <Cargando plano />}
      {!cargando && cola.length === 0 && retomables.length === 0 && !error && (
        <div className="op-vacio"><Vacio plano icono="chat" titulo="Todavía no tienes conversaciones."
          pista={esDireccion ? undefined : 'Cuando un cliente te escriba o pida hablar contigo, aparecerá aquí.'} /></div>
      )}
      {esDireccion && sinAsignar.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h3 className="wa-lista-tit">Por asignar ({sinAsignar.length})</h3>
          <ul className="wa-lista">
            {sinAsignar.map((c) => (
              <FilaConversacion key={c.conversation_id} llegada={llegada === c.conversation_id} f={{ id: c.conversation_id, nombre: c.dueno, telefono: c.telefono ?? null, canal: c.canal ?? null, ultimo: c.ultimo ?? null,
                at: c.ultimo?.at ?? c.last_message_at, sinLeer: c.sin_leer, etiqueta: { texto: c.edad_min != null ? `Espera hace ${formatoMinutos(c.edad_min)}` : 'Sin vendedor', tono: 'dang' },
                carrito: c.handoff_origen === 'carrito' ? c.n_items ?? 0 : null, testid: 'cola-item', onAbrir: () => abrir(c.conversation_id) }}
                accion={onAtencion ? <button type="button" className="btn btn-primary sm" onClick={onAtencion} data-testid="btn-asignar">Asignar</button> : null} />
            ))}
          </ul>
        </section>
      )}
      {filasUnicas.length > 0 && (
        <ul className="wa-lista" aria-label="Conversaciones" data-testid="lista-conversaciones">
          {filasUnicas.map((f) => <FilaConversacion key={f.id} f={f} llegada={llegada === f.id} />)}
        </ul>
      )}
    </div>
  )
}

/** Una fila de la lista, como en WhatsApp: inicial, nombre y hora; debajo el último mensaje; el número y el estado al final. */
/** FOTOS DE CLIENTES (15 nov 2026) · WhatsApp no comparte la foto de perfil: cada cliente lleva sus iniciales (sin
 *  «Dr./Dra.») en un color propio y estable, para reconocerlo de un vistazo. Un número sin nombre lleva «#». */
export function inicialesDe(nombre: string): string {
  const n = nombre.replace(/^(dra?\.?|doctora?|lic\.?|cl[ií]nica)\s+/i, '').trim()
  if (!n || /^[\d\s()+-]+$/.test(n)) return '#'
  const p = n.split(/\s+/).filter((x) => /\p{L}/u.test(x))
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '#'
}
export interface FilaChat {
  id: string; nombre: string; telefono: string | null; canal: string | null; ultimo: { actor: string; texto: string; at: string } | null; at: string | null
  sinLeer: number; etiqueta: { texto: string; tono: 'dang' | 'warn' | 'neu' | 'ok' } | null; carrito: number | null; testid: string; onAbrir: () => void
  persona?: string | null; canales?: string[]   // HILO-PERSONA
}
const QUIEN: Record<string, string> = { ai: 'Asistente: ', seller: 'Tú: ', admin: 'Equipo: ' }
const CANAL_CORTO: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Facebook', portal: 'Portal' }
export function FilaConversacion({ f, llegada, accion }: { f: FilaChat; llegada?: boolean; accion?: React.ReactNode }) {
  const nombre = capitalizarNombre(f.nombre) || telefonoLegible(f.telefono) || 'Contacto'
  const tel = telefonoLegible(f.telefono)
  const iniciales = inicialesDe(nombre)
  return (
    <li className={`wa-fila${llegada ? ' rc-llegada' : ''}${f.sinLeer > 0 ? ' wa-fila--nueva' : ''}`} data-testid={f.testid}>
      <button type="button" className="wa-fila-btn" onClick={f.onAbrir} aria-label={`Abrir conversación con ${nombre}${f.sinLeer ? `, ${f.sinLeer} sin leer` : ''}`} data-testid="abrir-conversacion">
        <span className="wa-av" style={{ background: avatarColor(nombre) }} aria-hidden data-testid="fila-avatar">{iniciales}</span>
        <span className="wa-cuerpo">
          <span className="wa-l1"><b className="wa-nombre">{nombre}</b>{f.at && <time className="wa-hora" dateTime={f.at}>{cuandoLista(f.at)}</time>}</span>
          <span className="wa-l2">
            <span className="wa-prev">{f.ultimo ? <>{QUIEN[f.ultimo.actor] ?? ''}{f.ultimo.texto}</> : <i>Sin mensajes</i>}</span>
            {f.sinLeer > 0 && <span className="wa-badge" data-testid="sin-leer">{f.sinLeer > 99 ? '99+' : f.sinLeer}</span>}
          </span>
          <span className="wa-l3">
            {tel && tel !== nombre && <span data-testid="fila-telefono">{tel}</span>}
            {(f.canales ?? (f.canal ? [f.canal] : [])).map((k) => <span key={k} data-testid="fila-canal">{CANAL_CORTO[k] ?? k}</span>)}
            {f.etiqueta && <span className={'pill ' + PILL[f.etiqueta.tono]} data-testid="estado-atencion">{f.etiqueta.texto}</span>}
            {!f.etiqueta && f.ultimo && (f.ultimo.actor === 'visitor' || f.ultimo.actor === 'doctor') && <span className="pill p-warn" data-testid="sin-responder">Sin responder</span>}
            {f.carrito != null && <span className="pill p-neu" data-testid="marca-carrito">Carrito{f.carrito ? ` · ${f.carrito}` : ''}</span>}
          </span>
        </span>
      </button>
      {accion && <span className="wa-accion">{accion}</span>}
    </li>
  )
}

export const formatoEdad = formatoMinutos   // compatibilidad: una sola forma de mostrar minutos del servidor

/** Montaje en el registro: Dirección ve todo y asigna en Atención comercial; el vendedor ve lo suyo. */
export function AsesoriasPantalla() {
  const { role, setScreen } = useRole()
  return <Asesorias esDireccion={role === 'admin'} onAtencion={() => setScreen('av_atencion')} />
}
