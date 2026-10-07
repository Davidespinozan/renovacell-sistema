// Chat V2-C3 · HISTORIAL DE SESIONES (solo lectura). Lista ligera de sesiones (cc_sesiones_listar) y lector de
// UNA sesión (cc_sesion_leer), ambos por la Edge chat (acciones `sesiones` / `leer_sesion`). La autoridad es
// el servidor (C1): aquí no se decide qué sesión existe, ni se agrupan mensajes por fechas, ni se escribe.
// Este módulo NO recibe ninguna mutación: solo un lector con dos métodos de lectura.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { Mensaje, SesionListada, SesionResumen } from '../../data/ops/chat'
import { cantidadMensajes, diaEtiqueta, etiquetaActor, horaNegocio, motivoCierre, quienAtendio, rangoSesion, type Visor } from '../../data/ops/sesionesPresentacion'

type Res<T> = { ok: true; data: T } | { ok: false; error: { codigo: string; mensaje: string } }
/** Únicas capacidades del historial: leer. (ClienteChat las cumple; no se le pasa nada más.) */
export interface LectorSesiones {
  sesiones(conversationId: string): Promise<Res<{ conversation_id: string; sesiones: SesionListada[] }>>
  leerSesion(sessionId: string, desdeSeq?: number): Promise<Res<{ sesion: SesionResumen & { asesor_nombre: string | null }; rol: string; solo_lectura: boolean; mensajes: Mensaje[] }>>
}
export interface CacheSesion { meta: SesionResumen & { asesor_nombre: string | null }; mensajes: Mensaje[]; completa: boolean }
export const ETIQUETA_ASESOR_HIST = 'Asesora'
const PAGINA = 100   // límite que fija la Edge `leer_sesion`
const SIN_ACCESO = 'No tienes acceso a esta conversación anterior.'

type Vista = { tipo: 'lista' } | { tipo: 'sesion'; id: string }

/**
 * Contenedor: lista → sesión → lista. `cache` vive en quien lo monta (misma instancia del chat): una sesión
 * cerrada es inmutable y no se vuelve a descargar. `onActual` vuelve a la conversación actual.
 */
export function HistorialConversacion({ conversationId, lector, visor, nombreCliente, cache, inicial, onActual, etiquetaVolver = 'Conversación actual', etiquetaFin = 'Volver a la conversación actual' }: {
  conversationId: string; lector: LectorSesiones; visor: Visor; nombreCliente?: string | null; cache: Map<string, CacheSesion>
  inicial?: string | null; onActual: () => void; etiquetaVolver?: string; etiquetaFin?: string
}) {
  const [vista, setVista] = useState<Vista>(inicial ? { tipo: 'sesion', id: inicial } : { tipo: 'lista' })
  const [lista, setLista] = useState<SesionListada[] | null>(null)
  const [errorLista, setErrorLista] = useState<string | null>(null)
  const raiz = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let vivo = true
    void lector.sesiones(conversationId).then((r) => {
      if (!vivo) return
      if (r.ok) { setLista(r.data.sesiones ?? []); setErrorLista(null) } else setErrorLista(r.error.codigo === 'no_autorizado' ? SIN_ACCESO : r.error.mensaje)
    })
    return () => { vivo = false }
  }, [lector, conversationId])

  // Escape sube un nivel (sesión → lista → actual) antes de que el cajón lo use para cerrarse.
  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.()
    if (vista.tipo === 'sesion') setVista({ tipo: 'lista' }); else onActual()
  }
  useEffect(() => { raiz.current?.querySelector<HTMLElement>('[data-foco]')?.focus() }, [vista])

  return (
    <div className="rc-hist" ref={raiz} onKeyDown={alTeclear} data-testid="historial">
      {vista.tipo === 'lista'
        ? <ListaSesiones sesiones={lista} error={errorLista} visor={visor} onAbrir={(id) => setVista({ tipo: 'sesion', id })} onActual={onActual} etiquetaVolver={etiquetaVolver} />
        : <LectorSesion key={vista.id} sessionId={vista.id} lector={lector} visor={visor} nombreCliente={nombreCliente} cache={cache} meta={lista?.find((s) => s.id === vista.id) ?? null}
            onLista={() => setVista({ tipo: 'lista' })} onActual={onActual} etiquetaFin={etiquetaFin} />}
    </div>
  )
}

