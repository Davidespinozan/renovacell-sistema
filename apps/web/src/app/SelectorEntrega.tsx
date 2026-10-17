// ENT-2 · Selector de ENTREGA para el personal (Levantar pedido): el servidor manda las opciones con el flete que
// propone la regla y la promesa de llegada (corte 15:30); aquí el vendedor elige y, si quiere cobrar otro flete
// (o regalarlo), lo escribe con su motivo. Nunca se inventa una fecha: todo viene de entrega_opciones.
import React, { useEffect, useRef, useState } from 'react'
import { money } from '../lib/format'
import { MOTIVO_ENTREGA, fleteTexto, opcionDe, opcionesEntrega, promesaDe, type EleccionEntregaServidor, type OpcionesEntrega } from '../data/ops/entrega'

export function SelectorEntrega({ subtotal, cp, value, onChange, cargar = opcionesEntrega }: {
  subtotal: number
  cp: string | null
  value: EleccionEntregaServidor | null
  onChange: (e: EleccionEntregaServidor | null, ops: OpcionesEntrega | null) => void
  cargar?: typeof opcionesEntrega
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
      if (value?.opcion === id && value.flete != null && value.flete !== o.flete) onChange({ opcion: id, flete: value.flete, motivo: value.motivo }, r.data)   // ajuste conservado
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
    if (txt.trim() === '' || !Number.isFinite(n) || n < 0) { onChange({ opcion: sel.id }, ops); return }
    if (Math.round(n * 100) === Math.round(sel.flete * 100)) { onChange({ opcion: sel.id }, ops); return }
    onChange({ opcion: sel.id, flete: Math.round(n * 100) / 100, motivo: mot.trim() }, ops)
  }
  const ajusteIncompleto = value != null && value.flete != null && sel != null && value.flete !== sel.flete && !(value.motivo && value.motivo.trim().length >= 3)

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
                  {puede ? promesaDe(o, hoy) : !o.disponible ? 'Pendiente de integrar' : MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'No aplica'}
                  {fueraZona && puede ? ' · el CP no es de Culiacán: confirma que el chofer sí llega' : ''}
                </span>
              </span>
            </label>
          )
        })}
      </div>
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
  if (value.flete != null && value.flete !== o.flete) return !!value.motivo && value.motivo.trim().length >= 3
  return true
}
