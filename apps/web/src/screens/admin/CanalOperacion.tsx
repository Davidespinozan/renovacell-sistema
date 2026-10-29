// R4-B2-4 · PANEL OPERATIVO MÍNIMO de canales (Dirección), dentro de Conversaciones → Bandeja → Canales:
//   · Estado y controles de WhatsApp (espejo/activo, IA, envíos, compuerta, última modificación, historial). Cada cambio
//     pide confirmación y motivo; activar o encender la IA se ofrece deshabilitado mientras la compuerta esté cerrada.
//     Instagram y Facebook se muestran solo como estado (su activación comercial no es de este bloque).
//   · Salidas por revisar: retenidos e inciertos con selección múltiple, motivo obligatorio y resultado por mensaje;
//     un incierto solo se descarta (nunca se reenvía); descartados como historial.
//   · Atención humana: qué conversaciones atiende una persona y quién.
//   · BarraTomaCanal: en una conversación abierta, quién la atiende, "Tomar conversación" y por qué no se puede escribir.
// La autoridad es la base (B2-1, B2-2, B2-3b, B2-4): aquí no se decide nada que el servidor no vuelva a validar.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import {
  accionesCanal, canalOperacion as clientePorDefecto, ETIQUETA_RESULTADO, MAX_SELECCION, MOTIVO_MIN, MOTIVO_NO_ESCRIBIR, MOTIVO_NO_TOMAR, NOMBRE_CANAL_OP,
  resumenOperativo, textoAtiende, type CambiosCanal, type CanalOp, type ClienteCanalOperacion, type ControlCanal, type ControlConversacion,
  type Decision, type EstadoCanales, type PanelCanal, type RevisionSalidas,
} from '../../data/ops/canalOperacion'
import { ZONA_NEGOCIO } from '../../data/periodo'

const PILL: Record<string, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu', ok: 'p-ok' }
const campo: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontFamily: 'inherit', fontSize: 13.5, minHeight: 40 }
const fecha = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ZONA_NEGOCIO })
}
const textoControl = (c: Partial<ControlCanal> | null | undefined) => !c ? '—'
  : [c.modo === 'activo' ? 'activo' : c.modo === 'espejo' ? 'espejo' : c.modo === 'prueba' ? 'prueba' : null, c.ia_habilitada != null ? (c.ia_habilitada ? 'IA encendida' : 'IA apagada') : null, c.envio_pausado != null ? (c.envio_pausado ? 'envíos pausados' : 'envíos habilitados') : null].filter(Boolean).join(' · ')

function Modal({ titulo, sub, onCerrar, children, testid }: { titulo: string; sub?: string; onCerrar: () => void; children: React.ReactNode; testid: string }) {
  const caja = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    caja.current?.querySelector<HTMLElement>('textarea, select, button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previo?.focus?.() }
  }, [onCerrar])
  return createPortal(
    <div className="overlay" onClick={onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={`${testid}-t`} onClick={(e) => e.stopPropagation()} data-testid={testid} ref={caja}>
        <div className="mhead">
          <div><h3 id={`${testid}-t`}>{titulo}</h3>{sub && <div className="ms">{sub}</div>}</div>
          <button className="mclose" type="button" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="mbody" style={{ display: 'grid', gap: 12 }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/** Confirmación con motivo. `minimo` = mínimo del servidor (0 = opcional). */
function Confirmar({ titulo, explica, boton, peligro, minimo = MOTIVO_MIN, onConfirmar, onCerrar, testid }: {
  titulo: string; explica: React.ReactNode; boton: string; peligro?: boolean; minimo?: number
  onConfirmar: (motivo: string) => Promise<string | null>; onCerrar: () => void; testid: string
}) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const valido = motivo.trim().length >= minimo
  const enviar = async () => {
    if (!valido || ocupado) return
    setOcupado(true); setError(null)
    const e = await onConfirmar(motivo.trim())
    setOcupado(false)
    if (e) setError(e)
  }
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} testid={testid}>
      <div className={`rh-note ${peligro ? 'rh-note--warn' : 'rh-note--neu'}`}><span>{explica}</span></div>
      <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>{minimo > 0 ? `Motivo (obligatorio, mínimo ${minimo} caracteres)` : 'Motivo (opcional)'}
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} rows={2} style={{ ...campo, resize: 'vertical' }} data-testid={`${testid}-motivo`} />
      </label>
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }} data-testid={`${testid}-error`}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={!valido || ocupado} onClick={() => void enviar()} data-testid={`${testid}-confirmar`}>{boton}</button>
      </div>
    </Modal>
  )
}

