// Cómo se pinta una cifra de cabecera que viene del servidor (hooks/useKpis.ts).
// Tres estados y NUNCA un cero inventado: cargando → "…", sin respuesta o sin
// permiso → "No disponible", con respuesta → la cifra.
import React from 'react'
import { AlertTriangle } from 'lucide-react'
import type { EstadoKpi } from '../data/hooks/useKpis'

export const NO_DISPONIBLE = 'No disponible'

/** Texto de una cifra según el estado de su KPI. */
export function cifra<T>(e: EstadoKpi<T>, f: (d: T) => string): string {
  if (e.loading) return '…'
  if (e.error || !e.data) return NO_DISPONIBLE
  return f(e.data)
}

/** Aviso único cuando alguna cifra de cabecera no se pudo cargar: dice POR QUÉ. */
export function AvisoKpi({ estados }: { estados: EstadoKpi<unknown>[] }) {
  const errores = [...new Set(estados.map((e) => e.error).filter((e): e is string => !!e))]
  if (errores.length === 0) return null
  return (
    <div className="sysnote" role="alert" style={{ background: 'var(--warn-bg, #FFF6E5)', borderColor: '#E9D8A6', color: '#8a6d1a', alignItems: 'flex-start' }}>
      <AlertTriangle size={16} />
      <span>
        <b>Hay indicadores que no se muestran.</b> {errores.join(' ')} Las cifras marcadas «{NO_DISPONIBLE}» no son cero: no se pudieron consultar.
      </span>
    </div>
  )
}
