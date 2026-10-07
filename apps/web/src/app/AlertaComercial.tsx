// CHV2-B · ALERTA COMERCIAL EN VIVO (shell autenticado, solo staff con fuente comercial).
//   1. Llega un aviso por Realtime (notifications INSERT con kind comercial) = SEÑAL.
//   2. Se relee la verdad autorizada (store compartido: cola del vendedor / pendientes de Dirección).
//   3. Solo si la solicitud SIGUE accionable se muestra la tarjeta; si se resolvió, desaparece sola.
// Descartar NO resuelve el trabajo: la solicitud sigue en Inicio, Mi bandeja y Conversaciones /
// Atención comercial. Entre pestañas solo una presenta la misma señal (dedupe de presentación; la
// idempotencia real es event_key único en la base). Sin sonido ni notificaciones del navegador.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { capitalizarNombre } from '../lib/nombres'
import { Icon } from './icons'
import { useRole } from '../auth/RoleContext'
import type { RoleKey } from './roles'
import { onNuevaNotificacion, markRead, type Notif } from '../data/store/notificationsStore'
import { fuenteComercial, getEstadoAtencion, recargarAtencion, useAtencionComercial, type EstadoAtencionComercial } from '../data/store/atencionStore'
import { alertaAccionable, lineasSolicitud, KINDS_COMERCIALES, type AlertaAccionable } from '../data/ops/atencionComercial'
import { irAConversacion, irASolicitud } from '../data/store/navIntentStore'
import { escucharPestanas, limpiarVencidos, marcar, reclamar, yaPresentado } from '../lib/avisosPestanas'

interface Senal { clave: string; notifId: string; kind: string; conversationId: string }
const MAX_VISIBLES = 3
const fuenteDe = (e: EstadoAtencionComercial) => (e.fuente === 'vendedor' ? { tipo: 'vendedor' as const, cola: e.cola } : { tipo: 'direccion' as const, conversaciones: e.pendientes?.conversaciones ?? [] })

export function AlertaComercial() {
  const { role, capabilities, setScreen } = useRole()
  const fuente = fuenteComercial(role as RoleKey, capabilities)
  const est = useAtencionComercial(fuente)
  const [senales, setSenales] = useState<Senal[]>([])
  const ocultas = useRef<Senal[]>([])   // llegaron con la pestaña oculta: se deciden al volver

  const presentar = useCallback((s: Senal) => {
    // Un aviso viejo o ya resuelto no revive trabajo: sin estado accionable no se presenta ni se reclama.
    if (!alertaAccionable(s.kind, s.conversationId, fuenteDe(getEstadoAtencion()))) return
    if (!reclamar(s.clave)) return   // otra pestaña ya la presentó (o se descartó)
    setSenales((xs) => (xs.some((x) => x.clave === s.clave) ? xs : [s, ...xs]))
  }, [])

  useEffect(() => {
    if (!fuente) return
    limpiarVencidos()
    const quitarSenal = onNuevaNotificacion((n: Notif) => {
      if (!n.kind || !KINDS_COMERCIALES.has(n.kind) || !n.conversationId) return
      const s: Senal = { clave: n.eventKey ?? n.id, notifId: n.id, kind: n.kind, conversationId: n.conversationId }
      // La verdad se relee ANTES de decidir (el store colapsa lecturas simultáneas).
      void recargarAtencion().then(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') { ocultas.current.push(s); return }
        presentar(s)
      })
    })
    const alVolver = () => {
      if (document.visibilityState !== 'visible' || ocultas.current.length === 0) return
      const pendientes = ocultas.current; ocultas.current = []
      void recargarAtencion().then(() => pendientes.forEach((s) => { if (!yaPresentado(s.clave)) presentar(s) }))
    }
    document.addEventListener('visibilitychange', alVolver)
    // Otra pestaña la descartó o la atendió → también se quita aquí.
    const quitarPestanas = escucharPestanas((clave, e) => { if (e !== 'visto') setSenales((xs) => xs.filter((x) => x.clave !== clave)) })
    return () => { quitarSenal(); quitarPestanas(); document.removeEventListener('visibilitychange', alVolver) }
  }, [fuente, presentar])

  if (!fuente) return null
  // Se recalcula con CADA lectura del servidor: lo que ya no es accionable desaparece sin intervención.
  const visibles = senales
    .map((s) => ({ s, a: alertaAccionable(s.kind, s.conversationId, fuenteDe(est)) }))
    .filter((x): x is { s: Senal; a: AlertaAccionable } => !!x.a)
    // Una tarjeta por conversación (p. ej. asignación + recordatorio de la misma solicitud).
    .filter((x, i, arr) => arr.findIndex((y) => y.a.item.conversation_id === x.a.item.conversation_id) === i)
    .slice(0, MAX_VISIBLES)

  const cerrar = (s: Senal, e: 'descartado' | 'atendido') => {
    marcar(s.clave, e)
    markRead(s.notifId)
    setSenales((xs) => xs.filter((x) => x.clave !== s.clave))
  }

  return (
    <div className="rc-al-wrap" role="region" aria-label="Alertas comerciales" data-testid="alertas-comerciales">
      {visibles.map(({ s, a }) => <Tarjeta key={s.clave} a={a}
        onAccion={(reasignar) => {
          cerrar(s, 'atendido')
          if (a.tipo === 'vendedor') irAConversacion(setScreen, a.item.conversation_id, { iniciar: true, origen: 'alerta' })
          else irASolicitud(setScreen, a.item.conversation_id, { reasignar, origen: 'alerta' })
        }}
        onDescartar={() => cerrar(s, 'descartado')} />)}
    </div>
  )
}

