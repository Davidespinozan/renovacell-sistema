// MIS CLIENTES Y PROSPECTOS (3 nov 2026) · lo que atendí o es de mi cartera sigue en MI lista de Conversaciones cuando
// vuelve al asistente (al cerrarse la asesoría por inactividad ya no desaparece). Van en la misma lista que las
// asesorías, con "Retomar" para volver a escribirle sin pedírselo a Dirección. Aquí: la carga y la fila.
import React, { useCallback, useEffect, useState } from 'react'
import { capitalizarNombre } from '../../lib/nombres'
import { cuandoLista } from '../../lib/cuando'
import { misConversaciones as cargarPorDefecto, retomarConversacion as retomarPorDefecto, QUIEN_ATIENDE, type MiConversacion } from '../../data/ops/misConversaciones'

export function useMisClientes(version: number, cargar: typeof cargarPorDefecto = cargarPorDefecto) {
  const [lista, setLista] = useState<MiConversacion[]>([])
  const recargar = useCallback(async () => { const r = await cargar(); if (r) setLista(r) }, [cargar])
  useEffect(() => { void recargar() }, [recargar, version])
  return { lista, recargar }
}

export function FilaMiCliente({ c, onAbrir, onError, retomar = retomarPorDefecto }: {
  c: MiConversacion; onAbrir: (id: string) => void; onError: (m: string) => void; retomar?: typeof retomarPorDefecto
}) {
  const [ocupado, setOcupado] = useState(false)
  const tomar = async () => {
    setOcupado(true)
    const r = await retomar(c.conversation_id)
    setOcupado(false)
    if (!r.ok) { onError(r.mensaje); return }
    onAbrir(c.conversation_id)
  }
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10 }} data-testid="mi-cliente">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{capitalizarNombre(c.dueno)}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3, #667)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
          <span className={'pill ' + (c.atiende === 'ia' ? 'p-neu' : 'p-warn')}>{QUIEN_ATIENDE[c.atiende]}{c.atiende_nombre ? `: ${c.atiende_nombre}` : ''}</span>
          <span className="pill p-neu">{c.prospecto ? 'Prospecto' : 'Cliente'}</span>
          {c.canal === 'whatsapp' && <span>WhatsApp</span>}
          {c.last_message_at && <span>{cuandoLista(c.last_message_at)}</span>}
        </div>
        {c.ultimo && <div style={{ fontSize: 12.5, color: 'var(--ink-2, #445)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.ultimo.actor === 'ai' ? 'Asistente: ' : ['seller', 'admin'].includes(c.ultimo.actor) ? 'Equipo: ' : ''}{c.ultimo.texto}</div>}
      </div>
      {c.puede_retomar
        ? <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={ocupado} onClick={() => void tomar()} data-testid="btn-retomar">{ocupado ? 'Retomando…' : 'Retomar'}</button>
        : <span style={{ fontSize: 12, color: 'var(--ink-3, #667)' }}>En curso con otra persona</span>}
    </li>
  )
}
