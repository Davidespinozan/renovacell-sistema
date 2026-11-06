// ASISTENTE DEL EQUIPO (6 nov 2026) · botón flotante «Pregúntale al sistema» para el personal (no doctores). Abre un panel donde
// cualquiera pregunta cómo se usa el sistema o qué pasó con un cliente, una conversación o un pedido. SOLO CONSULTA: la Edge
// `asistente-equipo` responde con los permisos de quien pregunta. La conversación vive solo en esta pestaña.
import React, { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRole } from '../auth/RoleContext'

export type Invocar = (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }>
const invocarPorDefecto: Invocar = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: unknown; error: unknown }>
interface Msg { rol: 'persona' | 'asistente'; texto: string; error?: boolean }
const EJEMPLOS = ['¿Cómo paso una conversación a otro vendedor?', '¿De quién es cliente la Dra. Vea?', '¿Por qué esta conversación le tocó a Alejandra?', '¿Dónde pongo el aviso de la sucursal?']
export const ROLES_EQUIPO = ['admin', 'pos', 'warehouse', 'packing', 'driver']

/** **negritas** y listas «- » (lo único que pide el asistente). Sin HTML crudo. */
export function textoRico(t: string): React.ReactNode {
  const linea = (s: string, k: number) => <React.Fragment key={k}>{s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (/^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : p))}</React.Fragment>
  const bloques: React.ReactNode[] = []; let lista: string[] = []
  const cerrarLista = () => { if (lista.length) { bloques.push(<ul key={bloques.length}>{lista.map((x, i) => <li key={i}>{linea(x, i)}</li>)}</ul>); lista = [] } }
  for (const l of t.split('\n')) {
    if (/^\s*[-•]\s+/.test(l)) { lista.push(l.replace(/^\s*[-•]\s+/, '')); continue }
    cerrarLista()
    if (l.trim()) bloques.push(<p key={bloques.length}>{linea(l, 0)}</p>)
  }
  cerrarLista()
  return bloques
}

export function mensajeError(e: unknown): string {
  const ctx = (e as { context?: { status?: number } } | null)?.context
  if (ctx?.status === 429) return 'Hiciste muchas preguntas seguidas. Espera un rato e intenta de nuevo.'
  if (ctx?.status === 501) return 'El asistente todavía no está configurado.'
  return 'No pude responder ahora. Intenta de nuevo.'
}

export function AsistenteEquipo({ invocar = invocarPorDefecto, pantalla }: { invocar?: Invocar; pantalla?: string | null }) {
  const [abierto, setAbierto] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [texto, setTexto] = useState(''); const [pensando, setPensando] = useState(false)
  const fin = useRef<HTMLDivElement | null>(null); const campo = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { fin.current?.scrollIntoView?.({ block: 'end' }) }, [msgs, pensando])
  useEffect(() => { if (abierto) campo.current?.focus() }, [abierto])
  const preguntar = async (q: string) => {
    const pregunta = q.trim(); if (!pregunta || pensando) return
    const historial = msgs.filter((m) => !m.error).map(({ rol, texto: t }) => ({ rol, texto: t }))
    setMsgs((m) => [...m, { rol: 'persona', texto: pregunta }]); setTexto(''); setPensando(true)
    const { data, error } = await invocar('asistente-equipo', { body: { pregunta, historial, pantalla: pantalla ?? null } })
    setPensando(false)
    const d = data as { ok?: boolean; respuesta?: string } | null
    if (error || !d?.respuesta) { setMsgs((m) => [...m, { rol: 'asistente', texto: mensajeError(error), error: true }]); return }
    setMsgs((m) => [...m, { rol: 'asistente', texto: d.respuesta!, error: d.ok === false }])
  }
  if (!abierto) return (
    <button type="button" className="ae-lanzador" onClick={() => setAbierto(true)} aria-label="Pregúntale al sistema" title="Pregúntale al sistema" data-testid="ae-abrir"><Sparkles size={20} /></button>
  )
  return (
    <section className="ae-panel" role="dialog" aria-label="Pregúntale al sistema" data-testid="ae-panel" onKeyDown={(e) => { if (e.key === 'Escape') setAbierto(false) }}>
      <header className="ae-head">
        <span><Sparkles size={16} aria-hidden /> <b>Pregúntale al sistema</b></span>
        <button type="button" className="ae-ico" onClick={() => setAbierto(false)} aria-label="Cerrar" data-testid="ae-cerrar"><X size={18} /></button>
      </header>
      <div className="ae-hilo" aria-live="polite">
        {msgs.length === 0 && (
          <div className="ae-vacio">
            <p>Pregunta cómo se hace algo en el sistema o qué pasó con un cliente, una conversación o un pedido. Solo consulto: no cambio nada, y veo lo mismo que tú puedes ver.</p>
            {EJEMPLOS.map((x) => <button key={x} type="button" className="ae-ejemplo" onClick={() => void preguntar(x)} data-testid="ae-ejemplo">{x}</button>)}
          </div>
        )}
        {msgs.map((m, i) => <div key={i} className={`ae-msg ae-msg--${m.rol}${m.error ? ' ae-msg--error' : ''}`} data-testid={`ae-msg-${m.rol}`}>{m.rol === 'asistente' ? textoRico(m.texto) : m.texto}</div>)}
        {pensando && <div className="ae-msg ae-msg--asistente ae-pensando" data-testid="ae-pensando">Buscando…</div>}
        <div ref={fin} />
      </div>
      <form className="ae-form" onSubmit={(e) => { e.preventDefault(); void preguntar(texto) }}>
        <textarea ref={campo} rows={2} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escribe tu pregunta…" aria-label="Tu pregunta" data-testid="ae-texto"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void preguntar(texto) } }} />
        <button type="submit" className="ae-enviar" disabled={pensando || !texto.trim()} aria-label="Preguntar" data-testid="ae-enviar"><Send size={17} /></button>
      </form>
    </section>
  )
}

/** Solo personal con sesión. */
export function AsistenteEquipoPuerta() {
  const { role, user, screen } = useRole()
  if (!user || !role || !ROLES_EQUIPO.includes(role)) return null
  return <AsistenteEquipo pantalla={screen} />
}
