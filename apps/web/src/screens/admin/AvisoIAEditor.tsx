// AVISO-IA (6 nov 2026) · Dirección le deja un AVISO VIGENTE al asistente (WhatsApp y portal): p. ej. «La sucursal está cerrada
// por remodelación…». La IA lo lee en cada turno y manda sobre la dirección, el horario y lo de recoger en sucursal. Con fecha
// de fin opcional (al terminar ese día deja de usarse). El servidor valida y deja bitácora (ia_aviso_guardar).
import React, { useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
type Leer = () => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, args as never) as unknown as ReturnType<Rpc>
const leerPorDefecto: Leer = () => supabase.from('company_settings').select('aviso_ia, aviso_ia_hasta').eq('id', 'default').maybeSingle() as unknown as ReturnType<Leer>
const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: 'var(--card, #fff)', color: 'inherit', width: '100%' }

export function mensajeAviso(m: string | undefined): string {
  if (/AVISO_CORTO/.test(m ?? '')) return 'Escribe el aviso completo.'
  if (/AVISO_LARGO/.test(m ?? '')) return 'Máximo 1000 caracteres.'
  if (/FECHA_PASADA/.test(m ?? '')) return 'La fecha de fin ya pasó.'
  if (/NO_AUTORIZADO/.test(m ?? '')) return 'Solo Dirección puede cambiar el aviso.'
  return 'No se pudo guardar. Intenta de nuevo.'
}

export function AvisoIAEditor({ rpc = rpcPorDefecto, leer = leerPorDefecto }: { rpc?: Rpc; leer?: Leer }) {
  const [texto, setTexto] = useState(''); const [hasta, setHasta] = useState('')
  const [vigente, setVigente] = useState<{ texto: string | null; hasta: string | null } | null>(null)
  const [ocupado, setOcupado] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  useEffect(() => { let vivo = true; void Promise.resolve(leer()).then(({ data }) => {
    if (!vivo) return; const d = data as { aviso_ia?: string | null; aviso_ia_hasta?: string | null } | null
    setVigente({ texto: d?.aviso_ia ?? null, hasta: d?.aviso_ia_hasta ?? null }); setTexto(d?.aviso_ia ?? ''); setHasta(d?.aviso_ia_hasta ?? '')
  }); return () => { vivo = false } }, [leer])
  const guardar = async (t: string | null) => {
    setOcupado(true); setMsg(null)
    const { data, error } = await rpc('ia_aviso_guardar', { p_texto: t, p_hasta: t && hasta ? hasta : null })
    setOcupado(false)
    if (error) { setMsg({ ok: false, t: mensajeAviso(error.message) }); return }
    const d = data as { texto: string | null; hasta: string | null }
    setVigente(d); setTexto(d.texto ?? ''); setHasta(d.hasta ?? '')
    setMsg({ ok: true, t: d.texto ? 'Listo: el asistente ya lo toma en cuenta desde el siguiente mensaje.' : 'Aviso quitado.' })
  }
  return (
    <div className="card" data-testid="aviso-ia">
      <h4 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Aviso para el asistente</h4>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 10 }}>
        Algo que el asistente debe decir mientras dure (WhatsApp y portal). Manda sobre la dirección, el horario y lo de recoger en sucursal.
        Ejemplo: «La sucursal está cerrada por remodelación; no hay atención en mostrador. Las entregas y recolecciones se coordinan con un asesor.»
      </div>
      {vigente?.texto && <div style={{ fontSize: 12.5, marginBottom: 8 }} data-testid="aviso-ia-vigente">Vigente{vigente.hasta ? ` hasta el ${vigente.hasta}` : ' (sin fecha de fin)'}.</div>}
      <textarea style={{ ...input, minHeight: 80 }} maxLength={1000} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Aviso para el asistente" data-testid="aviso-ia-texto"
        placeholder="La sucursal está cerrada por remodelación…" />
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
        <label style={{ fontSize: 12, display: 'grid', gap: 4 }}>Hasta (opcional)<input type="date" style={input} value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Vigente hasta" data-testid="aviso-ia-hasta" /></label>
        <button type="button" className="btn" disabled={ocupado || texto.trim().length < 5} onClick={() => void guardar(texto.trim())} data-testid="aviso-ia-guardar"><Save size={15} aria-hidden /> Guardar aviso</button>
        {vigente?.texto && <button type="button" className="btn ghost" disabled={ocupado} onClick={() => void guardar(null)} data-testid="aviso-ia-quitar"><X size={15} aria-hidden /> Quitar aviso</button>}
      </div>
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, marginTop: 8, color: msg.ok ? 'var(--green-deep)' : 'var(--danger)' }} data-testid="aviso-ia-msg">{msg.t}</div>}
    </div>
  )
}
