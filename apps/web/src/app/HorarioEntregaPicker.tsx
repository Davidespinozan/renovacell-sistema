// ENT-H · Selector de HORARIO de entrega local (mismo componente para el vendedor en el punto de venta, el doctor en su
// portal y Almacén al reprogramar). El servidor manda los días que se ofrecen y, por día, cada horario con su estado
// (disponible / ocupado / ya pasó); aquí solo se elige. Nunca se inventa un horario: todo viene de
// entrega_horarios_disponibles, y al crear el pedido el servidor lo valida y lo reserva de nuevo.
import React, { useEffect, useRef, useState } from 'react'
import { fechaCorta, horariosEntregaDisponibles, type DiaHorarios, type HorarioElegido, type HorariosDisponibles, type SlotHorario } from '../data/ops/entrega'

const DIA_CORTO = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

export function HorarioEntregaPicker({ value, onChange, cargar = horariosEntregaDisponibles, compacto = false, excluir }: {
  value: HorarioElegido | null
  onChange: (h: HorarioElegido | null) => void
  cargar?: typeof horariosEntregaDisponibles
  /** Menos aire (dentro del selector de entrega). */
  compacto?: boolean
  /** Horario que NO se ofrece aunque esté libre (al reprogramar: el actual). */
  excluir?: HorarioElegido | null
}) {
  const [data, setData] = useState<HorariosDisponibles | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dia, setDia] = useState<string | null>(null)
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  const recargar = async () => {
    const r = await cargar()
    if (!vivo.current) return
    if (!r.ok) { setError(r.error); setData(null); return }
    setError(null); setData(r.data)
    // Día mostrado: el del horario elegido si sigue ofreciéndose; si no, el primero con algo disponible.
    setDia((d) => {
      const dias = r.data.dias
      const buscado = value?.fecha ?? d
      if (buscado && dias.some((x) => x.fecha === buscado)) return buscado
      return (dias.find((x) => x.disponibles > 0) ?? dias[0])?.fecha ?? null
    })
    // Si el horario elegido ya no está disponible (se ocupó), se avisa soltándolo.
    if (value) {
      const s = r.data.dias.find((x) => x.fecha === value.fecha)?.slots.find((x) => x.inicio === value.inicio)
      if (!s || !s.disponible) onChange(null)
    }
  }
  useEffect(() => { void recargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div role="alert" className="ms" style={{ color: 'var(--danger)' }} data-testid="horario-error">No se pudieron cargar los horarios de entrega: {error}</div>
  if (!data) return <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="horario-cargando">Buscando horarios de entrega…</div>
  if (data.dias.length === 0) return <div className="ms" style={{ color: 'var(--warn)' }} data-testid="horario-vacio">No hay días de entrega local disponibles.</div>

  const actual: DiaHorarios = data.dias.find((x) => x.fecha === dia) ?? data.dias[0]
  const hoy = data.hoy
  const elegir = (s: SlotHorario) => {
    if (!s.disponible) return
    if (value && value.fecha === actual.fecha && value.inicio === s.inicio) { onChange(null); return }
    onChange({ fecha: actual.fecha, inicio: s.inicio })
  }
  const esExcluido = (s: SlotHorario) => !!excluir && excluir.fecha === actual.fecha && excluir.inicio === s.inicio

  return (
    <div data-testid="horario-picker" style={{ display: 'grid', gap: compacto ? 8 : 10 }}>
      <div role="tablist" aria-label="Día de entrega" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
        {data.dias.map((d) => {
          const on = d.fecha === actual.fecha
          return (
            <button key={d.fecha} type="button" role="tab" aria-selected={on} onClick={() => setDia(d.fecha)} data-testid={`horario-dia-${d.fecha}`}
              style={{ flex: 'none', minWidth: 64, minHeight: 44, padding: '6px 10px', borderRadius: 11, border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), background: on ? 'var(--green-deep)' : 'var(--card, #fff)', color: on ? '#fff' : 'inherit', fontFamily: 'inherit', cursor: 'pointer', opacity: d.disponibles === 0 ? 0.55 : 1 }}>
              <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{d.fecha === hoy ? 'hoy' : DIA_CORTO[d.dia_semana] ?? ''}</span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{d.fecha.slice(8, 10)}/{d.fecha.slice(5, 7)}</span>
              <span style={{ display: 'block', fontSize: 10.5, opacity: 0.85 }}>{d.disponibles === 0 ? 'lleno' : `${d.disponibles} libre${d.disponibles === 1 ? '' : 's'}`}</span>
            </button>
          )
        })}
      </div>
      <div role="radiogroup" aria-label={`Horarios del ${fechaCorta(actual.fecha)}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 6 }} data-testid="horario-slots">
        {actual.slots.map((s) => {
          const on = !!value && value.fecha === actual.fecha && value.inicio === s.inicio
          const puede = s.disponible && !esExcluido(s)
          const etiqueta = esExcluido(s) ? 'actual' : !s.disponible ? (s.motivo === 'OCUPADO' ? 'ocupado' : 'ya pasó') : s.cupo > 1 ? `${s.cupo - s.ocupados} de ${s.cupo}` : 'libre'
          return (
            <button key={s.inicio} type="button" role="radio" aria-checked={on} aria-disabled={!puede} disabled={!puede} onClick={() => elegir(s)} data-testid={`horario-${actual.fecha}-${s.inicio}`}
              style={{ minHeight: 44, padding: '6px 8px', borderRadius: 10, border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), background: on ? 'var(--ok-bg, #EAF4EC)' : puede ? 'var(--card, #fff)' : 'var(--surface-2, #f3f3f3)', color: puede ? 'inherit' : 'var(--ink-3)', fontFamily: 'inherit', cursor: puede ? 'pointer' : 'not-allowed', textDecoration: !puede && !esExcluido(s) ? 'line-through' : 'none' }}>
              <span className="mono" style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{s.inicio}–{s.fin}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: on ? 'var(--green-deep)' : 'var(--ink-3)' }}>{on ? 'elegido' : etiqueta}</span>
            </button>
          )
        })}
      </div>
      <div className="ms" style={{ color: 'var(--ink-3)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} data-testid="horario-pie">
        <span>{value ? <>Entrega <b>{value.fecha === hoy ? 'hoy' : fechaCorta(value.fecha)}</b> entre <b>{value.inicio}</b> y <b>{actual.slots.find((s) => s.inicio === value.inicio && value.fecha === actual.fecha)?.fin ?? data.dias.find((d) => d.fecha === value.fecha)?.slots.find((s) => s.inicio === value.inicio)?.fin ?? ''}</b>.</> : 'Elige el horario en que recibirá el pedido.'}</span>
        <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => void recargar()} data-testid="horario-actualizar">Actualizar</button>
      </div>
    </div>
  )
}
