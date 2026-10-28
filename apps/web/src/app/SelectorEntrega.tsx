// ENT-2 · Selector de ENTREGA para el personal (Levantar pedido): el servidor manda las opciones con el flete que
// propone la regla y la promesa de llegada (corte 15:30); aquí el vendedor elige y, si quiere cobrar otro flete
// (o regalarlo), lo escribe con su motivo. Nunca se inventa una fecha: todo viene de entrega_opciones.
import React, { useEffect, useRef, useState } from 'react'
import { money } from '../lib/format'
import { MOTIVO_ENTREGA, avisoEnvioGratis, faltantePara, fleteTexto, localBajoMinimo, opcionDe, opcionesEntrega, promesaDe, requiereHorario, type EleccionEntregaServidor, type HorarioElegido, type OpcionesEntrega } from '../data/ops/entrega'
import { HorarioEntregaPicker } from './HorarioEntregaPicker'
import { AvisoEnvioGratisVista } from './AvisoEnvioGratis'

/** ENT-H · el horario elegido viaja solo cuando existe (sin la llave en null). */
const hor = (v: EleccionEntregaServidor | null | undefined): { horario?: HorarioElegido } => (v?.horario ? { horario: v.horario } : {})

export function SelectorEntrega({ subtotal, cp, value, onChange, cargar = opcionesEntrega, cargarHorarios }: {
  subtotal: number
  cp: string | null
  value: EleccionEntregaServidor | null
  onChange: (e: EleccionEntregaServidor | null, ops: OpcionesEntrega | null) => void
  cargar?: typeof opcionesEntrega
  /** ENT-H · horarios de entrega local (inyectable en pruebas). */
  cargarHorarios?: React.ComponentProps<typeof HorarioEntregaPicker>['cargar']
}) {
  const [ops, setOps] = useState<OpcionesEntrega | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [fleteTxt, setFleteTxt] = useState<string>('')
  const [motivo, setMotivo] = useState('')
  const [ajustar, setAjustar] = useState(false)
  const vivo = useRef(true); const pedido = useRef(0)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  // Opciones del servidor: se piden al cambiar el importe de productos o el CP (con una pequeña espera).
  useEffect(() => {
    const n = ++pedido.current
    const t = setTimeout(async () => {
      setCargando(true)
      const r = await cargar('staff', subtotal, cp)
      if (!vivo.current || n !== pedido.current) return
      setCargando(false)
      if (!r.ok) { setError(r.error); setOps(null); onChange(null, null); return }
      setError(null); setOps(r.data)
      // La elección vigente sigue si existe; si no, la sugerida del servidor.
      const actual = opcionDe(r.data, value?.opcion)
      const id = actual && actual.permitido && actual.disponible ? actual.id : r.data.sugerida ?? r.data.opciones.find((o) => o.permitido && o.disponible)?.id ?? null
      if (!id) { onChange(null, r.data); return }
      const o = opcionDe(r.data, id)!
      if (value?.opcion === id && value.flete != null && value.flete !== o.flete) onChange({ opcion: id, flete: value.flete, motivo: value.motivo, ...hor(value) }, r.data)   // ajuste conservado
      else if (value?.opcion === id) onChange({ opcion: id, ...(value.motivo ? { motivo: value.motivo } : {}), ...hor(value) }, r.data)   // ENT-H · el horario (y ENT-P · el motivo de cortesía) se conservan
      else { onChange({ opcion: id }, r.data); setAjustar(false); setFleteTxt(''); setMotivo('') }
    }, 250)
    return () => clearTimeout(t)
  }, [subtotal, cp])   // eslint-disable-line react-hooks/exhaustive-deps

  const sel = opcionDe(ops, value?.opcion)
  const hoy = ops?.corte.hoy ?? null
  const elegir = (id: string) => { const o = opcionDe(ops, id); if (!o || !o.permitido || !o.disponible) return; setAjustar(false); setFleteTxt(''); setMotivo(''); onChange({ opcion: id }, ops) }
  const aplicarAjuste = (txt: string, mot: string) => {
    if (!sel) return
    const n = Number(txt)
    const conMotivo = localBajoMinimo(ops, sel) && mot.trim() ? { motivo: mot.trim() } : {}   // ENT-P · la cortesía conserva su motivo
    if (txt.trim() === '' || !Number.isFinite(n) || n < 0) { onChange({ opcion: sel.id, ...conMotivo, ...hor(value) }, ops); return }
    if (Math.round(n * 100) === Math.round(sel.flete * 100)) { onChange({ opcion: sel.id, ...conMotivo, ...hor(value) }, ops); return }
    onChange({ opcion: sel.id, flete: Math.round(n * 100) / 100, motivo: mot.trim(), ...hor(value) }, ops)
  }
  // ENT-H · el horario viaja junto con la opción (solo entrega local por chofer); cambiar de opción lo suelta.
  const elegirHorario = (h: HorarioElegido | null) => { if (!sel) return; const { horario: _h, ...resto } = value ?? { opcion: sel.id }; void _h; onChange({ ...resto, opcion: sel.id, ...(h ? { horario: h } : {}) }, ops) }
  const necesitaHorario = requiereHorario(sel)
  const ajusteIncompleto = value != null && value.flete != null && sel != null && value.flete !== sel.flete && !(value.motivo && value.motivo.trim().length >= 3)
  // ENT-P · misma regla que el portal: chofer local gratis desde el mínimo. Abajo del mínimo el vendedor puede darlo como
  // cortesía, pero con motivo (queda en el pedido; el servidor lo exige igual).
  const bajoMinimo = localBajoMinimo(ops, sel)
  const faltaMinimo = sel ? faltantePara(ops!, sel) : null
  const motivoBajoMinimo = (txt: string) => { if (!sel) return; setMotivo(txt); onChange({ ...(value ?? { opcion: sel.id }), opcion: sel.id, motivo: txt.trim() || undefined }, ops) }

  if (error) {
    return <div role="alert" className="ms" style={{ color: 'var(--danger)' }} data-testid="entrega-error">No se pudieron cargar las opciones de entrega: {error}</div>
  }
  if (!ops) return <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="entrega-cargando">{cargando ? 'Calculando entrega…' : 'Sin opciones de entrega.'}</div>

  return (
    <div data-testid="selector-entrega">
      <div style={{ display: 'grid', gap: 8 }}>
        {ops.opciones.map((o) => {
          const on = value?.opcion === o.id
          const puede = o.permitido && o.disponible
          const fueraZona = o.tipo === 'local' && ops.cp != null && !ops.local
          return (
            <label key={o.id} className="addr-opt" data-testid={`entrega-${o.id}`} aria-disabled={!puede}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 11, background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: puede ? 'pointer' : 'not-allowed', opacity: puede ? 1 : 0.55 }}
              onClick={() => elegir(o.id)}>
              <input type="radio" name="entrega-staff" checked={on} disabled={!puede} onChange={() => elegir(o.id)} />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontSize: 13 }}>{o.texto} <span className="mono" style={{ fontWeight: 600, color: o.flete ? 'var(--ink-2)' : 'var(--green-deep)', marginLeft: 6 }}>{fleteTexto(o.flete, money)}</span></b>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {puede ? (requiereHorario(o) ? (on && value?.horario ? promesaDe({ ...o, horario: { ...value.horario, fin: '' } }, hoy) : 'Se agenda en un horario de media hora') : promesaDe(o, hoy)) : !o.disponible ? 'Pendiente de integrar' : MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'No aplica'}
                  {fueraZona && puede ? ' · el CP no es de Culiacán: confirma que el chofer sí llega' : ''}
                </span>
                {puede && !on && (() => {
                  // ENT-P · la misma nota de envío gratis que ve el doctor, en voz del vendedor (para ofrecer completar)
                  const f = faltantePara(ops, o)
                  if (!f || f.faltante <= 0 || (o.tipo !== 'local' && o.tipo !== 'foraneo')) return null
                  return <span style={{ display: 'block', fontSize: 11.5, color: 'var(--warn)', marginTop: 2 }} data-testid={`entrega-faltante-${o.id}`}>
                    {o.tipo === 'local' ? `Gratis desde ${money(f.minimo)} · abajo del mínimo solo como cortesía con motivo` : `Gratis desde ${money(f.minimo)} · al cliente le faltan ${money(f.faltante)}`}
                  </span>
                })()}
              </span>
            </label>
          )
        })}
      </div>
      {!bajoMinimo && <AvisoEnvioGratisVista aviso={avisoEnvioGratis(ops, money, 'staff')} testId="entrega-aviso-envio" />}
      {sel && bajoMinimo && faltaMinimo && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + ((value?.motivo ?? '').trim().length >= 3 ? 'var(--line)' : 'var(--warn)'), borderRadius: 10, background: 'var(--surface-2, #fafafa)', display: 'grid', gap: 6 }} data-testid="entrega-bajo-minimo">
          <div style={{ fontSize: 12.5 }}>
            <b>Al cliente le faltan {money(faltaMinimo.faltante)} para la entrega gratis con chofer</b> (desde {money(faltaMinimo.minimo)}). Abajo del mínimo es cortesía: escribe el motivo, queda en el pedido.
          </div>
          <label style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>Motivo de la cortesía
            <input type="text" maxLength={200} value={motivo} placeholder="p. ej. cliente frecuente, entrega de paso" onChange={(e) => motivoBajoMinimo(e.target.value)} style={{ width: '100%' }} data-testid="entrega-motivo-minimo" />
          </label>
        </div>
      )}
      {sel && necesitaHorario && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + (value?.horario ? 'var(--line)' : 'var(--warn)'), borderRadius: 10, background: 'var(--surface-2, #fafafa)' }} data-testid="entrega-horario">
          <div className="eyebrow" style={{ margin: '0 0 8px' }}>Horario de entrega {!value?.horario && <span style={{ fontWeight: 400, color: 'var(--warn)' }}>· elige uno para continuar</span>}</div>
          <HorarioEntregaPicker value={value?.horario ?? null} onChange={elegirHorario} cargar={cargarHorarios} compacto />
        </div>
      )}
      {sel && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: 'var(--ink-3)' }} data-testid="entrega-corte">
            {sel.tipo === 'recoge' ? `${ops.recoge.lugar} · ${ops.recoge.horario}` : ops.corte.antes_de_corte ? `Antes de las ${ops.corte.hora} sale hoy.` : `Después de las ${ops.corte.hora}: sale el siguiente día hábil.`}
          </span>
          {sel.tipo !== 'mostrador' && !ajustar && (
            <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setAjustar(true); setFleteTxt(String(value?.flete ?? sel.flete)); setMotivo(value?.motivo ?? '') }} data-testid="entrega-ajustar">
              {value?.flete != null && value.flete !== sel.flete ? `Flete ajustado: ${money(value.flete)}` : 'Cambiar flete'}
            </button>
          )}
        </div>
      )}
      {sel && ajustar && (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface-2, #fafafa)', display: 'grid', gap: 8 }} data-testid="entrega-ajuste">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12.5 }}>Flete a cobrar
              <input type="number" min={0} step="0.01" value={fleteTxt} onChange={(e) => { setFleteTxt(e.target.value); aplicarAjuste(e.target.value, motivo) }} style={{ marginLeft: 8, width: 110 }} data-testid="entrega-flete" />
            </label>
            <span className="ms" style={{ color: 'var(--ink-3)' }}>La regla propone {fleteTexto(sel.flete, money)}.</span>
          </div>
          {value?.flete != null && value.flete !== sel.flete && (
            <label style={{ fontSize: 12.5 }}>Motivo del cambio
              <input type="text" maxLength={200} value={motivo} placeholder="p. ej. cortesía por volumen" onChange={(e) => { setMotivo(e.target.value); aplicarAjuste(fleteTxt, e.target.value) }} style={{ marginLeft: 8, width: 'min(100%, 320px)' }} data-testid="entrega-motivo" />
            </label>
          )}
          {ajusteIncompleto && <div className="ms" style={{ color: 'var(--warn)' }} data-testid="entrega-motivo-falta">Para cambiar el flete escribe el motivo (queda registrado en el pedido).</div>}
        </div>
      )}
    </div>
  )
}

/** ¿La elección está completa para mandarla al servidor? (un flete distinto al de la regla exige motivo) */
export function eleccionCompleta(value: EleccionEntregaServidor | null, ops: OpcionesEntrega | null): boolean {
  if (!value || !ops) return false
  const o = opcionDe(ops, value.opcion)
  if (!o || !o.permitido || !o.disponible) return false
  if (value.flete != null && value.flete !== o.flete && !(value.motivo && value.motivo.trim().length >= 3)) return false
  if (requiereHorario(o) && !(value.horario && value.horario.fecha && value.horario.inicio)) return false   // ENT-H · la entrega local exige horario
  if (localBajoMinimo(ops, o) && !(value.motivo && value.motivo.trim().length >= 3)) return false   // ENT-P · cortesía abajo del mínimo: con motivo
  return true
}
