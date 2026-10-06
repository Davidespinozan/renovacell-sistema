// CC-2 · Asesorías: la cola mínima para quien puede atender (vendedores con la capability
// `conversaciones` y Dirección). Lista lo que espera asesor, lo mío y lo activo; abre una
// conversación asignada en el mismo componente del hilo canónico. No es un CRM.
// (No se monta en Bandeja: A3.2 la modifica localmente; la cola vive aquí hasta su rollout.)
import React, { useCallback, useEffect, useState } from 'react'
import { chat as clientePorDefecto, ETIQUETA_MODO, type ClienteChat, type ColaItem } from '../../data/ops/chat'
import { ChatCanonico } from './ChatCanonico'

export function Asesorias({ cliente = clientePorDefecto, intervaloMs = 8000 }: { cliente?: ClienteChat; intervaloMs?: number }) {
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

  const tomar = async (id: string) => {
    const r = await cliente.asignarme(id)
    if (!r.ok) { setError(r.error.mensaje); await cargar(); return }
    await cargar(); setAbierta(id)
  }

  if (abierta) return <ChatCanonico embebido asesor conversationId={abierta} cliente={cliente} onSalir={() => { setAbierta(null); void cargar() }} />

  const pendientes = cola.filter((c) => c.modo === 'human_requested' && !c.seller_profile_id)
  const mias = cola.filter((c) => c.es_mia)
  const otras = cola.filter((c) => !c.es_mia && !(c.modo === 'human_requested' && !c.seller_profile_id))

  return (
    <div className="card" data-testid="asesorias">
      <h2 style={{ margin: '0 0 4px' }}>Asesorías</h2>
      <p style={{ margin: '0 0 12px', color: 'var(--ink-3, #667)', fontSize: 13 }}>Conversaciones de doctores y visitantes que pidieron hablar con una persona.</p>
      {error && <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {cargando && <div style={{ color: 'var(--ink-3, #667)' }}>Cargando…</div>}
      {!cargando && cola.length === 0 && !error && <div style={{ color: 'var(--ink-3, #667)' }}>Nadie espera asesor en este momento.</div>}
      <Seccion titulo={`Esperando asesor (${pendientes.length})`} items={pendientes} accion={(c) => <button type="button" className="btn btn-primary" onClick={() => tomar(c.conversation_id)} data-testid="btn-tomar">Tomar</button>} />
      <Seccion titulo={`Mis asesorías (${mias.length})`} items={mias} accion={(c) => <button type="button" className="btn" onClick={() => setAbierta(c.conversation_id)}>Abrir</button>} />
      <Seccion titulo={`Otras (${otras.length})`} items={otras} accion={(c) => <button type="button" className="btn" onClick={() => setAbierta(c.conversation_id)}>Ver</button>} />
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
            <div>
              <div style={{ fontWeight: 600 }}>{c.dueno}{c.sin_leer > 0 ? ` · ${c.sin_leer} sin leer` : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3, #667)' }}>{ETIQUETA_MODO[c.modo]}{c.asesoria_solicitada_at ? ` · pidió asesor ${new Date(c.asesoria_solicitada_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
            </div>
            {accion(c)}
          </li>
        ))}
      </ul>
    </section>
  )
}
