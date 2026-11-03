// MIS CLIENTES Y PROSPECTOS (3 nov 2026) · en Conversaciones, debajo de "Mis asesorías": lo que atendí o es de mi cartera
// sigue a la vista cuando vuelve a la IA (al cerrarse la asesoría por inactividad ya no desaparece), con "Retomar" para
// volver a escribirle sin pedírselo a Dirección.
import React, { useCallback, useEffect, useState } from 'react'
import { capitalizarNombre } from '../../lib/nombres'
import { cuandoLista } from '../../lib/cuando'
import { misConversaciones as cargarPorDefecto, retomarConversacion as retomarPorDefecto, QUIEN_ATIENDE, type MiConversacion } from '../../data/ops/misConversaciones'

export function MisClientes({ onAbrir, version = 0, cargar = cargarPorDefecto, retomar = retomarPorDefecto }: {
  onAbrir: (id: string) => void; version?: number; cargar?: typeof cargarPorDefecto; retomar?: typeof retomarPorDefecto
}) {
  const [lista, setLista] = useState<MiConversacion[] | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recargar = useCallback(async () => { const r = await cargar(); if (r) setLista(r) }, [cargar])
  useEffect(() => { void recargar() }, [recargar, version])
  if (!lista || lista.length === 0) return null
  const tomar = async (c: MiConversacion) => {
    setOcupado(c.conversation_id); setError(null)
    const r = await retomar(c.conversation_id)
    setOcupado(null)
    if (!r.ok) { setError(r.mensaje); void recargar(); return }
    onAbrir(c.conversation_id)
  }
  return (
    <section style={{ marginBottom: 16 }} data-testid="mis-clientes">
      <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Mis clientes y prospectos ({lista.length})</h3>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3, #667)', margin: '0 0 8px' }}>Los que atendiste o son de tu cartera. Retoma la conversación para volver a escribirles.</p>
      {error && <div role="alert" className="rc-aviso-nav" data-testid="mis-clientes-error">{error}</div>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lista.map((c) => (
          <li key={c.conversation_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10 }} data-testid="mi-cliente">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{capitalizarNombre(c.dueno)}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3, #667)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                <span className={'pill ' + (c.atiende === 'ia' ? 'p-neu' : 'p-warn')}>{QUIEN_ATIENDE[c.atiende]}{c.atiende_nombre ? `: ${c.atiende_nombre}` : ''}</span>
                {c.prospecto && <span className="pill p-neu">Prospecto</span>}
                {c.canal === 'whatsapp' && <span>WhatsApp</span>}
                {c.last_message_at && <span>{cuandoLista(c.last_message_at)}</span>}
              </div>
              {c.ultimo && <div style={{ fontSize: 12.5, color: 'var(--ink-2, #445)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.ultimo.actor === 'ai' ? 'Asistente: ' : ['seller', 'admin'].includes(c.ultimo.actor) ? 'Tú o el equipo: ' : ''}{c.ultimo.texto}</div>}
            </div>
            {c.puede_retomar
              ? <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={ocupado === c.conversation_id} onClick={() => void tomar(c)} data-testid="btn-retomar">{ocupado === c.conversation_id ? 'Retomando…' : 'Retomar'}</button>
              : <span style={{ fontSize: 12, color: 'var(--ink-3, #667)' }}>En curso con otra persona</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
