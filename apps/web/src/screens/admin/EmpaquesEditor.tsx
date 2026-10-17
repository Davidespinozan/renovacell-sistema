// EMP-1 · Catálogo de empaques (hieleras y cajas): Dirección lo administra aquí; Empaque lo usa al cotizar la guía.
// Agregar, editar medidas y peso vacío, marcar "la más usada", desactivar (nunca borrar). Todo por empaque_guardar.
import React, { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { ETIQUETA_TIPO_EMPAQUE, guardarEmpaque, listarEmpaques, medidasTexto, type Empaque, type EmpaqueDatos } from '../../data/ops/empaques'

const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: 'var(--card, #fff)', color: 'inherit', width: '100%' }
const VACIO: EmpaqueDatos = { nombre: '', tipo: 'caja', largo_cm: undefined, ancho_cm: undefined, alto_cm: undefined, peso_kg: null, nota: '' }

export function EmpaquesEditor({ listar = listarEmpaques, guardar = guardarEmpaque }: { listar?: typeof listarEmpaques; guardar?: typeof guardarEmpaque }) {
  const [lista, setLista] = useState<Empaque[] | null>(null)
  const [edit, setEdit] = useState<EmpaqueDatos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const cargar = async () => { const r = await listar(true); if (r.ok) setLista(r.data); else setError(r.error) }
  useEffect(() => { void cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async (d: EmpaqueDatos) => {
    if (ocupado) return
    setOcupado(true); setError(null)
    const r = await guardar(d)
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    setEdit(null); await cargar()
  }
  const valido = (d: EmpaqueDatos) => !!d.nombre?.trim() && [d.largo_cm, d.ancho_cm, d.alto_cm].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)

  return (
    <div className="card" data-testid="empaques-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Empaques · Hieleras y cajas</h4>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ ...VACIO })} data-testid="empaque-nuevo"><Plus size={14} /> Agregar empaque</button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
        Empaque elige uno de estos al cotizar la guía y las medidas se llenan solas (el peso final siempre se captura al empacar).
        La <b>más usada</b> aparece primero. Desactivar no borra: deja de ofrecerse.
      </p>
      {error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)', margin: '6px 0' }}>{error}</div>}
      {edit && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8, display: 'grid', gap: 8 }} data-testid="empaque-form">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
            <label style={{ fontSize: 12 }}>Nombre<input style={input} value={edit.nombre ?? ''} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} aria-label="Nombre del empaque" /></label>
            <label style={{ fontSize: 12 }}>Tipo<select style={input} value={edit.tipo ?? 'caja'} onChange={(e) => setEdit({ ...edit, tipo: e.target.value as Empaque['tipo'] })} aria-label="Tipo de empaque"><option value="hielera">Hielera</option><option value="caja">Caja</option></select></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {(['largo_cm', 'ancho_cm', 'alto_cm'] as const).map((k) => (
              <label key={k} style={{ fontSize: 12 }}>{k === 'largo_cm' ? 'Largo (cm)' : k === 'ancho_cm' ? 'Ancho (cm)' : 'Alto (cm)'}
                <input style={input} type="number" min={1} step="0.5" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={k} />
              </label>
            ))}
            <label style={{ fontSize: 12 }}>Peso vacío (kg)<input style={input} type="number" min={0} step="0.05" value={edit.peso_kg ?? ''} onChange={(e) => setEdit({ ...edit, peso_kg: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Peso vacío" /></label>
          </div>
          <label style={{ fontSize: 12 }}>Nota<input style={input} value={edit.nota ?? ''} maxLength={200} onChange={(e) => setEdit({ ...edit, nota: e.target.value })} aria-label="Nota" placeholder="p. ej. la que se utiliza más, para Estafeta…" /></label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" type="button" onClick={() => setEdit(null)}>Cancelar</button>
            <button className="btn sm" type="button" disabled={!valido(edit) || ocupado} onClick={() => enviar(edit)} data-testid="empaque-guardar">{ocupado ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
      {lista === null ? <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '10px 0' }}>Cargando…</div> : lista.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '10px 0' }}>Sin empaques. Agrega el primero.</div>
      ) : (
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {lista.map((e) => (
            <div key={e.id} data-testid={`empaque-${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid ' + (e.frecuente ? 'var(--green, #2f9e69)' : 'var(--line)'), borderRadius: 10, opacity: e.activo ? 1 : 0.6, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>
                <b style={{ fontSize: 13 }}>{e.nombre}</b>{e.frecuente && <span className="pill p-ok" style={{ marginLeft: 6 }}>Más usada</span>}{!e.activo && <span className="pill p-neu" style={{ marginLeft: 6 }}>Inactivo</span>}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>{ETIQUETA_TIPO_EMPAQUE[e.tipo]} · {medidasTexto(e)}{e.peso_kg != null ? ` · ${e.peso_kg} kg vacío` : ''}{e.nota ? ` · ${e.nota}` : ''}</span>
              </span>
              <button className="btn ghost sm" type="button" onClick={() => setEdit({ ...e })}>Editar</button>
              {!e.frecuente && e.activo && <button className="btn ghost sm" type="button" onClick={() => enviar({ id: e.id, frecuente: true })} data-testid={`empaque-frecuente-${e.id}`}>Más usada</button>}
              <button className="btn ghost sm" type="button" onClick={() => enviar({ id: e.id, activo: !e.activo })} data-testid={`empaque-activo-${e.id}`}>{e.activo ? 'Desactivar' : 'Activar'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
