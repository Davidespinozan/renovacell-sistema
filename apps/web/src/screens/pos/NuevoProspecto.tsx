// NUEVO PROSPECTO (21 nov 2026, dueño: «que prospecten por su cuenta»). La vendedora registra a un doctor o clínica que
// consiguió ella (evento, visita, su WhatsApp): queda en SU cartera con su oportunidad en «Primer contacto». La base evita
// duplicados por celular (si ya es de otra vendedora, dice de quién es; si existe sin vendedora, se lo asigna).
import { useState, type FormEvent } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'

export interface ProspectoCreado { customer_id: string; nombre: string; status: 'creado' | 'asignado' | 'existente'; celular?: string }
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => supabase.rpc(fn as never, (args ?? {}) as never) as unknown as PromiseLike<{ data: unknown; error: { message?: string } | null }>

export async function crearProspecto(d: { nombre: string; celular: string; tipo: 'doctor' | 'clinica'; ciudad?: string; correo?: string }, rpc: Rpc = rpcPorDefecto):
  Promise<{ ok: true; data: ProspectoCreado } | { ok: false; error: string }> {
  if (!hasSupabase && rpc === rpcPorDefecto) return { ok: false, error: 'Sin conexión con el servidor.' }
  try {
    const { data, error } = await rpc('cliente_prospecto_crear', { p_nombre: d.nombre, p_celular: d.celular, p_tipo: d.tipo, p_ciudad: d.ciudad || null, p_correo: d.correo || null })
    if (error) { const t = (error.message ?? '').replace(/^[A-Z_]+:\s*/, '').trim(); return { ok: false, error: t ? t.charAt(0).toUpperCase() + t.slice(1) : 'No se pudo registrar.' } }
    const r = data as { customer_id: string; nombre: string; status: ProspectoCreado['status'] }
    return { ok: true, data: { customer_id: r.customer_id, nombre: r.nombre, status: r.status } }
  } catch { return { ok: false, error: 'Sin conexión: revisa tu señal y vuelve a intentarlo.' } }
}

export const avisoProspecto = (p: ProspectoCreado): string =>
  p.status === 'creado' ? `${p.nombre} quedó en tu cartera.` : p.status === 'asignado' ? `${p.nombre} ya existía sin vendedora: ahora es de tu cartera.` : `${p.nombre} ya es de tu cartera.`

export function NuevoProspectoForm({ onListo, onCancelar, rpc }: { onListo: (p: ProspectoCreado) => void; onCancelar: () => void; rpc?: Rpc }) {
  const [f, setF] = useState({ nombre: '', celular: '', tipo: 'doctor' as 'doctor' | 'clinica', ciudad: '', correo: '' })
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true); setError(null)
    const r = await crearProspecto(f, rpc)
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    onListo({ ...r.data, celular: f.celular.replace(/\D/g, '').slice(-10) })
  }
  return (
    <form className="prospecto-form" onSubmit={(e) => void enviar(e)} data-testid="prospecto-form">
      <div className="prospecto-tipo">
        {(['doctor', 'clinica'] as const).map((t) => (
          <button key={t} type="button" className={'pc-chip' + (f.tipo === t ? ' on' : '')} onClick={() => setF({ ...f, tipo: t })}>{t === 'doctor' ? 'Doctor(a)' : 'Clínica'}</button>
        ))}
      </div>
      <label>Nombre completo<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={120} autoComplete="off" placeholder={f.tipo === 'doctor' ? 'Dra. Ana López Pérez' : 'Clínica Estética del Valle'} data-testid="prospecto-nombre" /></label>
      <label>Celular (WhatsApp)<input value={f.celular} onChange={(e) => setF({ ...f, celular: e.target.value })} inputMode="tel" autoComplete="off" placeholder="667 123 4567" data-testid="prospecto-celular" /></label>
      <label>Ciudad <small>(opcional)</small><input value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} maxLength={80} autoComplete="off" /></label>
      <label>Correo <small>(opcional)</small><input value={f.correo} onChange={(e) => setF({ ...f, correo: e.target.value })} inputMode="email" autoComplete="off" /></label>
      {error && <div className="sysnote" role="alert" data-testid="prospecto-error">{error}</div>}
      <div className="prospecto-acciones">
        <button type="button" className="btn ghost" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn" disabled={ocupado || f.nombre.trim().length < 3 || f.celular.replace(/\D/g, '').length < 10} data-testid="prospecto-guardar">{ocupado ? 'Guardando…' : 'Registrar'}</button>
      </div>
    </form>
  )
}