type Accion = { clave: string; titulo: string; boton: string; explica: React.ReactNode; cambios: CambiosCanal; peligro?: boolean }

export function PanelOperativoCanal({ cliente = clientePorDefecto, canal = 'whatsapp', nombres = {}, onAbrir }: {
  cliente?: ClienteCanalOperacion; canal?: CanalOp; nombres?: Record<string, string>; onAbrir?: (conversationId: string) => void
}) {
  const [estado, setEstado] = useState<EstadoCanales | null>(null)
  const [rev, setRev] = useState<RevisionSalidas | null>(null)
  const [panel, setPanel] = useState<PanelCanal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(async () => {
    const [e, r, p] = await Promise.all([cliente.estado(), cliente.revision(canal), cliente.panel(canal)])
    if (!e.ok) { setError(e.error); return }
    setError(null); setEstado(e.data)
    if (r.ok) setRev(r.data); else setError(r.error)
    if (p.ok) setPanel(p.data); else setError(p.error)
  }, [cliente, canal])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { const t = setInterval(() => { if (!accion) void cargar() }, 30_000); return () => clearInterval(t) }, [cargar, accion])

  const c = estado?.canales.find((x) => x.canal === canal) ?? null
  const otros = (estado?.canales ?? []).filter((x) => x.canal !== canal)
  const historial = (estado?.historial ?? []).filter((h) => h.canal === canal).slice(0, 10)
  const resumen = c && estado ? resumenOperativo(c, estado.activacion_disponible, rev, panel, estado.prueba) : []
  const pendientes = (rev?.conteos?.retenido ?? 0) + (rev?.conteos?.incierto ?? 0)
  const nombre = NOMBRE_CANAL_OP[canal]

  const ejecutar = async (a: Accion, motivo: string): Promise<string | null> => {
    const r = await cliente.cambiar(canal, a.cambios, motivo)
    if (!r.ok) return r.error
    setAccion(null); setAviso(r.data.cambiado ? `${nombre}: cambio aplicado.` : `${nombre}: ya estaba así; no hubo cambio.`)
    await cargar(); return null
  }

  if (error && !estado) return <div role="alert" className="card" style={{ color: 'var(--danger)' }} data-testid="panel-canal-error">{error}</div>
  if (!estado || !c) return <div className="card" style={{ color: 'var(--ink-3)' }}>Cargando operación de {nombre}…</div>
  const ac = accionesCanal(c, estado.activacion_disponible, estado.prueba)
  // R4-C5 · el estado real del modo prueba (contactos vigentes, número enmascarado y vencimiento), nunca disfrazado de espejo
  const pr = c.modo === 'prueba' ? estado.prueba : null
  const textoModo = c.modo === 'activo' ? 'Activo' : c.modo === 'prueba'
    ? (pr?.operativa ? `Prueba · ${pr.vigentes} ${pr.vigentes === 1 ? 'contacto autorizado' : 'contactos autorizados'}` : 'Prueba · sin contactos vigentes (inoperante)') : 'Espejo'
  const boton = (k: string, a: { visible: boolean; habilitada: boolean; porque: string | null }, texto: string, etiqueta: Accion, primario = false) => !a.visible ? null : (
    <span key={k} style={{ display: 'inline-grid', gap: 2 }}>
      <button type="button" className={primario ? 'btn btn-primary' : 'btn'} style={{ minHeight: 40 }} disabled={!a.habilitada} onClick={() => setAccion(etiqueta)} data-testid={`ctl-${k}`} title={a.porque ?? undefined}>{texto}</button>
      {!a.habilitada && a.porque && <span style={{ fontSize: 11.5, color: 'var(--ink-3)', maxWidth: 260 }} data-testid={`ctl-${k}-porque`}>{a.porque}</span>}
    </span>
  )

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }} data-testid="panel-canal">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>Operación de {nombre}</b>
        {resumen.map((l) => <span key={l.testid} className={'pill ' + PILL[l.tono]} data-testid={l.testid}>{l.texto}</span>)}
        <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} data-testid="panel-canal-detalle">{abierto ? 'Ocultar controles' : `Controles${pendientes ? ` · ${pendientes} por revisar` : ''}`}</button>
      </div>
      {aviso && <div role="status" style={{ color: 'var(--green-deep)', fontSize: 13 }} data-testid="panel-canal-aviso">{aviso}</div>}
      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}

      {abierto && <>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,170px),1fr))', gap: '4px 16px', margin: 0, fontSize: 13 }}>
          <Dato t="Canal" v={textoModo} testid="dato-modo" />
          {c.modo === 'prueba' && <Dato t="Contactos de prueba" v={pr && pr.permisos.length ? pr.permisos.map((p) => `${p.contacto} · vence ${fecha(p.vence_at)}`).join(' · ') : 'Ninguno vigente'} testid="dato-prueba" />}
          <Dato t="Asistente (IA)" v={c.ia_habilitada ? 'Encendida' : 'Apagada'} testid="dato-ia" />
          <Dato t="Envíos" v={c.envio_pausado ? 'Pausados' : 'Habilitados'} testid="dato-envio" />
          <Dato t="Compuerta de activación" v={estado.activacion_disponible ? 'Abierta' : 'Cerrada'} testid="dato-compuerta" />
          <Dato t="Última modificación" v={fecha(c.updated_at)} testid="dato-modificado" />
        </dl>
        {!estado.activacion_disponible && (
          <div className="rh-note rh-note--neu" data-testid="explica-compuerta"><span><b>Compuerta cerrada.</b> El servidor no permite activar {nombre} ni encender la IA hasta completar y autorizar la puesta en marcha. Pausar, apagar la IA y volver a espejo siguen disponibles.</span></div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {boton('activar', ac.activar, 'Activar canal', { clave: 'activar', titulo: `Activar ${nombre}`, boton: 'Activar', cambios: { modo: 'activo' }, peligro: true, explica: <>Las respuestas desde el sistema empezarán a salir por {nombre} a clientes reales. Leadsales deja de ser el único que contesta.</> }, true)}
          {boton('espejo', ac.espejo, 'Volver a espejo', { clave: 'espejo', titulo: `Volver ${nombre} a espejo`, boton: 'Volver a espejo', cambios: { modo: 'espejo' }, peligro: true, explica: <>Se deja de responder desde aquí y la IA se apaga en el mismo cambio. Lo que esté por salir queda <b>retenido</b> para revisión.{c.modo === 'prueba' ? <> Los contactos de prueba vigentes quedan <b>revocados</b> (se conservan en el historial).</> : null}</> })}
          {boton('encender-ia', ac.encenderIA, 'Encender IA', { clave: 'encender-ia', titulo: 'Encender el asistente (IA)', boton: 'Encender IA', cambios: { ia_habilitada: true }, peligro: true, explica: <>El asistente contestará primero cada mensaje nuevo de {nombre} y transferirá a una persona cuando haga falta.</> })}
          {boton('apagar-ia', ac.apagarIA, 'Apagar IA', { clave: 'apagar-ia', titulo: 'Apagar el asistente (IA)', boton: 'Apagar IA', cambios: { ia_habilitada: false }, explica: <>Los mensajes nuevos pasan directo a una persona (solicitud de asesor). Lo ya escrito no cambia.</> })}
          {boton('pausar', ac.pausar, 'Pausar envíos', { clave: 'pausar', titulo: `Pausar envíos de ${nombre}`, boton: 'Pausar', cambios: { envio_pausado: true }, peligro: true, explica: <>Nada sale por {nombre}. Lo pendiente y lo nuevo quedan <b>retenidos</b> hasta que Dirección decida.</> })}
          {boton('reanudar', ac.reanudar, 'Reanudar envíos', { clave: 'reanudar', titulo: `Reanudar envíos de ${nombre}`, boton: 'Reanudar', cambios: { envio_pausado: false }, explica: <>Lo nuevo vuelve a salir. <b>Lo retenido NO sale solo:</b> se revisa abajo y se libera o descarta.</> })}
        </div>

        {otros.length > 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }} data-testid="otros-canales">
            Otros canales (solo estado): {otros.map((o) => <span key={o.canal} className="pill p-neu" style={{ marginLeft: 6 }} data-testid={`otro-${o.canal}`}>{NOMBRE_CANAL_OP[o.canal]}: {textoControl(o)}</span>)}
          </div>
        )}

        <RevisionDeSalidas canal={canal} rev={rev} cliente={cliente} onCambio={cargar} />

        {panel && <AtencionHumanaLista panel={panel} nombres={nombres} onAbrir={onAbrir} />}

        <details data-testid="historial-cambios">
          <summary style={{ cursor: 'pointer', fontSize: 13 }}>Historial reciente de cambios ({historial.length})</summary>
          {historial.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6 }}>Sin cambios registrados.</div> : (
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4, fontSize: 12.5 }}>
              {historial.map((h, i) => (
                <li key={i} data-testid="historial-fila" style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                  <b>{fecha(h.at)}</b> · {h.actor ?? (h.origen === 'rpc' ? 'Dirección' : 'Sistema')}: {textoControl(h.antes)} → {textoControl(h.despues)}{h.motivo ? <span style={{ color: 'var(--ink-3)' }}> · “{h.motivo}”</span> : null}
                </li>
              ))}
            </ul>
          )}
        </details>

        {panel && panel.descartados.length > 0 && (
          <details data-testid="historial-descartados">
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>Mensajes descartados ({rev?.conteos?.descartado ?? panel.descartados.length}) · historial</summary>
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 4, fontSize: 12.5 }}>
              {panel.descartados.map((d) => (
                <li key={d.id} data-testid="descartado-fila" style={{ borderBottom: '1px solid var(--line)', padding: '4px 0' }}>
                  <b>{fecha(d.decidido_at)}</b> · {d.decidido_por ?? 'Dirección'}{d.motivo ? ` · “${d.motivo}”` : ''}<div style={{ color: 'var(--ink-3)', overflowWrap: 'anywhere' }}>{d.texto}</div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </>}

      {accion && <Confirmar testid={`confirmar-${accion.clave}`} titulo={accion.titulo} explica={accion.explica} boton={accion.boton} peligro={accion.peligro}
        onConfirmar={(m) => ejecutar(accion, m)} onCerrar={() => setAccion(null)} />}
    </div>
  )
}