export function ListaSesiones({ sesiones, error, visor, onAbrir, onActual, etiquetaVolver }: {
  sesiones: SesionListada[] | null; error: string | null; visor: Visor; onAbrir: (id: string) => void; onActual: () => void; etiquetaVolver: string
}) {
  return (
    <>
      <div className="rc-hist-head">
        <button type="button" className="rc-hist-back" onClick={onActual} data-foco data-testid="hist-volver"><ChevronLeft size={18} aria-hidden /> {etiquetaVolver}</button>
        <h3 className="rc-hist-title">Conversaciones anteriores</h3>
      </div>
      <div className="rc-hist-body">
        {error && <div className="rc-error rc-error--inline" role="alert" data-testid="hist-error">{error}</div>}
        {!error && sesiones === null && <div className="rc-sys">Cargando…</div>}
        {!error && sesiones?.length === 0 && <div className="rc-sys" data-testid="hist-vacio">Todavía no hay conversaciones anteriores.</div>}
        {!error && sesiones && sesiones.length > 0 && (
          <ul className="rc-hist-list" aria-label="Sesiones de esta conversación">
            {sesiones.map((s) => {
              const motivo = motivoCierre(s.close_reason, visor, s.asesor_nombre)
              return (
                <li key={s.id}>
                  <button type="button" className={`rc-hist-item${s.actual ? ' rc-hist-item--actual' : ''}`} onClick={() => (s.actual ? onActual() : onAbrir(s.id))} data-testid={s.actual ? 'hist-actual' : 'hist-sesion'}>
                    <span className="rc-hist-when">{rangoSesion(s)}{s.actual && <span className="rc-hist-badge">Actual</span>}</span>
                    <span className="rc-hist-who">{quienAtendio(s.asesor_nombre)} · {cantidadMensajes(s.n_mensajes)}</span>
                    {!s.actual && motivo && <span className="rc-hist-why">{motivo}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

function LectorSesion({ sessionId, lector, visor, nombreCliente, cache, meta, onLista, onActual, etiquetaFin }: {
  sessionId: string; lector: LectorSesiones; visor: Visor; nombreCliente?: string | null; cache: Map<string, CacheSesion>; meta: SesionListada | null
  onLista: () => void; onActual: () => void; etiquetaFin: string
}) {
  const [estado, setEstado] = useState<CacheSesion | null>(() => cache.get(sessionId) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const pedir = useCallback(async (previo: CacheSesion | null) => {
    setCargando(true)
    const desde = previo?.mensajes.length ? previo.mensajes[previo.mensajes.length - 1].seq : 0
    const r = await lector.leerSesion(sessionId, desde)
    setCargando(false)
    if (!r.ok) { setError(r.error.codigo === 'no_autorizado' ? SIN_ACCESO : r.error.mensaje); return }
    const vistos = new Set((previo?.mensajes ?? []).map((m) => m.seq))
    const mensajes = [...(previo?.mensajes ?? []), ...r.data.mensajes.filter((m) => !vistos.has(m.seq))]
    const ultimo = r.data.sesion.last_seq ?? null
    const completa = r.data.mensajes.length < PAGINA || (ultimo != null && mensajes.length > 0 && mensajes[mensajes.length - 1].seq >= ultimo)
    const nuevo: CacheSesion = { meta: r.data.sesion, mensajes, completa }
    if (r.data.sesion.estado === 'cerrada') cache.set(sessionId, nuevo)   // cerrada = inmutable
    setEstado(nuevo)
  }, [lector, sessionId, cache])

  useEffect(() => { if (!cache.get(sessionId)) void pedir(null) }, [cache, sessionId, pedir])

  const m = estado?.meta
  const fecha = diaEtiqueta(m?.opened_at ?? meta?.opened_at)
  return (
    <>
      <div className="rc-hist-head">
        <button type="button" className="rc-hist-back" onClick={onLista} data-testid="hist-atras"><ChevronLeft size={18} aria-hidden /> Conversaciones anteriores</button>
        <div className="rc-hist-banda" tabIndex={-1} data-foco data-testid="hist-banda">
          <b>Conversación anterior</b>{fecha && <> · {fecha}</>}
          {m && <span className="rc-hist-meta">{rangoSesion(m).replace(`${fecha} · `, '')} · {quienAtendio(m.asesor_nombre)}{motivoCierre(m.close_reason, visor, m.asesor_nombre) ? ` · ${motivoCierre(m.close_reason, visor, m.asesor_nombre)}` : ''}</span>}
        </div>
      </div>
      <div className="rc-thread rc-hist-thread" data-testid="hist-hilo">
        {error && <div className="rc-error rc-error--inline" role="alert" data-testid="hist-error">{error}</div>}
        {!error && !estado && <div className="rc-sys">Cargando conversación anterior…</div>}
        {estado && <HiloSoloLectura mensajes={estado.mensajes} visor={visor} nombreCliente={nombreCliente} nombreAsesor={estado.meta.asesor_nombre} />}
        {estado && !estado.completa && !error && (
          <div className="rc-hist-mas"><button type="button" className="rc-link" onClick={() => void pedir(estado)} disabled={cargando} data-testid="hist-cargar-mas">{cargando ? 'Cargando…' : 'Cargar más'}</button></div>
        )}
      </div>
      <div className="rc-hist-foot"><button type="button" className="btn rh-btn" onClick={onActual} data-testid="hist-volver-actual">{etiquetaFin}</button></div>
    </>
  )
}

/** Hilo de SOLO LECTURA (mismas burbujas que el chat; sin redactor, carrito, handoff ni acciones). */
export function HiloSoloLectura({ mensajes, visor, nombreCliente, nombreAsesor }: { mensajes: Mensaje[]; visor: Visor; nombreCliente?: string | null; nombreAsesor?: string | null }) {
  const out: React.ReactNode[] = []
  let diaPrevio = ''; let actorPrevio: string | null = null
  for (const m of mensajes) {
    const dia = diaEtiqueta(m.created_at)
    if (dia && dia !== diaPrevio) { out.push(<div key={`d-${m.seq}`} className="rc-day"><span>{dia}</span></div>); diaPrevio = dia; actorPrevio = null }
    if (m.actor === 'system') { out.push(<div key={m.id} className="rc-sys" data-testid="hist-msg-system">{m.content}</div>); actorPrevio = null; continue }
    const clave = m.propio ? 'own' : m.actor
    const inicio = clave !== actorPrevio; actorPrevio = clave
    const etiqueta = etiquetaActor(m, visor, { nombreCliente, nombreAsesor, etiquetaAsesor: ETIQUETA_ASESOR_HIST })
    out.push(
      <div key={m.id} className={`rc-msg rc-msg--${m.propio ? 'own' : m.actor}${inicio ? ' rc-msg--inicio' : ''}`} data-testid={`hist-msg-${m.actor}`}>
        {inicio && !m.propio && m.actor === 'ai' && <span className="rc-avatar" aria-hidden>R</span>}
        {inicio && !m.propio && m.actor !== 'ai' && <span className="rc-avatar rc-avatar--persona" aria-hidden>{(etiqueta ?? '?').slice(0, 1)}</span>}
        <div className="rc-bubble-wrap">
          {inicio && etiqueta && <div className="rc-meta">{etiqueta}</div>}
          <div className="rc-bubble">{m.content}</div>
          <time className="rc-hora" dateTime={m.created_at}>{horaNegocio(m.created_at)}</time>
        </div>
      </div>,
    )
  }
  return <>{out}</>
}
