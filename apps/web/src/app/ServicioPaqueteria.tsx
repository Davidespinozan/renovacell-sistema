// ENTREGA-SERVICIO (2 nov 2026) · Elegir el SERVICIO de la paquetería al vender, con su fecha exacta de entrega. Lo usan el
// checkout del doctor y el vendedor (Levantar pedido): se cotiza con el CP y las piezas, se propone el más barato y, si el
// cliente quiere que llegue antes, paga solo la diferencia. Si la paquetería no responde se vende con la regla de siempre.
import React, { useEffect, useRef, useState } from 'react'
import { money } from '../lib/format'
import { cotizarEnvio, fleteTexto, llegadaServicio, precioServicio, type CotizacionEnvio, type ServicioElegido } from '../data/ops/entrega'

export function ServicioPaqueteria({ cp, piezas, fleteRegla, value, onChange, destino, hoy, cargar = cotizarEnvio }: {
  cp: string | null
  piezas: number
  /** El flete de la opción según la regla (gratis desde el mínimo, si no el costo fijo). */
  fleteRegla: number
  value: ServicioElegido | null
  onChange: (s: ServicioElegido | null, cot: CotizacionEnvio | null) => void
  destino?: { ciudad?: string | null; estado?: string | null }
  hoy?: string | null
  cargar?: typeof cotizarEnvio
}) {
  const [cot, setCot] = useState<CotizacionEnvio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [vuelta, setVuelta] = useState(0)
  const pedido = useRef(0)

  useEffect(() => {
    if (!cp || !/^\d{5}$/.test(cp) || piezas < 1) { setCot(null); setError(null); if (value) onChange(null, null); return }
    const n = ++pedido.current
    const t = setTimeout(async () => {
      setCargando(true)
      const r = await cargar(cp, piezas, destino)
      if (n !== pedido.current) return
      setCargando(false)
      if (!r.ok) { setCot(null); setError(r.error); onChange(null, null); return }
      setError(null); setCot(r.data)
      // Se conserva el servicio elegido si sigue en la cotización nueva; si no, el más barato (el normal).
      const mismo = value && r.data.servicios.find((s) => s.codigo === value.codigo)
      const s = mismo ?? r.data.servicios[0]
      onChange({ cotizacion_id: r.data.cotizacion_id, codigo: s.codigo, diferencia: s.diferencia }, r.data)
    }, 300)
    return () => clearTimeout(t)
  }, [cp, piezas, vuelta])   // eslint-disable-line react-hooks/exhaustive-deps

  // La cotización vale 2 horas: al vencer se vuelve a pedir sola.
  useEffect(() => {
    if (!cot) return
    const ms = Date.parse(cot.expira_at) - Date.now() - 60_000
    if (!(ms > 0)) return
    const t = setTimeout(() => setVuelta((v) => v + 1), Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(t)
  }, [cot])

  if (!cp) return null
  if (cargando && !cot) return <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="servicio-cargando">Consultando la paquetería…</div>
  if (error) return <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="servicio-sin-cotizacion">{error}</div>
  if (!cot) return null
  return (
    <div style={{ display: 'grid', gap: 6 }} data-testid="servicio-paqueteria">
      <div className="eyebrow" style={{ margin: 0 }}>Servicio {cot.proveedor.toUpperCase()} · ¿cuándo lo quieres recibir?</div>
      {cot.servicios.map((s) => {
        const on = value?.codigo === s.codigo && value.cotizacion_id === cot.cotizacion_id
        const precio = precioServicio(fleteRegla, s)
        return (
          <label key={s.codigo} data-testid={`servicio-${s.codigo}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 10, background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: 'pointer' }}>
            <input type="radio" name="servicio-paqueteria" checked={on} onChange={() => onChange({ cotizacion_id: cot.cotizacion_id, codigo: s.codigo, diferencia: s.diferencia }, cot)} />
            <span style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: 13 }}>Llega el {llegadaServicio(s, hoy)}</b>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.nombre}{s.diferencia > 0 ? ` · ${money(s.diferencia)} más por llegar antes` : ''}</span>
            </span>
            <span className="mono" style={{ fontWeight: 600, fontSize: 13, color: precio ? 'var(--ink-2)' : 'var(--green-deep)' }}>{fleteTexto(precio, money)}</span>
          </label>
        )
      })}
    </div>
  )
}