function Dato({ t, v, testid }: { t: string; v: string; testid?: string }) {
  return <div style={{ minWidth: 0 }}><dt style={{ color: 'var(--mid)', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }} data-testid={testid}>{v}</dd></div>
}

export function RevisionDeSalidas({ canal, rev, cliente, onCambio }: { canal: CanalOp; rev: RevisionSalidas | null; cliente: ClienteCanalOperacion; onCambio: () => Promise<void> | void }) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [accion, setAccion] = useState<'liberar' | 'descartar' | null>(null)
  const [resultado, setResultado] = useState<Decision | null>(null)
  const filas = rev?.por_decidir ?? []
  const elegidas = useMemo(() => filas.filter((f) => sel.has(f.id)), [filas, sel])
  useEffect(() => { setSel((s) => new Set([...s].filter((id) => filas.some((f) => f.id === id)))) }, [rev])   // lo que ya no está por decidir sale de la selección
  const hayInciertos = elegidas.some((f) => f.estado === 'incierto')
  const puedeLiberar = !!rev?.envio_habilitado && elegidas.length > 0 && !hayInciertos
  const porqueNoLiberar = !rev?.envio_habilitado ? 'Para liberar, el canal debe estar activo y sin pausa.' : hayInciertos ? 'Un mensaje incierto no se libera: pudo haber llegado. Solo se descarta tras revisarlo.' : null
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < MAX_SELECCION) n.add(id); return n })
  const decidir = async (motivo: string): Promise<string | null> => {
    if (!accion) return null
    const r = await cliente.decidir(canal, elegidas.map((f) => f.id), accion, motivo)
    if (!r.ok) return r.error
    setResultado(r.data); setAccion(null); setSel(new Set()); await onCambio(); return null
  }
  const [textos, setTextos] = useState<Record<string, string>>({})
  useEffect(() => { setTextos((t) => ({ ...t, ...Object.fromEntries(filas.map((f) => [f.id, f.texto])) })) }, [rev])

  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="revision-salidas">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13.5 }}>Salidas por revisar</b>
        <span className={'pill ' + ((rev?.conteos?.retenido ?? 0) ? 'p-warn' : 'p-neu')} data-testid="n-retenidos">{rev?.conteos?.retenido ?? 0} {(rev?.conteos?.retenido ?? 0) === 1 ? 'retenido' : 'retenidos'}</span>
        <span className={'pill ' + ((rev?.conteos?.incierto ?? 0) ? 'p-dang' : 'p-neu')} data-testid="n-inciertos">{rev?.conteos?.incierto ?? 0} {(rev?.conteos?.incierto ?? 0) === 1 ? 'incierto' : 'inciertos'}</span>
        <span className="pill p-neu" data-testid="n-descartados">{rev?.conteos?.descartado ?? 0} {(rev?.conteos?.descartado ?? 0) === 1 ? 'descartado' : 'descartados'}</span>
      </div>
      {filas.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }} data-testid="sin-revision">No hay mensajes retenidos ni inciertos.</div> : <>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}><b>Retenido</b>: no salió (pausa o espejo); se libera o se descarta. <b>Incierto</b>: se intentó enviar y no hubo confirmación de Meta: <b>pudo haber llegado</b>; revísalo en el teléfono y, si hace falta, escribe de nuevo desde la conversación. No se reenvía desde aquí.</div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {filas.map((f) => (
            <li key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid var(--line)', borderLeft: `4px solid var(--${f.estado === 'incierto' ? 'danger' : 'warn'})`, borderRadius: 10, padding: '8px 10px' }} data-testid="salida-fila">
              <input type="checkbox" checked={sel.has(f.id)} onChange={() => alternar(f.id)} aria-label="Seleccionar mensaje" style={{ marginTop: 3, width: 18, height: 18 }} data-testid="salida-check" />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={'pill ' + (f.estado === 'incierto' ? 'p-dang' : 'p-warn')} data-testid="salida-estado">{f.estado === 'incierto' ? 'Incierto · no confirmado' : 'Retenido · no enviado'}</span>
                  {f.contacto && <span style={{ color: 'var(--ink-3)' }}>{f.contacto}</span>}
                  <span style={{ color: 'var(--ink-3)' }}>{fecha(f.creado)}</span>
                  {f.estado === 'retenido' && f.ventana_abierta === false && <span className="pill p-neu" data-testid="salida-fuera-ventana">Fuera de la ventana de 24 h</span>}
                </div>
                <div style={{ overflowWrap: 'anywhere', marginTop: 2 }}>{f.texto}</div>
              </div>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }} data-testid="n-seleccion">{elegidas.length} {elegidas.length === 1 ? 'seleccionado' : 'seleccionados'} · máximo {MAX_SELECCION}</span>
          <button type="button" className="btn" style={{ minHeight: 40 }} disabled={!puedeLiberar} onClick={() => setAccion('liberar')} data-testid="btn-liberar" title={porqueNoLiberar ?? undefined}>Liberar</button>
          <button type="button" className="btn" style={{ minHeight: 40 }} disabled={elegidas.length === 0} onClick={() => setAccion('descartar')} data-testid="btn-descartar">Descartar</button>
          {elegidas.length > 0 && porqueNoLiberar && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }} data-testid="porque-no-liberar">{porqueNoLiberar}</span>}
        </div>
      </>}
      {resultado && (
        <div className="rh-note rh-note--neu" role="status" data-testid="resultado-decision">
          <span><b>{resultado.aplicados} de {resultado.total}</b> {resultado.accion === 'liberar' ? (resultado.aplicados === 1 ? 'liberado' : 'liberados') : (resultado.aplicados === 1 ? 'descartado' : 'descartados')}.
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {resultado.resultados.map((x) => <li key={x.id} data-testid="resultado-fila"><span style={{ color: 'var(--ink-3)' }}>{(textos[x.id] ?? '').slice(0, 60)}</span> — {ETIQUETA_RESULTADO[x.resultado] ?? x.resultado}</li>)}
            </ul>
          </span>
        </div>
      )}
      {accion && <Confirmar testid={`confirmar-${accion}`} titulo={accion === 'liberar' ? `Liberar ${elegidas.length} ${elegidas.length === 1 ? 'mensaje' : 'mensajes'}` : `Descartar ${elegidas.length} ${elegidas.length === 1 ? 'mensaje' : 'mensajes'}`}
        explica={accion === 'liberar' ? <>Vuelven a la cola y salen por {NOMBRE_CANAL_OP[canal]}. El servidor no libera los que estén fuera de la ventana de 24 h.</> : <>No se enviarán nunca. Quedan en el historial con tu nombre y el motivo.</>}
        boton={accion === 'liberar' ? 'Liberar' : 'Descartar'} peligro onConfirmar={decidir} onCerrar={() => setAccion(null)} />}
    </div>
  )
}

