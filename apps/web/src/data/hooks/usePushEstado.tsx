// PUSH SIEMPRE · quién tiene las notificaciones activas (solo Dirección; la base lo decide). Para la etiqueta en Equipo y
// Doctores: "Avisos en 2 dispositivos" / "Sin avisos".
import React, { useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'

export type EstadoPush = Record<string, { dispositivos: number; ultimo_ok: string | null }>
export function usePushEstado(activo = true): EstadoPush | null {
  const [m, setM] = useState<EstadoPush | null>(null)
  useEffect(() => {
    if (!activo || !hasSupabase) return
    let vivo = true
    void (supabase.rpc('push_estado_cuentas' as never) as unknown as PromiseLike<{ data: unknown; error: unknown }>)
      .then(({ data, error }) => { if (vivo && !error) setM((data ?? {}) as EstadoPush) }, () => {})
    return () => { vivo = false }
  }, [activo])
  return m
}

export function EtiquetaPush({ estado, id }: { estado: EstadoPush | null; id: string }) {
  if (!estado) return null
  const n = estado[id]?.dispositivos ?? 0
  return n > 0
    ? <span className="pill p-ok" data-testid="push-si" title="Recibe notificaciones aunque tenga el sistema cerrado">Avisos en {n} {n === 1 ? 'dispositivo' : 'dispositivos'}</span>
    : <span className="pill p-warn" data-testid="push-no" title="No le llegan notificaciones: pídele que las active al entrar">Sin avisos</span>
}
