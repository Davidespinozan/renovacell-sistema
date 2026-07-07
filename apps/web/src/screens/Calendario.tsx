// DISEÑO (capability) · Calendario de entregas y compromisos de producción.
// Vista de mes: cada día muestra sus compromisos (entrega/producción/campaña).
// Diseño agenda aquí lo que va a entregar y producir. Persistido en design_calendar.
import React, { useMemo, useState } from 'react'
import { Plus, X, Check, Trash2, ChevronLeft, ChevronRight, Palette, Package, Megaphone } from 'lucide-react'
import { useCalendar, type CalEntry, type CalKind } from '../data/hooks/useCalendar'

const KIND: Record<CalKind, { label: string; pill: string; icon: React.ReactNode }> = {
  entrega: { label: 'Entrega', pill: 'p-blue', icon: <Palette size={11} /> },
  produccion: { label: 'Producción', pill: 'p-warn', icon: <Package size={11} /> },
  campana: { label: 'Campaña', pill: 'p-neu', icon: <Megaphone size={11} /> },
}
const WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const iso = (y: number, m: number, d: number): string => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
// Lunes=0 … Domingo=6
const mondayIdx = (jsDay: number): number => (jsDay + 6) % 7

export function Calendario() {
  const { data, addEntry, toggleDone, removeEntry } = useCalendar()
  const today = new Date()
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [pick, setPick] = useState<string | null>(null) // fecha seleccionada para agregar

  const byDate = useMemo(() => {
    const map: Record<string, CalEntry[]> = {}
    data.forEach((e) => { (map[e.date] ??= []).push(e) })
    return map
  }, [data])

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const leadPad = mondayIdx(new Date(cursor.y, cursor.m, 1).getDay())
  const cells: (number | null)[] = [
    ...Array(leadPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate())
  const move = (delta: number) => setCursor((c) => {
    const d = new Date(c.y, c.m + delta, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })

  // Próximos compromisos (lista de apoyo, ordenada por fecha).
  const upcoming = useMemo(
    () => data.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    [data],
  )

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Diseño · Calendario de entregas y producción</div>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => setPick(todayIso)}>
          <Plus size={14} /> Nuevo compromiso
        </button>
      </div>

      <div className="card">
        {/* Cabecera del mes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button className="iconbtn-round" type="button" aria-label="Mes anterior" onClick={() => move(-1)}><ChevronLeft size={17} /></button>
          <div style={{ fontWeight: 600, fontSize: 15, minWidth: 170, textAlign: 'center' }}>{MONTHS[cursor.m]} {cursor.y}</div>
          <button className="iconbtn-round" type="button" aria-label="Mes siguiente" onClick={() => move(1)}><ChevronRight size={17} /></button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {(Object.keys(KIND) as CalKind[]).map((k) => (
              <span key={k} style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className={'pill ' + KIND[k].pill} style={{ padding: '1px 7px' }}>{KIND[k].icon}</span> {KIND[k].label}
              </span>
            ))}
          </div>
        </div>

        {/* Rejilla del mes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
          {WEEK.map((w) => (
            <div key={w} style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textAlign: 'center', padding: '2px 0' }}>{w}</div>
          ))}
          {cells.map((d, i) => {
            if (d === null) return <div key={i} />
            const date = iso(cursor.y, cursor.m, d)
            const items = byDate[date] ?? []
            const isToday = date === todayIso
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPick(date)}
                className="cal-cell"
                style={{
                  textAlign: 'left', minHeight: 82, border: '1px solid var(--line)', borderRadius: 10,
                  padding: 6, background: isToday ? 'var(--ok-bg)' : '#fff', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 3, fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--green-deep)' : 'var(--ink-2)' }}>{d}</span>
                {items.slice(0, 3).map((e) => (
                  <span key={e.id} className={'pill ' + KIND[e.kind].pill} style={{ fontSize: 10, padding: '1px 6px', textDecoration: e.status === 'listo' ? 'line-through' : 'none', opacity: e.status === 'listo' ? 0.6 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {e.title}
                  </span>
                ))}
                {items.length > 3 && <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>+{items.length - 3} más</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Próximos compromisos */}
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Próximos compromisos</div>
        {upcoming.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Sin compromisos agendados. Agrega uno con “Nuevo compromiso”.</div>}
        {upcoming.map((e) => (
          <div key={e.id} className="lrow" style={{ alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span className={'pill ' + KIND[e.kind].pill} style={{ padding: '2px 8px' }}>{KIND[e.kind].icon} {KIND[e.kind].label}</span>
              <div style={{ minWidth: 0 }}>
                <div className="nm" style={{ textDecoration: e.status === 'listo' ? 'line-through' : 'none', opacity: e.status === 'listo' ? 0.6 : 1 }}>{e.title}</div>
                <div className="lt">{fmtLong(e.date)}{e.notes ? ` · ${e.notes}` : ''}</div>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn ghost sm" type="button" onClick={() => toggleDone(e.id)}>
                <Check size={14} /> {e.status === 'listo' ? 'Reabrir' : 'Listo'}
              </button>
              <button className="iconbtn-round" type="button" aria-label="Quitar" onClick={() => removeEntry(e.id)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {pick && <NuevoCompromiso date={pick} onClose={() => setPick(null)} onCreate={(title, kind, notes) => { addEntry({ title, date: pick, kind, notes }); setPick(null) }} />}
    </div>
  )
}

function fmtLong(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return `${d} de ${MONTHS[m - 1]} ${y}`
}

const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, outline: 'none', background: '#fff', marginTop: 6 }
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

function NuevoCompromiso({ date, onClose, onCreate }: { date: string; onClose: () => void; onCreate: (title: string, kind: CalKind, notes: string) => void }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<CalKind>('entrega')
  const [notes, setNotes] = useState('')
  const save = () => { if (title.trim()) onCreate(title.trim(), kind, notes.trim()) }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div>
            <h3>Nuevo compromiso</h3>
            <div className="ms">{fmtLong(date)}</div>
          </div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <label style={{ ...label, marginTop: 0 }}>Título</label>
          <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Entrega fichas Golden Serum" autoFocus />
          <label style={label}>Tipo</label>
          <div className="seg" style={{ marginTop: 6 }}>
            {(Object.keys(KIND) as CalKind[]).map((k) => (
              <button key={k} type="button" className={kind === k ? 'active' : undefined} onClick={() => setKind(k)}>{KIND[k].icon} {KIND[k].label}</button>
            ))}
          </div>
          <label style={label}>Notas</label>
          <textarea style={{ ...input, minHeight: 72, resize: 'vertical' }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalle, formato, destino…" />
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" onClick={save} disabled={!title.trim()} style={!title.trim() ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
              <Plus size={14} /> Agendar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
