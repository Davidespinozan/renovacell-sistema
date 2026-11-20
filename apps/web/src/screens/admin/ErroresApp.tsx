// ERRORES DE LA APP (BLOQUE1, 20 nov 2026) · lo que falló en las pantallas del equipo, agrupado (mismo error = una fila
// con cuántas veces pasó). Dirección recibe aviso de cada error nuevo; aquí ve el detalle para pedir la corrección.
import React, { useEffect, useState } from 'react'
import { supabase, hasSupabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/format'
import { Vacio } from '../../app/EmptyState'

interface Fila { id: string; origen: string; mensaje: string; ruta: string | null; rol: string | null; n: number; primera: string; ultima: string }
const ORIGEN: Record<string, string> = { cliente: 'Pantalla', escritura: 'Al guardar', edge: 'Servidor' }

export function ErroresApp() {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  useEffect(() => {
    if (!hasSupabase) { setFilas([]); return }
    void Promise.resolve(supabase.from('errores_app' as never).select('id, origen, mensaje, ruta, rol, n, primera, ultima').order('ultima', { ascending: false }).limit(200))
      .then(({ data }) => setFilas((data ?? []) as unknown as Fila[]))
  }, [])
  if (!filas) return <div className="card">Cargando…</div>
  if (filas.length === 0) return <div className="card"><Vacio plano icono="check" titulo="Sin errores registrados" /></div>
  return (
    <div className="card" style={{ padding: 0 }} data-testid="errores-app">
      {filas.map((f) => (
        <div key={f.id} className="lrow">
          <div>
            <div className="nm">{f.mensaje}</div>
            <div className="lt">{ORIGEN[f.origen] ?? f.origen}{f.rol ? ` · ${f.rol}` : ''}{f.ruta ? ` · ${f.ruta}` : ''} · primera vez {fmtDate(f.primera)} · última {fmtDate(f.ultima)}</div>
          </div>
          <span className={'pill ' + (f.n >= 25 ? 'p-dang' : 'p-neu')}>{f.n}×</span>
        </div>
      ))}
    </div>
  )
}