function AtencionHumanaLista({ panel, nombres, onAbrir }: { panel: PanelCanal; nombres: Record<string, string>; onAbrir?: (id: string) => void }) {
  const filas = panel.atencion_humana
  return (
    <div style={{ display: 'grid', gap: 6 }} data-testid="atencion-humana">
      <b style={{ fontSize: 13.5 }}>Atención por personas ({filas.length})</b>
      {filas.length === 0 ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Ninguna conversación con atención humana pedida o en curso.</div> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
          {filas.map((h) => (
            <li key={h.conversation_id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--line)' }} data-testid="humana-fila">
              <span style={{ flex: 1, minWidth: 160 }}>{nombres[h.conversation_id] ?? 'Contacto'}</span>
              <span className={'pill ' + (h.atiende ? 'p-ok' : 'p-warn')} data-testid="humana-quien">
                {h.atiende === 'direccion' ? `${h.soy_yo ? 'Tú' : h.atiende_nombre ?? 'Dirección'} · Dirección` : h.atiende === 'vendedor' ? (h.soy_yo ? 'Tú' : h.atiende_nombre ?? 'Vendedora') : h.atiende_nombre ? `Asignada a ${h.atiende_nombre} · sin iniciar` : 'Esperando asesor'}
              </span>
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{fecha(h.desde)}</span>
              {onAbrir && <button type="button" className="btn ghost sm" onClick={() => onAbrir(h.conversation_id)} data-testid="humana-abrir">Ver</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** En una conversación de canal abierta: quién la atiende, "Tomar conversación" y si se puede escribir (y por qué no). */
export function BarraTomaCanal({ conversationId, cliente = clientePorDefecto, onControl, intervaloMs = 10_000 }: {
  conversationId: string; cliente?: ClienteCanalOperacion; onControl?: (c: ControlConversacion | null) => void; intervaloMs?: number
}) {
  const [ctl, setCtl] = useState<ControlConversacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const r = await cliente.control(conversationId)
    if (!r.ok) { setError(r.error); setCtl(null); onControl?.(null); return }
    setError(null); setCtl(r.data); onControl?.(r.data)
  }, [cliente, conversationId, onControl])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => { const t = setInterval(() => { if (!confirmar) void cargar() }, intervaloMs); return () => clearInterval(t) }, [cargar, confirmar, intervaloMs])

  const tomar = async (motivo: string): Promise<string | null> => {
    const r = await cliente.tomar(conversationId, motivo)
    if (!r.ok) { await cargar(); return r.error }
    setConfirmar(false); setAviso(r.data.idempotente ? 'Ya la atendías tú.' : 'Tomaste la conversación: el asistente deja de responder y ahora contestas tú.')
    await cargar(); return null
  }
  if (error) return <div role="alert" className="rc-wa-aviso" data-testid="toma-error">{error}</div>
  if (!ctl || !ctl.canal) return null
  return (
    <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px' }} data-testid="barra-toma">
      <span className={'pill ' + (ctl.atiende === 'ia' ? 'p-ok' : ctl.atiende === 'nadie' ? 'p-neu' : ctl.soy_yo ? 'p-ok' : 'p-warn')} data-testid="toma-quien">{textoAtiende(ctl)}</span>
      {ctl.envio_pausado && <span className="pill p-dang" data-testid="toma-pausa">Envíos pausados: lo que escribas queda retenido</span>}
      <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: 'var(--ink-3)' }} data-testid="toma-explica">
        {ctl.puede_escribir ? 'Puedes responder; nadie más escribe mientras la atiendes.' : MOTIVO_NO_ESCRIBIR[ctl.motivo_no_escribir ?? ''] ?? 'Solo lectura.'}
      </span>
      {ctl.puede_tomar
        ? <button type="button" className="btn btn-primary" style={{ minHeight: 40 }} onClick={() => setConfirmar(true)} data-testid="btn-tomar">Tomar conversación</button>
        : ctl.motivo_no_tomar && ctl.motivo_no_tomar !== 'ya_es_tuya' && <span style={{ fontSize: 12, color: 'var(--ink-3)' }} data-testid="toma-no">{MOTIVO_NO_TOMAR[ctl.motivo_no_tomar] ?? ''}</span>}
      {aviso && <span role="status" style={{ fontSize: 12.5, color: 'var(--green-deep)', width: '100%' }} data-testid="toma-aviso">{aviso}</span>}
      {confirmar && <Confirmar testid="confirmar-toma" titulo="Tomar conversación" minimo={0} boton="Tomar"
        explica={<>Pasas a atenderla tú: el asistente deja de responder y nadie más escribe aquí. No se crea otra solicitud ni cambia su vendedor de cartera; el historial se conserva.</>}
        onConfirmar={tomar} onCerrar={() => setConfirmar(false)} />}
    </div>
  )
}
