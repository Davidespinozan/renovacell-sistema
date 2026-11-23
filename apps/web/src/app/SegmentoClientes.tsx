// SEG-CLI (23 nov 2026) · el dueño: "segmentar los clientes ya verificados, con portal, sin portal en Clientes, en todos
// los roles". El MISMO filtro y la MISMA etiqueta en el directorio de Dirección y en la cartera de Ventas.
import React, { useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../lib/supabase'

export type Segmento = 'todos' | 'verificados' | 'por_verificar' | 'sin_portal'
export interface DatosSegmento { portal: boolean; verificado: boolean }

export function segmentoDe(c: DatosSegmento): Exclude<Segmento, 'todos'> {
  if (!c.portal) return 'sin_portal'
  return c.verificado ? 'verificados' : 'por_verificar'
}
export function filtrarSegmento<T>(filas: T[], seg: Segmento, datos: (f: T) => DatosSegmento): T[] {
  return seg === 'todos' ? filas : filas.filter((f) => segmentoDe(datos(f)) === seg)
}
export function contarSegmentos<T>(filas: T[], datos: (f: T) => DatosSegmento): Record<Segmento, number> {
  const n: Record<Segmento, number> = { todos: filas.length, verificados: 0, por_verificar: 0, sin_portal: 0 }
  for (const f of filas) n[segmentoDe(datos(f))]++
  return n
}

const OPCIONES: Array<[Segmento, string]> = [['todos', 'Todos'], ['verificados', 'Verificados'], ['por_verificar', 'Con portal sin verificar'], ['sin_portal', 'Sin portal']]
export const TEXTO_SEGMENTO: Record<Exclude<Segmento, 'todos'>, string> = { verificados: 'Verificado', por_verificar: 'Portal · sin verificar', sin_portal: 'Sin portal' }

export function FiltroSegmento({ valor, onChange, conteo }: { valor: Segmento; onChange: (s: Segmento) => void; conteo: Record<Segmento, number> }) {
  return (
    <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} data-testid="filtro-segmento">
      {OPCIONES.map(([k, lbl]) => (
        <button key={k} type="button" className={valor === k ? 'active' : undefined} aria-pressed={valor === k} onClick={() => onChange(k)} data-testid={`segmento-${k}`}>
          {lbl} <span style={{ opacity: 0.7 }}>({conteo[k].toLocaleString('es-MX')})</span>
        </button>
      ))}
    </div>
  )
}

export function MarcaSegmento({ datos }: { datos: DatosSegmento }) {
  const s = segmentoDe(datos)
  const clase = s === 'verificados' ? 'p-ok' : s === 'por_verificar' ? 'p-warn' : 'p-neu'
  return <span className={'pill ' + clase} style={{ whiteSpace: 'nowrap' }} data-testid={`marca-${s}`}>{TEXTO_SEGMENTO[s]}</span>
}

/** Dirección · ids de las cuentas verificadas (profiles.verified), para segmentar el directorio completo. */
export function useCuentasVerificadas(activo: boolean): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    if (!activo || !hasSupabase) return
    let vivo = true
    void (async () => {
      const todos: string[] = []
      for (let desde = 0; desde < 50000; desde += 1000) {
        const { data, error } = await supabase.from('profiles').select('id').eq('verified', true).range(desde, desde + 999)
        if (error || !data) break
        todos.push(...data.map((r: { id: string }) => r.id))
        if (data.length < 1000) break
      }
      if (vivo) setIds(new Set(todos))
    })()
    return () => { vivo = false }
  }, [activo])
  return ids
}
