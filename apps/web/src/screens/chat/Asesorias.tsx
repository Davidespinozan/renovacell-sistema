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
import { ChatCanonico } from './ChatCanonico'
import { useRole } from '../../auth/RoleContext'

const PILL: Record<string, string> = { dang: 'p-dang', warn: 'p-warn', neu: 'p-neu', ok: 'p-ok' }

export function Asesorias({ cliente = clientePorDefecto, intervaloMs = 8000, esDireccion = false, onAtencion }: { cliente?: ClienteChat; intervaloMs?: number; esDireccion?: boolean; onAtencion?: () => void }) {
  const [cola, setCola] = useState<ColaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [llegada, setLlegada] = useState<string | null>(null)       // fila resaltada al volver de una apertura profunda
  const [aviso, setAviso] = useState<string | null>(null)
  const [enfocar, setEnfocar] = useState(false)
  const intento = useIntento('asesorias')

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
      if (!c) { setAviso('Esa conversación ya no está en tu cola: se atendió, se reasignó o no tienes acceso a ella.'); return }
      setAviso(null)
      if (intento.iniciar) await atender(c)
      else { setLlegada(c.conversation_id); setEnfocar(true); setAbierta(c.conversation_id) }
    })()
    return () => { vivo = false }
  }, [intento, cargar, atender])

  if (abierta) return (
    <div className="grid" style={{ gap: 8 }}>
      {aviso && <div className="rc-aviso-nav" role="status">{aviso}</div>}
      <ChatCanonico embebido asesor conversationId={abierta} cliente={cliente} autoFoco={enfocar} onSalir={() => { setAbierta(null); setEnfocar(false); void cargar(); void recargarAtencion() }} />
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
      <h2 style={{ margin: '0 0 4px' }}>Conversaciones con clientes</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--ink-3, #667)', fontSize: 13 }}>
        {esDireccion ? 'Todas las conversaciones con atención humana. Los clientes sin vendedor se asignan en Atención comercial.' : 'Tus clientes que activaron un carrito o pidieron hablar contigo. El asistente los atiende hasta que inicies la asesoría.'}
      </p>
      {aviso && <div className="rc-aviso-nav" role="status" data-testid="aviso-apertura">{aviso}</div>}
      {error && <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {cargando && <div style={{ color: 'var(--ink-3, #667)' }}>Cargando…</div>}
      {!cargando && cola.length === 0 && !error && <div style={{ color: 'var(--ink-3, #667)' }}>No hay conversaciones esperando asesor.</div>}
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
