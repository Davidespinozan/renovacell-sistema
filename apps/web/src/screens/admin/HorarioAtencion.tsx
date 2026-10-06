// CC-7 · DIRECCIÓN · Horario de atención comercial (Configuración). El servidor es la autoridad: con
// este horario decide qué se le dice al cliente cuando activa un carrito o pide un asesor. Sin
// configurar, el sistema NO promete atención inmediata. Cada cambio queda auditado en el servidor.
import React, { useCallback, useEffect, useState } from 'react'
import { atencion as clientePorDefecto, DIAS, textoEstadoHorario, validarSemana, type ClienteAtencion, type DiaHorario, type Horario } from '../../data/ops/atencion'

const campo: React.CSSProperties = { padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: 13 }
const ZONAS = ['America/Mazatlan', 'America/Mexico_City', 'America/Tijuana', 'America/Hermosillo', 'America/Monterrey', 'America/Cancun']

export function HorarioAtencion({ cliente = clientePorDefecto }: { cliente?: ClienteAtencion }) {
  const [h, setH] = useState<Horario | null>(null)
  const [semana, setSemana] = useState<DiaHorario[]>([])
  const [zona, setZona] = useState('America/Mazatlan')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [exc, setExc] = useState<{ fecha: string; tipo: 'cerrado' | 'horario'; abre: string; cierra: string; motivo: string }>({ fecha: '', tipo: 'cerrado', abre: '09:00', cierra: '14:00', motivo: '' })
  const [ocupado, setOcupado] = useState(false)

  const aplicar = (x: Horario) => { setH(x); setZona(x.zona); setSemana(x.semana.map((d) => ({ ...d, abre: d.abre ?? '09:00', cierra: d.cierra ?? '18:00' }))) }
  const cargar = useCallback(async () => { const r = await cliente.horario(); if (r.ok) aplicar(r.data); else setMsg({ ok: false, texto: r.error }) }, [cliente])
  useEffect(() => { void cargar() }, [cargar])

  const guardar = async () => {
    const err = validarSemana(semana); if (err) { setMsg({ ok: false, texto: err }); return }
    setOcupado(true); setMsg(null)
    const r = await cliente.guardarHorario(zona, semana.map((d) => ({ dia: d.dia, abierto: d.abierto, abre: d.abierto ? d.abre : null, cierra: d.abierto ? d.cierra : null })))
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.error }); return }
    aplicar(r.data); setMsg({ ok: true, texto: 'Horario guardado.' })
  }
  const guardarExc = async () => {
    if (!exc.fecha) return
    setOcupado(true); setMsg(null)
    const r = await cliente.guardarExcepcion({ fecha: exc.fecha, tipo: exc.tipo, abre: exc.tipo === 'horario' ? exc.abre : null, cierra: exc.tipo === 'horario' ? exc.cierra : null, motivo: exc.motivo || null })
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.error }); return }
    aplicar(r.data); setExc((e) => ({ ...e, fecha: '', motivo: '' }))
  }
  const borrarExc = async (fecha: string) => { const r = await cliente.borrarExcepcion(fecha); if (r.ok) aplicar(r.data); else setMsg({ ok: false, texto: r.error }) }
  const set = (i: number, k: keyof DiaHorario, v: unknown) => setSemana((s) => s.map((d, j) => (j === i ? { ...d, [k]: v } : d)))

  return (
    <div className="card" data-testid="horario-atencion">
      <h4 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Horario de atención comercial</h4>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 8 }} data-testid="horario-estado">
        {textoEstadoHorario(h?.estado)} Dentro del horario, al activar un carrito se avisa "te conectaremos con un asesor personal"; fuera, se avisa que el equipo no está disponible y la conversación queda lista.
      </div>
      <label style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>Zona horaria
        <select value={zona} onChange={(e) => setZona(e.target.value)} style={campo}>{[...new Set([zona, ...ZONAS])].map((z) => <option key={z} value={z}>{z}</option>)}</select>
      </label>
      <div style={{ display: 'grid', gap: 6 }}>
        {semana.map((d, i) => (
          <div key={d.dia} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }} data-testid="horario-dia">
            <label style={{ width: 120, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={d.abierto} onChange={(e) => set(i, 'abierto', e.target.checked)} aria-label={`${DIAS[d.dia - 1]} abierto`} />{DIAS[d.dia - 1]}
            </label>
            {d.abierto ? (
              <>
                <input type="time" value={d.abre ?? ''} onChange={(e) => set(i, 'abre', e.target.value)} style={campo} aria-label={`${DIAS[d.dia - 1]} abre`} />
                <span>a</span>
                <input type="time" value={d.cierra ?? ''} onChange={(e) => set(i, 'cierra', e.target.value)} style={campo} aria-label={`${DIAS[d.dia - 1]} cierra`} />
              </>
            ) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Cerrado</span>}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
        <button type="button" className="btn" onClick={guardar} disabled={ocupado} data-testid="horario-guardar">Guardar horario</button>
        {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 12.5, color: msg.ok ? 'var(--green-deep)' : 'var(--danger)' }}>{msg.texto}</span>}
      </div>

      <h4 style={{ margin: '16px 0 6px', fontSize: 13, fontWeight: 700 }}>Cierres y aperturas excepcionales</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={exc.fecha} onChange={(e) => setExc({ ...exc, fecha: e.target.value })} style={campo} aria-label="Fecha" />
        <select value={exc.tipo} onChange={(e) => setExc({ ...exc, tipo: e.target.value as 'cerrado' | 'horario' })} style={campo} aria-label="Tipo">
          <option value="cerrado">Cerrado todo el día</option><option value="horario">Horario especial</option>
        </select>
        {exc.tipo === 'horario' && <><input type="time" value={exc.abre} onChange={(e) => setExc({ ...exc, abre: e.target.value })} style={campo} aria-label="Abre" /><input type="time" value={exc.cierra} onChange={(e) => setExc({ ...exc, cierra: e.target.value })} style={campo} aria-label="Cierra" /></>}
        <input placeholder="Motivo (opcional)" value={exc.motivo} onChange={(e) => setExc({ ...exc, motivo: e.target.value })} maxLength={200} style={{ ...campo, flex: 1, minWidth: 160 }} />
        <button type="button" className="btn" onClick={guardarExc} disabled={!exc.fecha || ocupado} data-testid="excepcion-guardar">Agregar</button>
      </div>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
        {(h?.excepciones ?? []).map((e) => (
          <li key={e.fecha} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }} data-testid="excepcion">
            <span className="mono">{e.fecha}</span><span>{e.tipo === 'cerrado' ? 'Cerrado' : `${e.abre}–${e.cierra}`}</span>{e.motivo && <span style={{ color: 'var(--ink-3)' }}>· {e.motivo}</span>}
            <button type="button" className="btn ghost sm" onClick={() => borrarExc(e.fecha)}>Quitar</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
