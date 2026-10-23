// ENT-CFG · Regla de entrega (Dirección, en Configuración): corte de salida, flete foráneo y local con sus mínimos, C.P. locales,
// días de salida de paquetería y chofer, tránsito de DHL/T1 y dónde se recoge en sucursal. Hasta hoy estos valores solo vivían
// en la base de datos (migración 171); el servidor sigue siendo la autoridad (entrega_config_guardar valida y audita).
import React, { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { guardarConfigEntrega, verConfigEntrega, type EntregaConfig } from '../../data/ops/entrega'

const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: 'var(--card, #fff)', color: 'inherit', width: '100%' }
const DIAS: Array<[number, string]> = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [7, 'D']]
const NOMBRE_DIA: Record<number, string> = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' }

interface Form {
  corte: string; foraneo_gratis_desde: string; foraneo_costo: string; local_gratis_desde: string; local_costo: string
  cp_local_desde: string; cp_local_hasta: string; dias_paqueteria: number[]; dias_chofer: number[]; dias_entrega_foranea: number[]
  dhl_transito_min: string; dhl_transito_max: string; t1_activo: boolean; t1_transito_min: string; t1_transito_max: string
  local_mismo_dia: boolean; recoge_lugar: string; recoge_horario: string
  /** ENT-H · bloques "10:30-13:30, 15:30-17:30", intervalo, cupo, margen y días hacia adelante (texto mientras se edita). */
  horario_franjas: string; horario_intervalo_min: string; horario_cupo: string; horario_margen_min: string; horario_dias_adelante: string
}
/** "10:30-13:30, 15:30-17:30" ⇄ [{desde,hasta}] */
export function franjasATexto(f: Array<{ desde: string; hasta: string }> | null | undefined): string { return (f ?? []).map((x) => `${x.desde}-${x.hasta}`).join(', ') }
export function textoAFranjas(s: string): Array<{ desde: string; hasta: string }> | null {
  const partes = s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)
  if (partes.length === 0 || partes.length > 6) return null
  const out: Array<{ desde: string; hasta: string }> = []
  for (const p of partes) {
    const m = /^(\d{1,2}):(\d{2})\s*(?:-|–|a)\s*(\d{1,2}):(\d{2})$/.exec(p)
    if (!m) return null
    const desde = `${m[1].padStart(2, '0')}:${m[2]}`, hasta = `${m[3].padStart(2, '0')}:${m[4]}`
    if (Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59 || desde >= hasta) return null
    out.push({ desde, hasta })
  }
  return out
}
const aForm = (c: EntregaConfig): Form => ({
  corte: String(c.corte).slice(0, 5), foraneo_gratis_desde: String(c.foraneo_gratis_desde), foraneo_costo: String(c.foraneo_costo), local_gratis_desde: String(c.local_gratis_desde), local_costo: String(c.local_costo),
  cp_local_desde: c.cp_local_desde, cp_local_hasta: c.cp_local_hasta, dias_paqueteria: [...c.dias_paqueteria], dias_chofer: [...c.dias_chofer], dias_entrega_foranea: [...c.dias_entrega_foranea],
  dhl_transito_min: String(c.dhl_transito_min), dhl_transito_max: String(c.dhl_transito_max), t1_activo: c.t1_activo, t1_transito_min: String(c.t1_transito_min), t1_transito_max: String(c.t1_transito_max),
  local_mismo_dia: c.local_mismo_dia, recoge_lugar: c.recoge_lugar, recoge_horario: c.recoge_horario,
  horario_franjas: franjasATexto(c.horario_franjas), horario_intervalo_min: String(c.horario_intervalo_min ?? 30), horario_cupo: String(c.horario_cupo ?? 1), horario_margen_min: String(c.horario_margen_min ?? 60), horario_dias_adelante: String(c.horario_dias_adelante ?? 7),
})
const num = (s: string) => Number(String(s).replace(/[$,\s]/g, ''))
const entero = (s: string, min: number, max: number) => { const n = Number(s); return Number.isInteger(n) && n >= min && n <= max }
/** Qué está mal, en palabras; null si todo sirve. */
export function validarEntrega(f: Form): string | null {
  if (!/^\d{2}:\d{2}$/.test(f.corte)) return 'La hora de corte debe ser HH:MM.'
  for (const [k, v] of [['foráneo gratis desde', f.foraneo_gratis_desde], ['costo foráneo', f.foraneo_costo], ['local gratis desde', f.local_gratis_desde], ['costo local', f.local_costo]] as Array<[string, string]>) {
    if (!Number.isFinite(num(v)) || num(v) < 0) return `El monto "${k}" debe ser un número de 0 en adelante.`
  }
  if (!/^\d{5}$/.test(f.cp_local_desde) || !/^\d{5}$/.test(f.cp_local_hasta)) return 'Los códigos postales locales deben tener 5 dígitos.'
  if (f.cp_local_desde > f.cp_local_hasta) return 'El C.P. "hasta" debe ser mayor o igual que el "desde".'
  if (f.dias_paqueteria.length === 0) return 'Elige al menos un día de salida de paquetería.'
  if (f.dias_chofer.length === 0) return 'Elige al menos un día de salida del chofer.'
  if (f.dias_entrega_foranea.length === 0) return 'Elige al menos un día en que la paquetería entrega.'
  if (!entero(f.dhl_transito_min, 0, 30) || !entero(f.dhl_transito_max, 0, 30) || Number(f.dhl_transito_min) > Number(f.dhl_transito_max)) return 'Tránsito DHL: días enteros de 0 a 30, mínimo ≤ máximo.'
  if (!entero(f.t1_transito_min, 0, 30) || !entero(f.t1_transito_max, 0, 30) || Number(f.t1_transito_min) > Number(f.t1_transito_max)) return 'Tránsito T1: días enteros de 0 a 30, mínimo ≤ máximo.'
  if (f.recoge_lugar.trim().length < 3 || f.recoge_horario.trim().length < 3) return 'Escribe dónde y a qué hora se recoge en sucursal.'
  if (!textoAFranjas(f.horario_franjas)) return 'Bloques de entrega: escribe horas como "10:30-13:30, 15:30-17:30" (cada bloque termina después de empezar).'
  if (!entero(f.horario_intervalo_min, 10, 120)) return 'El intervalo de los horarios de entrega va de 10 a 120 minutos.'
  if (!entero(f.horario_cupo, 1, 20)) return 'Entregas por horario: de 1 a 20.'
  if (!entero(f.horario_margen_min, 0, 480)) return 'El margen del mismo día va de 0 a 480 minutos.'
  if (!entero(f.horario_dias_adelante, 1, 30)) return 'Días que se agendan hacia adelante: de 1 a 30.'
  return null
}
const aDatos = (f: Form): Partial<EntregaConfig> => ({
  corte: f.corte, foraneo_gratis_desde: num(f.foraneo_gratis_desde), foraneo_costo: num(f.foraneo_costo), local_gratis_desde: num(f.local_gratis_desde), local_costo: num(f.local_costo),
  cp_local_desde: f.cp_local_desde, cp_local_hasta: f.cp_local_hasta, dias_paqueteria: [...f.dias_paqueteria].sort(), dias_chofer: [...f.dias_chofer].sort(), dias_entrega_foranea: [...f.dias_entrega_foranea].sort(),
  dhl_transito_min: Number(f.dhl_transito_min), dhl_transito_max: Number(f.dhl_transito_max), t1_activo: f.t1_activo, t1_transito_min: Number(f.t1_transito_min), t1_transito_max: Number(f.t1_transito_max),
  local_mismo_dia: f.local_mismo_dia, recoge_lugar: f.recoge_lugar.trim(), recoge_horario: f.recoge_horario.trim(),
  horario_franjas: textoAFranjas(f.horario_franjas) ?? undefined, horario_intervalo_min: Number(f.horario_intervalo_min), horario_cupo: Number(f.horario_cupo), horario_margen_min: Number(f.horario_margen_min), horario_dias_adelante: Number(f.horario_dias_adelante),
})
const diasTexto = (d: number[]) => d.length === 7 ? 'todos los días' : d.length === 0 ? 'ningún día' : [...d].sort().map((x) => NOMBRE_DIA[x]).join(', ')

