// HERRAMIENTAS DEL VENDEDOR · buscar una PALABRA en todas tus conversaciones ("me acuerdo de qué hablamos, no de con
// quién"). Cada resultado dice con quién fue, cuándo y la frase donde aparece, resaltada; con un toque se abre el chat.
// Lo usan Conversaciones (vendedor) y la Bandeja de Dirección. La base decide qué conversaciones ve cada quien.
import React, { useEffect, useState } from 'react'
import { MessageSquareText, Search, X } from 'lucide-react'
import { buscarMensajes as buscarPorDefecto, fragmento, type ResultadoMensaje } from '../../data/ops/busqueda'
import { capitalizarNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'

// "LOURDES VELAZQUEZ (cliente)" → "Lourdes Velazquez (cliente)": se capitaliza el nombre y se respeta la aclaración.
const nombreVisible = (n: string) => { const i = n.indexOf(' ('); return i > 0 ? capitalizarNombre(n.slice(0, i)) + n.slice(i) : capitalizarNombre(n) }
const QUIEN: Record<string, string> = { visitor: 'Cliente', doctor: 'Cliente', seller: 'Asesor', admin: 'Dirección', ai: 'Asistente' }

/** Resultados para una búsqueda (la escribe quien monta). Espera un momento a que termine de escribir. */
export function ResultadosMensajes({ q, onAbrir, buscar = buscarPorDefecto, esperaMs = 350 }: { q: string; onAbrir: (conversationId: string) => void; buscar?: typeof buscarPorDefecto; esperaMs?: number }) {
  const [res, setRes] = useState<ResultadoMensaje[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 3) { setRes(null); setError(false); return }
    let vivo = true
    setCargando(true)
    const h = window.setTimeout(() => {
      void buscar(t).then((r) => { if (!vivo) return; setCargando(false); setError(r === null); setRes(r ?? []) })
    }, esperaMs)
    return () => { vivo = false; window.clearTimeout(h) }
  }, [q, buscar, esperaMs])
  if (q.trim().length < 3) return null
  return (
    <section className="bm" aria-label="Resultados en mensajes" data-testid="busqueda-mensajes">
      <div className="bm-h"><MessageSquareText size={15} aria-hidden /> <b>En mensajes</b>
        <span>{cargando ? 'Buscando…' : error ? 'No se pudo buscar' : `${res?.length ?? 0} ${res?.length === 1 ? 'conversación' : 'conversaciones'} con «${q.trim()}»`}</span></div>
      {res && res.length === 0 && !cargando && !error && <div className="bm-vacio">Nadie dijo «{q.trim()}» en tus conversaciones.</div>}
      <ul className="bm-lista">
        {(res ?? []).map((r) => {
          const f = fragmento(r.texto, q)
          return (
            <li key={r.conversation_id}>
              <button type="button" className="bm-item" disabled={!r.puede_abrir} onClick={() => onAbrir(r.conversation_id)} data-testid="busqueda-resultado"
                title={r.puede_abrir ? 'Abrir la conversación' : 'Esta conversación ya no está a tu cargo: aquí ves lo que se dijo.'}>
                <span className="bm-l1"><b>{nombreVisible(r.nombre)}</b><small>{fmtDate(r.fecha)}{r.coincidencias > 1 ? ` · ${r.coincidencias} veces` : ''}</small></span>
                <span className="bm-frase"><em>{QUIEN[r.quien] ?? 'Mensaje'}:</em> {f.antes}<mark>{f.hallado}</mark>{f.despues}</span>
                {!r.puede_abrir && <span className="bm-nota">{!r.abierta ? 'Conversación cerrada' : r.tuya ? 'Sin asesoría abierta: vuelve a tu lista cuando el cliente escriba o pida asesor' : 'La atiende otra persona'}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Caja de búsqueda + resultados (Conversaciones del vendedor). */
export function BuscadorConversaciones({ onAbrir, buscar }: { onAbrir: (conversationId: string) => void; buscar?: typeof buscarPorDefecto }) {
  const [q, setQ] = useState('')
  return (
    <div className="bm-caja" data-testid="buscador-conversaciones">
      <span className="searchbox" style={{ width: '100%' }}>
        <Search size={15} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar una palabra en tus conversaciones (p. ej. Dysport, factura, envío)" aria-label="Buscar en tus conversaciones" data-testid="buscar-conversaciones" />
        {q && <button type="button" className="rc-ico" onClick={() => setQ('')} aria-label="Limpiar búsqueda"><X size={15} /></button>}
      </span>
      <ResultadosMensajes q={q} onAbrir={(id) => { setQ(''); onAbrir(id) }} buscar={buscar} />
    </div>
  )
}
