// PAY-EXP-01A-3 · Estado de la revisión económica para pantallas: 'cargando' | 'listo' | 'error' | 'no_autorizado'
// | 'inactivo'. Un error NUNCA se presenta como "cero casos".
import { useCallback, useEffect, useRef, useState } from 'react'
import { revisionEconomica as clientePorDefecto, type ClienteRevisionEconomica, type RevisionEconomica } from '../ops/revisionEconomica'

export type EstadoRevision =
  | { estado: 'inactivo' } | { estado: 'cargando' }
  | { estado: 'listo'; data: RevisionEconomica }
  | { estado: 'error'; mensaje: string } | { estado: 'no_autorizado'; mensaje: string }

export function useRevisionEconomica(activo: boolean, cliente: ClienteRevisionEconomica = clientePorDefecto): EstadoRevision & { recargar: () => Promise<void> } {
  const [st, setSt] = useState<EstadoRevision>(activo ? { estado: 'cargando' } : { estado: 'inactivo' })
  const vivo = useRef(true)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  const recargar = useCallback(async () => {
    if (!activo) { setSt({ estado: 'inactivo' }); return }
    const r = await cliente.leer(false)
    if (!vivo.current) return
    if (r.ok) setSt({ estado: 'listo', data: r.data })
    else setSt(r.error.tipo === 'no_autorizado' ? { estado: 'no_autorizado', mensaje: r.error.mensaje } : { estado: 'error', mensaje: r.error.mensaje })
  }, [activo, cliente])
  useEffect(() => { if (activo) setSt({ estado: 'cargando' }); void recargar() }, [activo, recargar])
  return { ...st, recargar }
}
