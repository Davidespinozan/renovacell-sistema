// CC-2/CC-7 · Asesorías: la cola de quien atiende. El VENDEDOR ve solo sus conversaciones (su cartera
// o lo que Dirección le asignó) con el contexto comercial: carrito, fuera de horario, antigüedad y si
// ya inició la sesión. Ya no "toma" clientes de la cola: los clientes sin vendedor los asigna
// Dirección (Atención comercial), y esa asignación queda como cartera para compras futuras.
import React, { useCallback, useEffect, useState } from 'react'
import { chat as clientePorDefecto, ETIQUETA_MODO, type ClienteChat, type ColaItem } from '../../data/ops/chat'
import { MOTIVO_RUTEO } from '../../data/ops/atencion'
import { ChatCanonico } from './ChatCanonico'
import { useRole } from '../../auth/RoleContext'

export function Asesorias({ cliente = clientePorDefecto, intervaloMs = 8000, esDireccion = false, onAtencion }: { cliente?: ClienteChat; intervaloMs?: number; esDireccion?: boolean; onAtencion?: () => void }) {
  const [cola, setCola] = useState<ColaItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const r = await cliente.cola()
    if (!r.ok) { setError(r.error.mensaje); setCargando(false); return }
    setError(null); setCola(r.data.cola ?? []); setCargando(false)
  }, [cliente])

  useEffect(() => {
    void cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, intervaloMs)
    return () => clearInterval(t)
  }, [cargar, intervaloMs])

  if (abierta) return <ChatCanonico embebido asesor conversationId={abierta} cliente={cliente} onSalir={() => { setAbierta(null); void cargar() }} />

  const sinAsignar = cola.filter((c) => c.modo === 'human_requested' && !c.seller_profile_id)
  const mias = cola.filter((c) => c.es_mia)
  const otras = cola.filter((c) => !c.es_mia && !(c.modo === 'human_requested' && !c.seller_profile_id))

  return (
    <div className="card" data-testid="asesorias">
      <h2 style={{ margin: '0 0 4px' }}>Asesorías</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--ink-3, #667)', fontSize: 13 }}>
        {esDireccion ? 'Todas las conversaciones con atención humana. Los clientes sin vendedor se asignan en Atención comercial.' : 'Tus clientes que activaron un carrito o pidieron hablar contigo. El asistente los atiende hasta que inicies la asesoría.'}
      </p>
      {error && <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {cargando && <div style={{ color: 'var(--ink-3, #667)' }}>Cargando…</div>}
      {!cargando && cola.length === 0 && !error && <div style={{ color: 'var(--ink-3, #667)' }}>No hay conversaciones esperando asesor.</div>}
      {esDireccion && <Seccion titulo={`Sin vendedor (${sinAsignar.length})`} items={sinAsignar} accion={(c) => (
        <div style={{ display: 'flex', gap: 6 }}>
          {onAtencion && <button type="button" className="btn btn-primary" onClick={onAtencion} data-testid="btn-asignar">Asignar vendedor</button>}
          <button type="button" className="btn" onClick={() => setAbierta(c.conversation_id)}>Ver</button>
        </div>
      )} />}
      <Seccion titulo={`${esDireccion ? 'Asignadas a mí' : 'Mis asesorías'} (${mias.length})`} items={mias} accion={(c) => <button type="button" className="btn" onClick={() => setAbierta(c.conversation_id)} data-testid="btn-abrir">Abrir</button>} />
      {esDireccion && <Seccion titulo={`En curso con vendedores (${otras.length})`} items={otras} accion={(c) => <button type="button" className="btn" onClick={() => setAbierta(c.conversation_id)}>Ver</button>} />}
    </div>
  )
}

function Seccion({ titulo, items, accion }: { titulo: string; items: ColaItem[]; accion: (c: ColaItem) => React.ReactNode }) {
  if (items.length === 0) return null
  return (
    <section style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{titulo}</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((c) => (
          <li key={c.conversation_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10 }} data-testid="cola-item">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{c.dueno}{c.sin_leer > 0 ? ` · ${c.sin_leer} sin leer` : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3, #667)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>{c.iniciada ? 'Asesoría iniciada' : ETIQUETA_MODO[c.modo]}</span>
                {c.handoff_origen === 'carrito' && <span className="pill p-neu" data-testid="marca-carrito">Carrito activo{c.n_items ? ` · ${c.n_items} producto${c.n_items === 1 ? '' : 's'}` : ''}</span>}
                {c.fuera_horario && <span className="pill p-warn" data-testid="marca-fuera-horario">Llegó fuera de horario</span>}
                {c.ruteo_motivo && <span className="pill p-warn">{MOTIVO_RUTEO[c.ruteo_motivo] ?? c.ruteo_motivo}</span>}
                {c.edad_min != null && <span>hace {formatoEdad(c.edad_min)}</span>}
              </div>
            </div>
            {accion(c)}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function formatoEdad(min: number): string {
  if (min < 60) return `${Math.max(0, min)} min`
  if (min < 60 * 24) return `${Math.floor(min / 60)} h`
  return `${Math.floor(min / (60 * 24))} d`
}

/** Montaje en el registro: Dirección ve todo y asigna en Atención comercial; el vendedor ve lo suyo. */
export function AsesoriasPantalla() {
  const { role, setScreen } = useRole()
  return <Asesorias esDireccion={role === 'admin'} onAtencion={() => setScreen('av_atencion')} />
}