function Tarjeta({ a, onAccion, onDescartar }: { a: AlertaAccionable; onAccion: (reasignar: boolean) => void; onDescartar: () => void }) {
  const escalada = a.item.atencion?.estado === 'escalado'
  const nombre = capitalizarNombre(a.tipo === 'vendedor' ? a.item.dueno : a.item.nombre)
  const titulo = a.tipo === 'vendedor'
    ? `${nombre} solicita atención`
    : escalada ? `${nombre} sigue esperando asesor` : `${nombre} solicita asesor sin vendedor`
  const kicker = a.tipo === 'vendedor' ? (a.kind === 'handoff_aviso' ? 'Recordatorio · solicitud de asesor' : 'Nueva solicitud de asesor') : escalada ? 'Escalada a Dirección' : 'Sin vendedor elegible'
  const lineas = [
    a.tipo === 'direccion' ? (a.item.seller_nombre ? `Asignada a ${a.item.seller_nombre}` : 'Nadie la atiende todavía') : null,
    ...lineasSolicitud(a.item),
  ].filter((x): x is string => !!x).slice(0, 4)
  const peligro = escalada || a.tipo === 'direccion'
  return (
    <article className={`rc-al${peligro ? ' rc-al--dang' : ''}`} role="alert" aria-live="assertive" data-testid="alerta-comercial">
      <div className="rc-al-top">
        <span className="rc-al-ic" aria-hidden><Icon name="chat" /></span>
        <div className="rc-al-tx">
          <div className="rc-al-kicker">{kicker}</div>
          <div className="rc-al-title">{titulo}</div>
          {lineas.length > 0 && <ul className="rc-al-lines">{lineas.map((l) => <li key={l}>{l}</li>)}</ul>}
        </div>
        <button type="button" className="rc-al-x" onClick={onDescartar} aria-label="Descartar alerta (la solicitud sigue en Inicio)" title="Descartar" data-testid="alerta-descartar"><Icon name="x" /></button>
      </div>
      <div className="rc-al-ctas">
        {a.tipo === 'vendedor'
          ? <button type="button" className="btn btn-primary rh-btn" onClick={() => onAccion(false)} data-testid="alerta-atender">Atender ahora</button>
          : <>
            <button type="button" className="btn ghost rh-btn" onClick={() => onAccion(false)} data-testid="alerta-abrir">Abrir</button>
            <button type="button" className="btn btn-primary rh-btn" onClick={() => onAccion(true)} data-testid="alerta-reasignar">{a.item.seller_id ? 'Reasignar' : 'Asignar'}</button>
          </>}
      </div>
      <div className="rc-al-nota">Descartar no la resuelve: sigue en Inicio.</div>
    </article>
  )
}