function Dias({ valor, onChange, etiqueta, testid }: { valor: number[]; onChange: (d: number[]) => void; etiqueta: string; testid: string }) {
  return (
    <div style={{ display: 'grid', gap: 4, fontSize: 12 }} data-testid={testid}>
      <span>{etiqueta}</span>
      <div role="group" aria-label={etiqueta} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {DIAS.map(([n, l]) => {
          const on = valor.includes(n)
          return <button key={n} type="button" aria-pressed={on} aria-label={NOMBRE_DIA[n]} onClick={() => onChange(on ? valor.filter((x) => x !== n) : [...valor, n])}
            style={{ minWidth: 36, minHeight: 36, borderRadius: 10, border: '1px solid var(--line)', background: on ? 'var(--green)' : 'var(--card, #fff)', color: on ? '#fff' : 'inherit', fontFamily: 'inherit', fontWeight: 600, cursor: 'pointer' }}>{l}</button>
        })}
      </div>
      <span style={{ color: 'var(--ink-3)' }}>{diasTexto(valor)}</span>
    </div>
  )
}

export function EntregaConfigEditor({ ver = verConfigEntrega, guardar = guardarConfigEntrega }: { ver?: typeof verConfigEntrega; guardar?: typeof guardarConfigEntrega }) {
  const [form, setForm] = useState<Form | null>(null)
  const [base, setBase] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { let vivo = true; void ver().then((r) => { if (!vivo) return; if (r.ok) { const f = aForm(r.data); setForm(f); setBase(JSON.stringify(f)) } else setError(r.error) }); return () => { vivo = false } }, [ver])
  if (!form) return <div className="card" data-testid="entrega-config">{error ? <div role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div> : <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Cargando la regla de entrega…</span>}</div>
  const f = form
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm({ ...f, [k]: v })
  const texto = <K extends keyof Form>(k: K) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...f, [k]: e.target.value })
  const problema = validarEntrega(f)
  const dirty = JSON.stringify(f) !== base
  const enviar = async () => {
    if (problema || ocupado || !dirty) return
    setOcupado(true); setError(null); setAviso(null)
    const r = await guardar(aDatos(f))
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    const nf = aForm(r.data); setForm(nf); setBase(JSON.stringify(nf)); setAviso('Regla de entrega guardada. Aplica a los pedidos nuevos desde ahora.')
  }
  return (
    <div className="card" data-testid="entrega-config">
      <h4 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>Regla de entrega</h4>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12 }}>Lo que ven el doctor en el portal, el vendedor en la caja y Almacén al empacar: cuánto cuesta el envío, cuándo sale y cuándo llega. Los montos incluyen IVA.</div>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <label style={{ fontSize: 12 }}>Corte de salida (hora local)<input style={input} type="time" value={f.corte} onChange={texto('corte')} aria-label="Corte de salida" /></label>
          <label style={{ fontSize: 12 }}>Foráneo: envío gratis desde $<input style={input} inputMode="decimal" value={f.foraneo_gratis_desde} onChange={texto('foraneo_gratis_desde')} aria-label="Foráneo gratis desde" /></label>
          <label style={{ fontSize: 12 }}>Foráneo: costo si no llega $<input style={input} inputMode="decimal" value={f.foraneo_costo} onChange={texto('foraneo_costo')} aria-label="Costo foráneo" /></label>
          <label style={{ fontSize: 12 }}>Local: envío gratis desde $<input style={input} inputMode="decimal" value={f.local_gratis_desde} onChange={texto('local_gratis_desde')} aria-label="Local gratis desde" /></label>
          <label style={{ fontSize: 12 }}>Local: costo si no llega $ (abajo del mínimo el doctor recoge; esto lo usa el vendedor)<input style={input} inputMode="decimal" value={f.local_costo} onChange={texto('local_costo')} aria-label="Costo local" /></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <label style={{ fontSize: 12 }}>C.P. local desde (Culiacán)<input style={input} inputMode="numeric" maxLength={5} value={f.cp_local_desde} onChange={texto('cp_local_desde')} aria-label="C.P. local desde" /></label>
          <label style={{ fontSize: 12 }}>C.P. local hasta<input style={input} inputMode="numeric" maxLength={5} value={f.cp_local_hasta} onChange={texto('cp_local_hasta')} aria-label="C.P. local hasta" /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, alignSelf: 'end', minHeight: 40 }}><input type="checkbox" checked={f.local_mismo_dia} onChange={(e) => set('local_mismo_dia')(e.target.checked)} aria-label="El chofer entrega el mismo día" /> El chofer entrega el mismo día que sale</label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Dias etiqueta="Días que sale paquetería (recolección)" valor={f.dias_paqueteria} onChange={set('dias_paqueteria')} testid="dias-paqueteria" />
          <Dias etiqueta="Días que entrega la paquetería" valor={f.dias_entrega_foranea} onChange={set('dias_entrega_foranea')} testid="dias-entrega" />
          <Dias etiqueta="Días que sale el chofer (local y recoger)" valor={f.dias_chofer} onChange={set('dias_chofer')} testid="dias-chofer" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label style={{ fontSize: 12 }}>DHL llega en (días) mín.<input style={input} type="number" min={0} max={30} value={f.dhl_transito_min} onChange={texto('dhl_transito_min')} aria-label="DHL tránsito mínimo" /></label>
          <label style={{ fontSize: 12 }}>DHL máx.<input style={input} type="number" min={0} max={30} value={f.dhl_transito_max} onChange={texto('dhl_transito_max')} aria-label="DHL tránsito máximo" /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, minHeight: 40 }}><input type="checkbox" checked={f.t1_activo} onChange={(e) => set('t1_activo')(e.target.checked)} aria-label="T1 activo" /> Ofrecer T1</label>
          <label style={{ fontSize: 12 }}>T1 llega en (días) mín.<input style={input} type="number" min={0} max={30} value={f.t1_transito_min} onChange={texto('t1_transito_min')} aria-label="T1 tránsito mínimo" disabled={!f.t1_activo} /></label>
          <label style={{ fontSize: 12 }}>T1 máx.<input style={input} type="number" min={0} max={30} value={f.t1_transito_max} onChange={texto('t1_transito_max')} aria-label="T1 tránsito máximo" disabled={!f.t1_activo} /></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <label style={{ fontSize: 12 }}>Dónde se recoge<input style={input} maxLength={200} value={f.recoge_lugar} onChange={texto('recoge_lugar')} aria-label="Lugar para recoger" placeholder="Sucursal Renovacell, calle y número, Culiacán" /></label>
          <label style={{ fontSize: 12 }}>Horario para recoger<input style={input} maxLength={200} value={f.recoge_horario} onChange={texto('recoge_horario')} aria-label="Horario para recoger" placeholder="Lunes a sábado de 10:00 a 18:00" /></label>
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }} data-testid="entrega-horarios-cfg">
          <div style={{ fontSize: 13, fontWeight: 700 }}>Horarios de entrega local (chofer)</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '2px 0 8px' }}>Al vender una entrega local se elige uno de estos horarios; al elegirlo se bloquea para los demás. Almacén, Chofer y Dirección los ven en "Horarios de entrega".</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
            <label style={{ fontSize: 12, gridColumn: 'span 2' }}>Bloques del día (HH:MM-HH:MM, separados por coma)<input style={input} value={f.horario_franjas} onChange={texto('horario_franjas')} aria-label="Bloques de entrega" placeholder="10:30-13:30, 15:30-17:30" /></label>
            <label style={{ fontSize: 12 }}>Cada (minutos)<input style={input} type="number" min={10} max={120} step={5} value={f.horario_intervalo_min} onChange={texto('horario_intervalo_min')} aria-label="Intervalo de horarios" /></label>
            <label style={{ fontSize: 12 }}>Entregas por horario<input style={input} type="number" min={1} max={20} value={f.horario_cupo} onChange={texto('horario_cupo')} aria-label="Entregas por horario" /></label>
            <label style={{ fontSize: 12 }}>Mismo día: mínimo (min) antes del horario<input style={input} type="number" min={0} max={480} step={15} value={f.horario_margen_min} onChange={texto('horario_margen_min')} aria-label="Margen del mismo día" /></label>
            <label style={{ fontSize: 12 }}>Días que se agendan hacia adelante<input style={input} type="number" min={1} max={30} value={f.horario_dias_adelante} onChange={texto('horario_dias_adelante')} aria-label="Días hacia adelante" /></label>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={enviar} disabled={!!problema || ocupado || !dirty} data-testid="entrega-guardar"><Save size={15} /> {ocupado ? 'Guardando…' : 'Guardar regla de entrega'}</button>
          {problema && dirty && <span role="alert" style={{ fontSize: 12.5, color: 'var(--warn)' }} data-testid="entrega-problema">{problema}</span>}
          {error && <span role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</span>}
          {aviso && !dirty && <span role="status" style={{ fontSize: 12.5, color: 'var(--green-deep)' }} data-testid="entrega-aviso">{aviso}</span>}
        </div>
      </div>
    </div>
  )
}
